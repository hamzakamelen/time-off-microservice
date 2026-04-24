import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TimeOffService } from './time-off.service';
import { TimeOffRequest, TimeOffStatus } from '../../entities/time-off-request.entity';
import { BalanceService } from '../balance/balance.service';
import { HcmClientService } from '../hcm-client/hcm-client.service';

/**
 * Unit tests for TimeOffService.
 * Tests the full request lifecycle: create, approve, reject, cancel.
 * Updated for: transactions, APPROVED state, overlap check, stale balance refresh.
 */
describe('TimeOffService', () => {
  let service: TimeOffService;
  let requestRepo: jest.Mocked<Repository<TimeOffRequest>>;
  let balanceService: jest.Mocked<BalanceService>;
  let hcmClient: jest.Mocked<HcmClientService>;
  let mockQueryRunner: any;

  // Reusable mock request
  const mockRequest: TimeOffRequest = {
    id: 'req-1',
    employeeId: 'EMP-001',
    locationId: 'LOC-NYC',
    leaveType: 'ANNUAL',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    numberOfDays: 3,
    status: TimeOffStatus.PENDING,
    reason: 'Vacation',
    reviewedBy: null as unknown as string,
    reviewedAt: null as unknown as Date,
    hcmReferenceId: null as unknown as string,
    rejectionReason: null as unknown as string,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn().mockImplementation(async (entity) => entity),
      },
    };

    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null), // No overlaps by default
      }),
    };

    const mockBalanceService = {
      hasEnoughBalance: jest.fn(),
      deductBalance: jest.fn(),
      restoreBalance: jest.fn(),
      getSpecificBalance: jest.fn().mockRejectedValue(new Error('not found')), // No stale check by default
      refreshFromHcm: jest.fn(),
    };

    const mockHcmClient = {
      submitTimeOff: jest.fn(),
      cancelTimeOff: jest.fn(),
      getBalance: jest.fn(),
      getAllBalances: jest.fn(),
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        { provide: getRepositoryToken(TimeOffRequest), useValue: mockRepo },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: HcmClientService, useValue: mockHcmClient },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
    requestRepo = module.get(getRepositoryToken(TimeOffRequest));
    balanceService = module.get(BalanceService);
    hcmClient = module.get(HcmClientService);
  });

  // ─── CREATE REQUEST ────────────────────────────────────────

  describe('createRequest', () => {
    it('should create a time-off request in PENDING status', async () => {
      balanceService.hasEnoughBalance.mockResolvedValue(true);
      requestRepo.create.mockReturnValue({ ...mockRequest });
      requestRepo.save.mockResolvedValue({ ...mockRequest });

      const result = await service.createRequest({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
        reason: 'Vacation',
      });

      expect(result.status).toBe(TimeOffStatus.PENDING);
      expect(balanceService.hasEnoughBalance).toHaveBeenCalledWith(
        'EMP-001', 'LOC-NYC', 'ANNUAL', 3,
      );
    });

    it('should throw BadRequestException when balance is insufficient', async () => {
      balanceService.hasEnoughBalance.mockResolvedValue(false);

      await expect(
        service.createRequest({
          employeeId: 'EMP-001',
          locationId: 'LOC-NYC',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          numberOfDays: 3,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use ANNUAL as default leave type', async () => {
      balanceService.hasEnoughBalance.mockResolvedValue(true);
      requestRepo.create.mockReturnValue({ ...mockRequest });
      requestRepo.save.mockResolvedValue({ ...mockRequest });

      await service.createRequest({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      });

      expect(requestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ leaveType: 'ANNUAL' }),
      );
    });

    it('should throw when overlapping request exists', async () => {
      balanceService.hasEnoughBalance.mockResolvedValue(true);

      // Mock overlap detection to return a conflicting request
      requestRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'existing-req',
          startDate: '2026-06-02',
          endDate: '2026-06-04',
        }),
      } as any);

      await expect(
        service.createRequest({
          employeeId: 'EMP-001',
          locationId: 'LOC-NYC',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          numberOfDays: 3,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── GET REQUEST ───────────────────────────────────────────

  describe('getRequestById', () => {
    it('should return request by ID', async () => {
      requestRepo.findOne.mockResolvedValue(mockRequest);

      const result = await service.getRequestById('req-1');

      expect(result).toEqual(mockRequest);
    });

    it('should throw NotFoundException for non-existent request', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.getRequestById('req-999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── APPROVE REQUEST ──────────────────────────────────────

  describe('approveRequest', () => {
    it('should approve, set to APPROVED, then sync to HCM → SYNCED', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      balanceService.deductBalance.mockResolvedValue({} as any);
      hcmClient.submitTimeOff.mockResolvedValue({
        success: true,
        referenceId: 'HCM-REF-001',
      });
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);

      const result = await service.approveRequest('req-1', 'MGR-001');

      expect(result.status).toBe(TimeOffStatus.SYNCED);
      expect(result.hcmReferenceId).toBe('HCM-REF-001');
      expect(result.reviewedBy).toBe('MGR-001');
      expect(balanceService.deductBalance).toHaveBeenCalled();
      // Verify transaction was used
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should rollback balance when HCM rejects', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      balanceService.deductBalance.mockResolvedValue({} as any);
      hcmClient.submitTimeOff.mockResolvedValue({
        success: false,
        error: 'Insufficient balance in HCM',
      });
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);

      const result = await service.approveRequest('req-1', 'MGR-001');

      expect(result.status).toBe(TimeOffStatus.FAILED);
      expect(balanceService.restoreBalance).toHaveBeenCalledWith(
        'EMP-001', 'LOC-NYC', 'ANNUAL', 3,
      );
    });

    it('should rollback balance when HCM call throws unexpected error', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      balanceService.deductBalance.mockResolvedValue({} as any);
      hcmClient.submitTimeOff.mockRejectedValue(new Error('Network timeout'));
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);

      const result = await service.approveRequest('req-1', 'MGR-001');

      expect(result.status).toBe(TimeOffStatus.FAILED);
      expect(result.rejectionReason).toContain('Network timeout');
      expect(balanceService.restoreBalance).toHaveBeenCalled();
    });

    it('should throw when trying to approve non-PENDING request', async () => {
      const approved = { ...mockRequest, status: TimeOffStatus.SYNCED };
      requestRepo.findOne.mockResolvedValue(approved);

      await expect(
        service.approveRequest('req-1', 'MGR-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when trying to approve a REJECTED request', async () => {
      const rejected = { ...mockRequest, status: TimeOffStatus.REJECTED };
      requestRepo.findOne.mockResolvedValue(rejected);

      await expect(
        service.approveRequest('req-1', 'MGR-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should rollback transaction when deductBalance fails', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      balanceService.deductBalance.mockRejectedValue(new Error('DB error'));

      await expect(
        service.approveRequest('req-1', 'MGR-001'),
      ).rejects.toThrow();

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  // ─── REJECT REQUEST ───────────────────────────────────────

  describe('rejectRequest', () => {
    it('should reject a PENDING request', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);

      const result = await service.rejectRequest('req-1', 'MGR-001', 'Not enough coverage');

      expect(result.status).toBe(TimeOffStatus.REJECTED);
      expect(result.rejectionReason).toBe('Not enough coverage');
      expect(result.reviewedBy).toBe('MGR-001');
    });

    it('should throw when trying to reject non-PENDING request', async () => {
      const synced = { ...mockRequest, status: TimeOffStatus.SYNCED };
      requestRepo.findOne.mockResolvedValue(synced);

      await expect(
        service.rejectRequest('req-1', 'MGR-001'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── CANCEL REQUEST ───────────────────────────────────────

  describe('cancelRequest', () => {
    it('should cancel a PENDING request (no balance change)', async () => {
      const pending = { ...mockRequest, status: TimeOffStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(pending);
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);

      const result = await service.cancelRequest('req-1');

      expect(result.status).toBe(TimeOffStatus.CANCELLED);
      expect(balanceService.restoreBalance).not.toHaveBeenCalled();
    });

    it('should cancel an APPROVED request and restore balance', async () => {
      const approved = { ...mockRequest, status: TimeOffStatus.APPROVED };
      requestRepo.findOne.mockResolvedValue(approved);
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);
      balanceService.restoreBalance.mockResolvedValue({} as any);

      const result = await service.cancelRequest('req-1');

      expect(result.status).toBe(TimeOffStatus.CANCELLED);
      expect(balanceService.restoreBalance).toHaveBeenCalledWith(
        'EMP-001', 'LOC-NYC', 'ANNUAL', 3,
      );
    });

    it('should cancel a SYNCED request and restore balance + notify HCM', async () => {
      const synced = {
        ...mockRequest,
        status: TimeOffStatus.SYNCED,
        hcmReferenceId: 'HCM-REF-001',
      };
      requestRepo.findOne.mockResolvedValue(synced);
      requestRepo.save.mockImplementation(async (req) => req as TimeOffRequest);
      balanceService.restoreBalance.mockResolvedValue({} as any);
      hcmClient.cancelTimeOff.mockResolvedValue({ success: true });

      const result = await service.cancelRequest('req-1');

      expect(result.status).toBe(TimeOffStatus.CANCELLED);
      expect(balanceService.restoreBalance).toHaveBeenCalledWith(
        'EMP-001', 'LOC-NYC', 'ANNUAL', 3,
      );
      expect(hcmClient.cancelTimeOff).toHaveBeenCalledWith('HCM-REF-001');
    });

    it('should throw when trying to cancel a REJECTED request', async () => {
      const rejected = { ...mockRequest, status: TimeOffStatus.REJECTED };
      requestRepo.findOne.mockResolvedValue(rejected);

      await expect(service.cancelRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when trying to cancel a FAILED request', async () => {
      const failed = { ...mockRequest, status: TimeOffStatus.FAILED };
      requestRepo.findOne.mockResolvedValue(failed);

      await expect(service.cancelRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
