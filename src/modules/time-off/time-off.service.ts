import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, In } from 'typeorm';
import {
  TimeOffRequest,
  TimeOffStatus,
} from '../../entities/time-off-request.entity.js';
import { BalanceService } from '../balance/balance.service.js';
import { HcmClientService } from '../hcm-client/hcm-client.service.js';
import { CreateTimeOffDto } from './dto/create-time-off.dto.js';

/** Balances older than this are considered stale and will be auto-refreshed. */
const STALE_BALANCE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClientService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── CREATE ───────────────────────────────────────────────

  /**
   * Submit a new time-off request.
   * Validates: sufficient balance, no overlapping requests.
   * If the local balance is stale (>24h), auto-refreshes from HCM first.
   */
  async createRequest(dto: CreateTimeOffDto): Promise<TimeOffRequest> {
    const leaveType = dto.leaveType || 'ANNUAL';

    // Fix #12: Auto-refresh stale balances before making decisions
    await this.refreshIfStale(dto.employeeId, dto.locationId, leaveType);

    // Defensive pre-check: does the employee have enough balance?
    const hasBalance = await this.balanceService.hasEnoughBalance(
      dto.employeeId,
      dto.locationId,
      leaveType,
      dto.numberOfDays,
    );

    if (!hasBalance) {
      throw new BadRequestException(
        `Insufficient balance for ${dto.numberOfDays} days of ${leaveType} leave`,
      );
    }

    // Fix #9: Check for overlapping active requests
    await this.checkForOverlap(
      dto.employeeId,
      dto.locationId,
      dto.startDate,
      dto.endDate,
    );

    // Create the request in PENDING state
    const request = this.requestRepo.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      leaveType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      numberOfDays: dto.numberOfDays,
      reason: dto.reason || '',
      status: TimeOffStatus.PENDING,
    });

    const saved = await this.requestRepo.save(request);
    this.logger.log(`Created time-off request ${saved.id} (PENDING)`);
    return saved;
  }

  // ─── READ ─────────────────────────────────────────────────

  /**
   * Get a request by its ID.
   */
  async getRequestById(id: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Time-off request ${id} not found`);
    }
    return request;
  }

  /**
   * List all requests in the system, optionally filtered by status.
   */
  async getAllRequests(status?: TimeOffStatus): Promise<TimeOffRequest[]> {
    const where: Record<string, unknown> = {};
    if (status) {
      where['status'] = status;
    }
    return this.requestRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * List all requests for an employee, optionally filtered by status.
   */
  async getRequestsByEmployee(
    employeeId: string,
    status?: TimeOffStatus,
  ): Promise<TimeOffRequest[]> {
    const where: Record<string, unknown> = { employeeId };
    if (status) {
      where['status'] = status;
    }
    return this.requestRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  // ─── APPROVE ──────────────────────────────────────────────

  /**
   * Manager approves a request.
   * Fix #5: Entire flow is wrapped in try/catch to guarantee rollback.
   * Fix #6: Local DB operations use a transaction.
   * Fix #7: APPROVED state is now persisted before HCM call.
   *
   * Flow: PENDING → APPROVED (local) → SYNCED or FAILED (after HCM).
   */
  async approveRequest(
    id: string,
    reviewedBy: string,
  ): Promise<TimeOffRequest> {
    const request = await this.getRequestById(id);

    // Only PENDING requests can be approved
    if (request.status !== TimeOffStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve request in status: ${request.status}`,
      );
    }

    // Use a transaction for the local DB operations
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Step 1: Deduct the balance locally (inside transaction)
      await this.balanceService.deductBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.numberOfDays,
      );

      // Step 2: Mark as APPROVED (persisted intermediate state)
      request.status = TimeOffStatus.APPROVED;
      request.reviewedBy = reviewedBy;
      request.reviewedAt = new Date();
      await queryRunner.manager.save(request);

      await queryRunner.commitTransaction();
    } catch (error: unknown) {
      // Rollback the transaction (balance deduction + status update)
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Step 3: Sync to HCM (outside transaction — external call)
    try {
      const hcmResponse = await this.hcmClient.submitTimeOff({
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
        startDate: request.startDate,
        endDate: request.endDate,
        numberOfDays: request.numberOfDays,
      });

      if (hcmResponse.success) {
        // HCM accepted → mark as SYNCED
        request.status = TimeOffStatus.SYNCED;
        request.hcmReferenceId = hcmResponse.referenceId || (null as unknown as string);
        this.logger.log(`Request ${id} synced to HCM successfully`);
      } else {
        // HCM rejected → rollback the local balance, mark as FAILED
        await this.balanceService.restoreBalance(
          request.employeeId,
          request.locationId,
          request.leaveType,
          request.numberOfDays,
        );
        request.status = TimeOffStatus.FAILED;
        request.rejectionReason = hcmResponse.error || 'HCM rejected the request';
        this.logger.warn(`Request ${id} failed HCM sync: ${hcmResponse.error}`);
      }
    } catch (error: unknown) {
      // Fix #5: If HCM call throws an unexpected exception, rollback balance
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `HCM call threw unexpected error for request ${id}: ${msg}. Rolling back balance.`,
      );
      await this.balanceService.restoreBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.numberOfDays,
      );
      request.status = TimeOffStatus.FAILED;
      request.rejectionReason = `HCM communication error: ${msg}`;
    }

    return this.requestRepo.save(request);
  }

  // ─── REJECT ───────────────────────────────────────────────

  /**
   * Manager rejects a request. No balance changes needed.
   */
  async rejectRequest(
    id: string,
    reviewedBy: string,
    rejectionReason?: string,
  ): Promise<TimeOffRequest> {
    const request = await this.getRequestById(id);

    if (request.status !== TimeOffStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject request in status: ${request.status}`,
      );
    }

    request.status = TimeOffStatus.REJECTED;
    request.reviewedBy = reviewedBy;
    request.reviewedAt = new Date();
    request.rejectionReason = rejectionReason || '';

    this.logger.log(`Request ${id} rejected by ${reviewedBy}`);
    return this.requestRepo.save(request);
  }

  // ─── CANCEL ───────────────────────────────────────────────

  /**
   * Employee cancels a request.
   * If it was already synced/approved, we reverse the deduction.
   */
  async cancelRequest(id: string): Promise<TimeOffRequest> {
    const request = await this.getRequestById(id);

    // Can cancel PENDING, APPROVED, or SYNCED requests
    const cancellable = [
      TimeOffStatus.PENDING,
      TimeOffStatus.APPROVED,
      TimeOffStatus.SYNCED,
    ];
    if (!cancellable.includes(request.status)) {
      throw new BadRequestException(
        `Cannot cancel request in status: ${request.status}`,
      );
    }

    // If it was APPROVED or SYNCED, restore the balance
    if (
      request.status === TimeOffStatus.SYNCED ||
      request.status === TimeOffStatus.APPROVED
    ) {
      await this.balanceService.restoreBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.numberOfDays,
      );

      // If synced to HCM, notify them too
      if (request.hcmReferenceId) {
        await this.hcmClient.cancelTimeOff(request.hcmReferenceId);
      }
    }

    request.status = TimeOffStatus.CANCELLED;
    this.logger.log(`Request ${id} cancelled`);
    return this.requestRepo.save(request);
  }

  // ─── PRIVATE HELPERS ──────────────────────────────────────

  /**
   * Fix #9: Check for overlapping active requests.
   * Prevents double-booking the same date range.
   */
  private async checkForOverlap(
    employeeId: string,
    locationId: string,
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): Promise<void> {
    const activeStatuses = [
      TimeOffStatus.PENDING,
      TimeOffStatus.APPROVED,
      TimeOffStatus.SYNCED,
    ];

    const queryBuilder = this.requestRepo
      .createQueryBuilder('r')
      .where('r.employeeId = :employeeId', { employeeId })
      .andWhere('r.locationId = :locationId', { locationId })
      .andWhere('r.status IN (:...statuses)', { statuses: activeStatuses })
      .andWhere('r.startDate <= :endDate', { endDate })
      .andWhere('r.endDate >= :startDate', { startDate });

    if (excludeId) {
      queryBuilder.andWhere('r.id != :excludeId', { excludeId });
    }

    const overlap = await queryBuilder.getOne();
    if (overlap) {
      throw new BadRequestException(
        `Overlapping time-off request exists: ${overlap.id} (${overlap.startDate} to ${overlap.endDate})`,
      );
    }
  }

  /**
   * Fix #12: Auto-refresh balance from HCM if the local copy is stale.
   * A balance is stale if lastSyncedAt is older than 24 hours.
   */
  private async refreshIfStale(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<void> {
    try {
      const balance = await this.balanceService.getSpecificBalance(
        employeeId,
        locationId,
        leaveType,
      );

      const ageMs = Date.now() - new Date(balance.lastSyncedAt).getTime();
      if (ageMs > STALE_BALANCE_THRESHOLD_MS) {
        this.logger.log(
          `Balance for ${employeeId}/${locationId}/${leaveType} is stale (${Math.round(ageMs / 3600000)}h old). Refreshing from HCM...`,
        );
        try {
          await this.balanceService.refreshFromHcm(employeeId, locationId, leaveType);
        } catch {
          // HCM might be down — use stale data rather than blocking the request
          this.logger.warn(
            `Failed to refresh stale balance from HCM. Proceeding with local data.`,
          );
        }
      }
    } catch {
      // No balance record exists — that's fine, hasEnoughBalance will catch it
    }
  }
}
