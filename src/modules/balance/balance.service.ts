import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveBalance } from '../../entities/leave-balance.entity.js';
import { HcmClientService } from '../hcm-client/hcm-client.service.js';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    private readonly hcmClient: HcmClientService,
  ) {}

  // ─── READ OPERATIONS ──────────────────────────────────────

  /**
   * Get all balance records in the system.
   */
  async getAllBalances(): Promise<LeaveBalance[]> {
    return this.balanceRepo.find({ order: { employeeId: 'ASC', locationId: 'ASC' } });
  }

  /**
   * Get all balances for an employee across all locations.
   */
  async getBalancesForEmployee(employeeId: string): Promise<LeaveBalance[]> {
    return this.balanceRepo.find({ where: { employeeId } });
  }

  /**
   * Get balances for an employee at a specific location.
   */
  async getBalancesAtLocation(
    employeeId: string,
    locationId: string,
  ): Promise<LeaveBalance[]> {
    return this.balanceRepo.find({ where: { employeeId, locationId } });
  }

  /**
   * Get a single balance for a specific (employee, location, leaveType) combo.
   * Throws NotFoundException if no balance exists.
   */
  async getSpecificBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<LeaveBalance> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (!balance) {
      throw new NotFoundException(
        `No balance found for employee ${employeeId} at location ${locationId} (${leaveType})`,
      );
    }

    return balance;
  }

  // ─── WRITE OPERATIONS ─────────────────────────────────────

  /**
   * Create or update a balance record.
   * Used by batch sync and manual operations.
   */
  async upsertBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    balance: number,
  ): Promise<LeaveBalance> {
    let existing = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (existing) {
      existing.balance = balance;
      existing.lastSyncedAt = new Date();
      return this.balanceRepo.save(existing);
    }

    // Create new balance record
    existing = this.balanceRepo.create({
      employeeId,
      locationId,
      leaveType,
      balance,
      lastSyncedAt: new Date(),
    });

    return this.balanceRepo.save(existing);
  }

  /**
   * Deduct days from a balance using optimistic locking.
   * If another request modified the balance concurrently, this throws ConflictException.
   */
  async deductBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<LeaveBalance> {
    const balance = await this.getSpecificBalance(
      employeeId,
      locationId,
      leaveType,
    );

    if (balance.balance < days) {
      throw new BadRequestException(
        `Insufficient balance: have ${balance.balance} days, need ${days} days`,
      );
    }

    balance.balance -= days;

    try {
      // TypeORM's optimistic locking: if `version` has changed since we read it,
      // this save will fail — meaning another request modified the balance first.
      return await this.balanceRepo.save(balance);
    } catch (error: unknown) {
      this.logger.warn(
        `Optimistic lock conflict for employee ${employeeId}: ${String(error)}`,
      );
      throw new ConflictException(
        'Balance was modified by another request. Please retry.',
      );
    }
  }

  /**
   * Restore days back to a balance (e.g., after cancellation or HCM rejection).
   */
  async restoreBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<LeaveBalance> {
    const balance = await this.getSpecificBalance(
      employeeId,
      locationId,
      leaveType,
    );
    balance.balance += days;
    return this.balanceRepo.save(balance);
  }

  // ─── HCM SYNC OPERATIONS ─────────────────────────────────

  /**
   * Fetch the latest balance from HCM and update our local record.
   */
  async refreshFromHcm(
    employeeId: string,
    locationId: string,
    leaveType: string = 'ANNUAL',
  ): Promise<LeaveBalance> {
    this.logger.log(
      `Refreshing balance from HCM for ${employeeId}/${locationId}/${leaveType}`,
    );

    const hcmBalance = await this.hcmClient.getBalance(
      employeeId,
      locationId,
      leaveType,
    );

    return this.upsertBalance(
      employeeId,
      locationId,
      leaveType,
      hcmBalance.balance,
    );
  }

  /**
   * Check if an employee has enough balance locally (defensive pre-check).
   */
  async hasEnoughBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    requiredDays: number,
  ): Promise<boolean> {
    try {
      const balance = await this.getSpecificBalance(
        employeeId,
        locationId,
        leaveType,
      );
      return balance.balance >= requiredDays;
    } catch {
      return false; // No balance record means no balance
    }
  }
}
