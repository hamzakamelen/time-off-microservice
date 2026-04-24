import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { LeaveBalance } from '../../entities/leave-balance.entity';
import { HcmClientService } from '../hcm-client/hcm-client.service';

/**
 * Unit tests for BalanceService.
 * All dependencies (Repository, HcmClientService) are mocked.
 */
describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: jest.Mocked<Repository<LeaveBalance>>;
  let hcmClient: jest.Mocked<HcmClientService>;

  // A reusable mock balance object
  const mockBalance: LeaveBalance = {
    id: 'balance-1',
    employeeId: 'EMP-001',
    locationId: 'LOC-NYC',
    leaveType: 'ANNUAL',
    balance: 20,
    lastSyncedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Create mock implementations for all dependencies
    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockHcmClient = {
      getBalance: jest.fn(),
      submitTimeOff: jest.fn(),
      cancelTimeOff: jest.fn(),
      getAllBalances: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: getRepositoryToken(LeaveBalance),
          useValue: mockRepo,
        },
        {
          provide: HcmClientService,
          useValue: mockHcmClient,
        },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepo = module.get(getRepositoryToken(LeaveBalance));
    hcmClient = module.get(HcmClientService);
  });

  // ─── GET BALANCES ───────────────────────────────────────────

  describe('getBalancesForEmployee', () => {
    it('should return all balances for an employee', async () => {
      balanceRepo.find.mockResolvedValue([mockBalance]);

      const result = await service.getBalancesForEmployee('EMP-001');

      expect(result).toEqual([mockBalance]);
      expect(balanceRepo.find).toHaveBeenCalledWith({
        where: { employeeId: 'EMP-001' },
      });
    });

    it('should return empty array when employee has no balances', async () => {
      balanceRepo.find.mockResolvedValue([]);

      const result = await service.getBalancesForEmployee('EMP-999');

      expect(result).toEqual([]);
    });
  });

  describe('getSpecificBalance', () => {
    it('should return a specific balance', async () => {
      balanceRepo.findOne.mockResolvedValue(mockBalance);

      const result = await service.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');

      expect(result).toEqual(mockBalance);
    });

    it('should throw NotFoundException when balance does not exist', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSpecificBalance('EMP-999', 'LOC-X', 'ANNUAL'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── UPSERT BALANCE ────────────────────────────────────────

  describe('upsertBalance', () => {
    it('should update existing balance', async () => {
      const existing = { ...mockBalance };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, balance: 25 });

      const result = await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 25);

      expect(result.balance).toBe(25);
      expect(balanceRepo.save).toHaveBeenCalled();
    });

    it('should create new balance when none exists', async () => {
      balanceRepo.findOne.mockResolvedValue(null);
      const newBalance = { ...mockBalance, balance: 15 };
      balanceRepo.create.mockReturnValue(newBalance);
      balanceRepo.save.mockResolvedValue(newBalance);

      const result = await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 15);

      expect(result.balance).toBe(15);
      expect(balanceRepo.create).toHaveBeenCalled();
    });
  });

  // ─── DEDUCT BALANCE ────────────────────────────────────────

  describe('deductBalance', () => {
    it('should deduct days from balance', async () => {
      const existing = { ...mockBalance, balance: 20 };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, balance: 15 });

      const result = await service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

      expect(result.balance).toBe(15);
    });

    it('should throw BadRequestException when insufficient balance', async () => {
      const existing = { ...mockBalance, balance: 3 };
      balanceRepo.findOne.mockResolvedValue(existing);

      await expect(
        service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException with exact zero balance', async () => {
      const existing = { ...mockBalance, balance: 0 };
      balanceRepo.findOne.mockResolvedValue(existing);

      await expect(
        service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 1),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on optimistic lock failure', async () => {
      const existing = { ...mockBalance, balance: 20 };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockRejectedValue(new Error('Optimistic lock version mismatch'));

      await expect(
        service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow deducting the exact remaining balance', async () => {
      const existing = { ...mockBalance, balance: 5 };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, balance: 0 });

      const result = await service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

      expect(result.balance).toBe(0);
    });
  });

  // ─── RESTORE BALANCE ───────────────────────────────────────

  describe('restoreBalance', () => {
    it('should add days back to balance', async () => {
      const existing = { ...mockBalance, balance: 15 };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, balance: 20 });

      const result = await service.restoreBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

      expect(result.balance).toBe(20);
    });
  });

  // ─── HCM REFRESH ──────────────────────────────────────────

  describe('refreshFromHcm', () => {
    it('should fetch balance from HCM and update local record', async () => {
      hcmClient.getBalance.mockResolvedValue({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        balance: 25,
      });

      // upsertBalance flow: findOne returns existing, save returns updated
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance });
      balanceRepo.save.mockResolvedValue({ ...mockBalance, balance: 25 });

      const result = await service.refreshFromHcm('EMP-001', 'LOC-NYC', 'ANNUAL');

      expect(hcmClient.getBalance).toHaveBeenCalledWith('EMP-001', 'LOC-NYC', 'ANNUAL');
      expect(result.balance).toBe(25);
    });

    it('should propagate HCM errors', async () => {
      hcmClient.getBalance.mockRejectedValue(new Error('HCM is down'));

      await expect(
        service.refreshFromHcm('EMP-001', 'LOC-NYC', 'ANNUAL'),
      ).rejects.toThrow('HCM is down');
    });
  });

  // ─── HAS ENOUGH BALANCE ───────────────────────────────────

  describe('hasEnoughBalance', () => {
    it('should return true when balance is sufficient', async () => {
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, balance: 10 });

      const result = await service.hasEnoughBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

      expect(result).toBe(true);
    });

    it('should return false when balance is insufficient', async () => {
      balanceRepo.findOne.mockResolvedValue({ ...mockBalance, balance: 3 });

      const result = await service.hasEnoughBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

      expect(result).toBe(false);
    });

    it('should return false when no balance record exists', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      const result = await service.hasEnoughBalance('EMP-999', 'LOC-X', 'ANNUAL', 1);

      expect(result).toBe(false);
    });
  });
});
