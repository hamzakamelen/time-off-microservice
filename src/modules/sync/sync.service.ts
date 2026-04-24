import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncLog } from '../../entities/sync-log.entity.js';
import { BalanceService } from '../balance/balance.service.js';
import { HcmClientService } from '../hcm-client/hcm-client.service.js';
import { BatchBalanceItemDto } from './dto/batch-sync.dto.js';

/** Details of a single balance change during sync. */
interface SyncChangeRecord {
  employeeId: string;
  locationId: string;
  leaveType: string;
  oldBalance: number | null; // null = new record
  newBalance: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClientService,
  ) {}

  /**
   * Process a batch sync from HCM.
   * HCM sends us ALL current balances — we upsert each one locally.
   * Fix #11: Now tracks old vs new balance values for audit.
   */
  async processBatchSync(balances: BatchBalanceItemDto[]): Promise<SyncLog> {
    const log = this.syncLogRepo.create({
      syncType: 'BATCH',
      status: 'IN_PROGRESS',
      recordsProcessed: 0,
      recordsFailed: 0,
    });
    await this.syncLogRepo.save(log);

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];
    const changes: SyncChangeRecord[] = [];

    for (const item of balances) {
      try {
        // Capture old balance for audit (null if new record)
        let oldBalance: number | null = null;
        try {
          const existing = await this.balanceService.getSpecificBalance(
            item.employeeId,
            item.locationId,
            item.leaveType,
          );
          oldBalance = existing.balance;
        } catch {
          // No existing record — this is a new balance
        }

        await this.balanceService.upsertBalance(
          item.employeeId,
          item.locationId,
          item.leaveType,
          item.balance,
        );

        // Only record if the value actually changed or is new
        if (oldBalance === null || oldBalance !== item.balance) {
          changes.push({
            employeeId: item.employeeId,
            locationId: item.locationId,
            leaveType: item.leaveType,
            oldBalance,
            newBalance: item.balance,
          });
        }

        processed++;
      } catch (error: unknown) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(
          `Failed to sync ${item.employeeId}/${item.locationId}: ${msg}`,
        );
        this.logger.error(
          `Batch sync failed for ${item.employeeId}/${item.locationId}: ${msg}`,
        );
      }
    }

    // Update the sync log with results and change details
    log.recordsProcessed = processed;
    log.recordsFailed = failed;
    log.status = failed === 0 ? 'SUCCESS' : failed < balances.length ? 'PARTIAL' : 'FAILED';
    log.details = JSON.stringify({ errors, changes });
    log.completedAt = new Date();

    await this.syncLogRepo.save(log);
    this.logger.log(
      `Batch sync completed: ${processed} processed, ${failed} failed, ${changes.length} changed`,
    );

    return log;
  }

  /**
   * Trigger a full sync by pulling all balances from HCM.
   */
  async triggerFullSync(): Promise<SyncLog> {
    this.logger.log('Triggering full sync from HCM...');

    try {
      const hcmBalances = await this.hcmClient.getAllBalances();
      return this.processBatchSync(hcmBalances);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      // Log the failed attempt
      const log = this.syncLogRepo.create({
        syncType: 'BATCH',
        status: 'FAILED',
        details: JSON.stringify({ error: msg }),
        recordsProcessed: 0,
        recordsFailed: 0,
        completedAt: new Date(),
      });
      await this.syncLogRepo.save(log);
      this.logger.error(`Full sync failed: ${msg}`);
      return log;
    }
  }

  /**
   * Get the latest sync log entries.
   */
  async getSyncHistory(limit: number = 10): Promise<SyncLog[]> {
    return this.syncLogRepo.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get the most recent sync status.
   */
  async getLatestSyncStatus(): Promise<SyncLog | null> {
    const results = await this.syncLogRepo.find({
      order: { startedAt: 'DESC' },
      take: 1,
    });
    return results.length > 0 ? results[0] : null;
  }
}
