import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TimeOffService } from '../../src/modules/time-off/time-off.service';
import { TimeOffModule } from '../../src/modules/time-off/time-off.module';
import { BalanceModule } from '../../src/modules/balance/balance.module';
import { BalanceService } from '../../src/modules/balance/balance.service';
import { HcmClientModule } from '../../src/modules/hcm-client/hcm-client.module';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';
import { Employee } from '../../src/entities/employee.entity';
import { LeaveBalance } from '../../src/entities/leave-balance.entity';
import { TimeOffRequest, TimeOffStatus } from '../../src/entities/time-off-request.entity';
import { SyncLog } from '../../src/entities/sync-log.entity';
import { BadRequestException } from '@nestjs/common';

/**
 * Integration tests for TimeOffService.
 * Tests the full request lifecycle with real database operations.
 */
describe('TimeOffService (Integration)', () => {
  let module: TestingModule;
  let timeOffService: TimeOffService;
  let balanceService: BalanceService;
  let hcmClient: jest.Mocked<HcmClientService>;

  const mockHcmClient = {
    getBalance: jest.fn(),
    submitTimeOff: jest.fn(),
    cancelTimeOff: jest.fn(),
    getAllBalances: jest.fn(),
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    mockHcmClient.submitTimeOff.mockResolvedValue({
      success: true,
      referenceId: 'HCM-REF-001',
    });
    mockHcmClient.cancelTimeOff.mockResolvedValue({ success: true });

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Employee, LeaveBalance, TimeOffRequest, SyncLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([TimeOffRequest, LeaveBalance]),
        HcmClientModule,
      ],
      providers: [TimeOffService, BalanceService],
    })
      .overrideProvider(HcmClientService)
      .useValue(mockHcmClient)
      .compile();

    timeOffService = module.get<TimeOffService>(TimeOffService);
    balanceService = module.get<BalanceService>(BalanceService);
    hcmClient = module.get(HcmClientService);

    // Seed a balance for testing
    await balanceService.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);
  });

  afterEach(async () => {
    await module.close();
  });

  // ─── FULL LIFECYCLE ────────────────────────────────────────

  it('should complete the full lifecycle: create → approve → synced', async () => {
    // Step 1: Create request
    const request = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 3,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      reason: 'Summer vacation',
    });
    expect(request.status).toBe(TimeOffStatus.PENDING);

    // Step 2: Approve (triggers balance deduction + HCM sync)
    const approved = await timeOffService.approveRequest(request.id, 'MGR-001');
    expect(approved.status).toBe(TimeOffStatus.SYNCED);
    expect(approved.hcmReferenceId).toBe('HCM-REF-001');

    // Step 3: Verify balance was deducted
    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(17); // 20 - 3
  });

  it('should rollback balance when HCM rejects during approval', async () => {
    hcmClient.submitTimeOff.mockResolvedValue({
      success: false,
      error: 'HCM: Insufficient balance',
    });

    const request = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 3,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    });

    const result = await timeOffService.approveRequest(request.id, 'MGR-001');
    expect(result.status).toBe(TimeOffStatus.FAILED);

    // Balance should be restored
    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(20); // Original balance restored
  });

  it('should restore balance when a synced request is cancelled', async () => {
    const request = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 5,
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });

    // Approve (balance goes to 15)
    await timeOffService.approveRequest(request.id, 'MGR-001');

    // Cancel (balance should go back to 20)
    const cancelled = await timeOffService.cancelRequest(request.id);
    expect(cancelled.status).toBe(TimeOffStatus.CANCELLED);

    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(20);
  });

  it('should reject request without changing balance', async () => {
    const request = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 3,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
    });

    const rejected = await timeOffService.rejectRequest(
      request.id,
      'MGR-001',
      'Not enough team coverage',
    );
    expect(rejected.status).toBe(TimeOffStatus.REJECTED);

    // Balance should remain unchanged
    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(20);
  });

  it('should prevent creating request with insufficient balance', async () => {
    await expect(
      timeOffService.createRequest({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        numberOfDays: 25, // More than 20
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should handle multiple sequential requests correctly', async () => {
    // Request 1: 5 days (balance: 20 → 15)
    const req1 = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 5,
      startDate: '2026-06-01',
      endDate: '2026-06-05',
    });
    await timeOffService.approveRequest(req1.id, 'MGR-001');

    // Request 2: 10 days (balance: 15 → 5)
    const req2 = await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    });
    await timeOffService.approveRequest(req2.id, 'MGR-001');

    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(5); // 20 - 5 - 10

    // Request 3: 6 days — should fail (only 5 left)
    await expect(
      timeOffService.createRequest({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        numberOfDays: 6,
        startDate: '2026-08-01',
        endDate: '2026-08-06',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should list requests for an employee', async () => {
    await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 2,
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });
    await timeOffService.createRequest({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      numberOfDays: 3,
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    });

    const requests = await timeOffService.getRequestsByEmployee('EMP-001');
    expect(requests).toHaveLength(2);
  });
});
