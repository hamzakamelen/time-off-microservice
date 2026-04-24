import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncService } from './sync.service';
import { SyncLog } from '../../entities/sync-log.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';

/**
 * Unit tests for SyncService.
 * Tests batch sync processing, full sync trigger, sync history, and audit tracking.
 */
describe('SyncService', () => {
  let service: SyncService;
  let syncLogRepo: jest.Mocked<Repository<SyncLog>>;
  let balanceService: jest.Mocked<BalanceService>;
  let hcmClient: jest.Mocked<HcmClientService>;

  beforeEach(async () => {
    const mockSyncLogRepo = {
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ id: 'log-1', ...data })),
      save: jest.fn().mockImplementation(async (data) => data),
    };

    const mockBalanceService = {
      upsertBalance: jest.fn(),
      getSpecificBalance: jest.fn(),
    };

    const mockHcmClient = {
      getAllBalances: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(SyncLog), useValue: mockSyncLogRepo },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: HcmClientService, useValue: mockHcmClient },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    syncLogRepo = module.get(getRepositoryToken(SyncLog));
    balanceService = module.get(BalanceService);
    hcmClient = module.get(HcmClientService);
  });

  // ─── BATCH SYNC ────────────────────────────────────────────

  describe('processBatchSync', () => {
    it('should process all balances successfully', async () => {
      const balances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
        { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
      ];
      balanceService.getSpecificBalance.mockRejectedValue(new Error('not found'));
      balanceService.upsertBalance.mockResolvedValue({} as any);

      const result = await service.processBatchSync(balances);

      expect(result.status).toBe('SUCCESS');
      expect(result.recordsProcessed).toBe(2);
      expect(result.recordsFailed).toBe(0);
      expect(balanceService.upsertBalance).toHaveBeenCalledTimes(2);
    });

    it('should handle partial failures gracefully', async () => {
      const balances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
        { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
      ];

      balanceService.getSpecificBalance.mockRejectedValue(new Error('not found'));
      balanceService.upsertBalance
        .mockResolvedValueOnce({} as any) // First succeeds
        .mockRejectedValueOnce(new Error('DB error')); // Second fails

      const result = await service.processBatchSync(balances);

      expect(result.status).toBe('PARTIAL');
      expect(result.recordsProcessed).toBe(1);
      expect(result.recordsFailed).toBe(1);
    });

    it('should mark as FAILED when all records fail', async () => {
      const balances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
      ];
      balanceService.getSpecificBalance.mockRejectedValue(new Error('not found'));
      balanceService.upsertBalance.mockRejectedValue(new Error('DB error'));

      const result = await service.processBatchSync(balances);

      expect(result.status).toBe('FAILED');
      expect(result.recordsFailed).toBe(1);
    });

    it('should handle empty batch', async () => {
      const result = await service.processBatchSync([]);

      expect(result.status).toBe('SUCCESS');
      expect(result.recordsProcessed).toBe(0);
    });

    it('should track old vs new balance values in audit details', async () => {
      const balances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 25 },
      ];
      // Old balance was 20, new is 25
      balanceService.getSpecificBalance.mockResolvedValue({ balance: 20 } as any);
      balanceService.upsertBalance.mockResolvedValue({} as any);

      const result = await service.processBatchSync(balances);

      const details = JSON.parse(result.details);
      expect(details.changes).toHaveLength(1);
      expect(details.changes[0]).toEqual({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        oldBalance: 20,
        newBalance: 25,
      });
    });

    it('should not log unchanged balances in audit', async () => {
      const balances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
      ];
      // Same balance — no change
      balanceService.getSpecificBalance.mockResolvedValue({ balance: 20 } as any);
      balanceService.upsertBalance.mockResolvedValue({} as any);

      const result = await service.processBatchSync(balances);

      const details = JSON.parse(result.details);
      expect(details.changes).toHaveLength(0); // No changes recorded
    });
  });

  // ─── FULL SYNC ─────────────────────────────────────────────

  describe('triggerFullSync', () => {
    it('should fetch from HCM and process batch', async () => {
      const hcmBalances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
      ];
      hcmClient.getAllBalances.mockResolvedValue(hcmBalances);
      balanceService.getSpecificBalance.mockRejectedValue(new Error('not found'));
      balanceService.upsertBalance.mockResolvedValue({} as any);

      const result = await service.triggerFullSync();

      expect(hcmClient.getAllBalances).toHaveBeenCalled();
      expect(result.status).toBe('SUCCESS');
    });

    it('should log failure when HCM is unreachable', async () => {
      hcmClient.getAllBalances.mockRejectedValue(new Error('Connection refused'));

      const result = await service.triggerFullSync();

      expect(result.status).toBe('FAILED');
      expect(result.details).toContain('Connection refused');
    });
  });

  // ─── SYNC HISTORY ─────────────────────────────────────────

  describe('getSyncHistory', () => {
    it('should return sync logs ordered by startedAt DESC', async () => {
      const logs = [{ id: 'log-1' }, { id: 'log-2' }] as SyncLog[];
      syncLogRepo.find.mockResolvedValue(logs);

      const result = await service.getSyncHistory(5);

      expect(result).toEqual(logs);
      expect(syncLogRepo.find).toHaveBeenCalledWith({
        order: { startedAt: 'DESC' },
        take: 5,
      });
    });
  });

  describe('getLatestSyncStatus', () => {
    it('should return the most recent sync log', async () => {
      const log = { id: 'log-1' } as SyncLog;
      syncLogRepo.find.mockResolvedValue([log]);

      const result = await service.getLatestSyncStatus();

      expect(result).toEqual(log);
    });

    it('should return null when no syncs have occurred', async () => {
      syncLogRepo.find.mockResolvedValue([]);

      const result = await service.getLatestSyncStatus();

      expect(result).toBeNull();
    });
  });
});
