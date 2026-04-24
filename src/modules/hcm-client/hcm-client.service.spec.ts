import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { HcmClientService } from './hcm-client.service';

/**
 * Unit tests for HcmClientService.
 * Tests HTTP calls, error handling, retry logic, and response mapping.
 */
describe('HcmClientService', () => {
  let service: HcmClientService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'HCM_BASE_URL') return 'http://localhost:3001/api/hcm';
        if (key === 'HCM_MAX_RETRIES') return '1'; // 1 retry = 2 total attempts
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmClientService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<HcmClientService>(HcmClientService);
    httpService = module.get(HttpService);
  });

  // ─── GET BALANCE ───────────────────────────────────────────

  describe('getBalance', () => {
    it('should fetch a single balance from HCM', async () => {
      const balanceData = {
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        balance: 20,
      };
      httpService.get.mockReturnValue(of({ data: balanceData } as any));

      const result = await service.getBalance('EMP-001', 'LOC-NYC', 'ANNUAL');

      expect(result).toEqual(balanceData);
    });

    it('should retry on transient failure then succeed', async () => {
      const balanceData = {
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        balance: 20,
      };
      httpService.get
        .mockReturnValueOnce(throwError(() => new Error('Connection refused')))
        .mockReturnValueOnce(of({ data: balanceData } as any));

      const result = await service.getBalance('EMP-001', 'LOC-NYC', 'ANNUAL');

      expect(result).toEqual(balanceData);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('should throw after all retries exhausted', async () => {
      httpService.get.mockReturnValue(
        throwError(() => new Error('Connection refused')),
      );

      await expect(
        service.getBalance('EMP-001', 'LOC-NYC', 'ANNUAL'),
      ).rejects.toThrow('HCM balance fetch failed');
    });

    it('should not retry on 4xx client errors', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({
          response: { status: 404, data: { error: 'Not found' } },
        })),
      );

      await expect(
        service.getBalance('EMP-001', 'LOC-NYC', 'ANNUAL'),
      ).rejects.toBeDefined();

      expect(httpService.get).toHaveBeenCalledTimes(1);
    });
  });

  // ─── SUBMIT TIME-OFF ──────────────────────────────────────

  describe('submitTimeOff', () => {
    it('should submit time-off and return success', async () => {
      const response = { success: true, referenceId: 'HCM-REF-001' };
      httpService.post.mockReturnValue(of({ data: response } as any));

      const result = await service.submitTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      });

      expect(result.success).toBe(true);
      expect(result.referenceId).toBe('HCM-REF-001');
    });

    it('should return failure when HCM responds with error', async () => {
      const error = {
        response: { status: 400, data: { error: 'Insufficient balance' } },
      };
      httpService.post.mockReturnValue(throwError(() => error));

      const result = await service.submitTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient balance');
    });

    it('should handle network errors gracefully', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      const result = await service.submitTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HCM communication failed');
    });
  });

  // ─── CANCEL TIME-OFF ──────────────────────────────────────

  describe('cancelTimeOff', () => {
    it('should cancel time-off in HCM', async () => {
      httpService.delete.mockReturnValue(of({ data: { success: true } } as any));

      const result = await service.cancelTimeOff('HCM-REF-001');

      expect(result.success).toBe(true);
    });

    it('should handle cancellation failure', async () => {
      httpService.delete.mockReturnValue(
        throwError(() => new Error('Not found')),
      );

      const result = await service.cancelTimeOff('HCM-REF-999');

      expect(result.success).toBe(false);
    });
  });

  // ─── GET ALL BALANCES ─────────────────────────────────────

  describe('getAllBalances', () => {
    it('should fetch all balances for batch sync', async () => {
      const allBalances = [
        { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
        { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
      ];
      httpService.get.mockReturnValue(of({ data: allBalances } as any));

      const result = await service.getAllBalances();

      expect(result).toEqual(allBalances);
      expect(result).toHaveLength(2);
    });

    it('should throw when batch fetch fails after retries', async () => {
      httpService.get.mockReturnValue(
        throwError(() => new Error('HCM timeout')),
      );

      await expect(service.getAllBalances()).rejects.toThrow(
        'HCM batch balance fetch failed',
      );
    });
  });
});
