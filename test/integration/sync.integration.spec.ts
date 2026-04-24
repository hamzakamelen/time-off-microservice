import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SyncService } from '../../src/modules/sync/sync.service';
import { BalanceService } from '../../src/modules/balance/balance.service';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';
import { HcmClientModule } from '../../src/modules/hcm-client/hcm-client.module';
import { Employee } from '../../src/entities/employee.entity';
import { LeaveBalance } from '../../src/entities/leave-balance.entity';
import { TimeOffRequest } from '../../src/entities/time-off-request.entity';
import { SyncLog } from '../../src/entities/sync-log.entity';

/**
 * Integration tests for SyncService.
 * Tests batch sync with a real database.
 */
describe('SyncService (Integration)', () => {
  let module: TestingModule;
  let syncService: SyncService;
  let balanceService: BalanceService;

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
        TypeOrmModule.forFeature([SyncLog, LeaveBalance]),
        HcmClientModule,
      ],
      providers: [SyncService, BalanceService],
    })
      .overrideProvider(HcmClientService)
      .useValue({
        getAllBalances: jest.fn().mockResolvedValue([
          { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
          { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
        ]),
      })
      .compile();

    syncService = module.get<SyncService>(SyncService);
    balanceService = module.get<BalanceService>(BalanceService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should batch sync and create new balance records', async () => {
    const log = await syncService.processBatchSync([
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
      { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
      { employeeId: 'EMP-003', locationId: 'LOC-TKY', leaveType: 'SICK', balance: 10 },
    ]);

    expect(log.status).toBe('SUCCESS');
    expect(log.recordsProcessed).toBe(3);

    // Verify records exist in DB
    const emp1Balances = await balanceService.getBalancesForEmployee('EMP-001');
    expect(emp1Balances).toHaveLength(1);
    expect(emp1Balances[0].balance).toBe(20);
  });

  it('should update existing balances during batch sync', async () => {
    // Create initial balance
    await balanceService.upsertBalance('EMP-001', 'LOC-NYC', 'ANNUAL', 15);

    // Batch sync with new value
    await syncService.processBatchSync([
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 22 },
    ]);

    // Verify updated
    const balance = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(balance.balance).toBe(22);
  });

  it('should trigger full sync from HCM', async () => {
    const log = await syncService.triggerFullSync();

    expect(log.status).toBe('SUCCESS');
    expect(log.recordsProcessed).toBe(2);

    // Verify records were created
    const emp1 = await balanceService.getSpecificBalance('EMP-001', 'LOC-NYC', 'ANNUAL');
    expect(emp1.balance).toBe(20);
  });

  it('should track sync history', async () => {
    await syncService.processBatchSync([
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
    ]);

    const history = await syncService.getSyncHistory();
    expect(history).toHaveLength(1);
    expect(history[0].syncType).toBe('BATCH');
  });
});
