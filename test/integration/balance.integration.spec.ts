import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BalanceService } from '../../src/modules/balance/balance.service';
import { BalanceModule } from '../../src/modules/balance/balance.module';
import { HcmClientModule } from '../../src/modules/hcm-client/hcm-client.module';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';
import { LeaveBalance } from '../../src/entities/leave-balance.entity';
import { Employee } from '../../src/entities/employee.entity';
import { TimeOffRequest } from '../../src/entities/time-off-request.entity';
import { SyncLog } from '../../src/entities/sync-log.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Integration tests for BalanceService.
 * Uses a REAL in-memory SQLite database (not mocked).
 */
describe('BalanceService (Integration)', () => {
  let module: TestingModule;
  let service: BalanceService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Employee, LeaveBalance, TimeOffRequest, SyncLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([LeaveBalance]),
        HcmClientModule,
      ],
      providers: [BalanceService],
    })
      // Override HCM client to avoid real HTTP calls
      .overrideProvider(HcmClientService)
      .useValue({
        getBalance: jest.fn().mockResolvedValue({
          employeeId: 'EMP-001',
          locationId: 'LOC-NYC',
          leaveType: 'ANNUAL',
          balance: 30,
        }),
      })
      .compile();

    service = module.get<BalanceService>(BalanceService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should create a new balance record in the database', async () => {
    const balance = await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);

    expect(balance.id).toBeDefined();
    expect(balance.employeeId).toBe('EMP-001');
    expect(balance.balance).toBe(20);
  });

  it('should update an existing balance record', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);
    const updated = await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 25);

    expect(updated.balance).toBe(25);

    // Verify only one record exists
    const allBalances = await service.getBalancesForEmployee('EMP-001');
    expect(allBalances).toHaveLength(1);
  });

  it('should deduct balance from the database', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);
    const deducted = await service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

    expect(deducted.balance).toBe(15);

    // Verify the database was actually updated
    const fresh = await service.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(fresh.balance).toBe(15);
  });

  it('should reject deduction when balance is insufficient', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 3);

    await expect(
      service.deductBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5),
    ).rejects.toThrow(BadRequestException);
  });

  it('should restore balance correctly', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 15);
    const restored = await service.restoreBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 5);

    expect(restored.balance).toBe(20);
  });

  it('should handle multiple balances per employee (different locations)', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);
    await service.upsertBalance('EMP-001', 'LOC-LDN', 'ANNUAL', 15);

    const allBalances = await service.getBalancesForEmployee('EMP-001');
    expect(allBalances).toHaveLength(2);
  });

  it('should handle multiple leave types at same location', async () => {
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'SICK', 10);
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'PERSONAL', 5);

    const balances = await service.getBalancesAtLocation('EMP-001', 'LOC-NYC');
    expect(balances).toHaveLength(3);
  });

  it('should throw NotFoundException for non-existent balance', async () => {
    await expect(
      service.getSpecificBalance('EMP-999', 'LOC-X', 'ANNUAL'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should refresh balance from HCM and update local record', async () => {
    // First create a local record
    await service.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 20);

    // Refresh from HCM (mock returns 30)
    const refreshed = await service.refreshFromHcm('EMP-001', 'LOC-NYC', 'ANNUAL');

    expect(refreshed.balance).toBe(30);
  });
});
