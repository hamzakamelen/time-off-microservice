import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';

/**
 * E2E test: Balance sync operations via HTTP.
 * Tests batch sync, balance refresh, and independent HCM balance changes.
 */
describe('Balance Sync (E2E)', () => {
  let app: INestApplication;

  const mockHcmClient = {
    getBalance: jest.fn().mockResolvedValue({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      leaveType: 'ANNUAL',
      balance: 30, // HCM says 30 (e.g., after anniversary bonus)
    }),
    submitTimeOff: jest.fn().mockResolvedValue({ success: true, referenceId: 'REF-1' }),
    cancelTimeOff: jest.fn().mockResolvedValue({ success: true }),
    getAllBalances: jest.fn().mockResolvedValue([
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 22 },
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'SICK', balance: 10 },
      { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 18 },
    ]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HcmClientService)
      .useValue(mockHcmClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── BATCH SYNC ────────────────────────────────────────────

  it('should process a batch sync from HCM', async () => {
    const server = app.getHttpServer();

    const res = await supertest(server)
      .post('/sync/batch')
      .send({
        balances: [
          { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
          { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
        ],
      })
      .expect(200);

    expect(res.body.syncLog.status).toBe('SUCCESS');
    expect(res.body.syncLog.recordsProcessed).toBe(2);

    // Verify balances were created
    const balanceRes = await supertest(server)
      .get('/balances/EMP-001/LOC-NYC?leaveType=ANNUAL')
      .expect(200);

    expect(balanceRes.body.balance).toBe(20);
  });

  it('should update existing balances via batch sync (simulating HCM change)', async () => {
    const server = app.getHttpServer();

    // Set initial balance to 20
    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 })
      .expect(201);

    // Batch sync with updated balance (simulating work anniversary bonus)
    await supertest(server)
      .post('/sync/batch')
      .send({
        balances: [
          { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 25 },
        ],
      })
      .expect(200);

    // Verify balance was updated
    const res = await supertest(server)
      .get('/balances/EMP-001/LOC-NYC?leaveType=ANNUAL')
      .expect(200);

    expect(res.body.balance).toBe(25);
  });

  // ─── BALANCE REFRESH ──────────────────────────────────────

  it('should refresh balance from HCM (real-time)', async () => {
    const server = app.getHttpServer();

    // Set local balance to 20
    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 })
      .expect(201);

    // Refresh from HCM (mock returns 30 — simulating anniversary bonus)
    const res = await supertest(server)
      .post('/balances/EMP-001/LOC-NYC/refresh?leaveType=ANNUAL')
      .expect(200);

    expect(res.body.balance.balance).toBe(30);
    expect(res.body.message).toContain('refreshed');
  });

  // ─── TRIGGER FULL SYNC ────────────────────────────────────

  it('should trigger a full sync from HCM', async () => {
    const server = app.getHttpServer();

    const res = await supertest(server).post('/sync/trigger').expect(200);

    expect(res.body.syncLog.status).toBe('SUCCESS');
    expect(res.body.syncLog.recordsProcessed).toBe(3);

    // Verify all balances were synced
    const emp1 = await supertest(server)
      .get('/balances/EMP-001')
      .expect(200);

    expect(emp1.body.balances.length).toBeGreaterThanOrEqual(2);
  });

  // ─── SYNC STATUS ──────────────────────────────────────────

  it('should return sync status and history', async () => {
    const server = app.getHttpServer();

    // Do a sync first
    await supertest(server)
      .post('/sync/batch')
      .send({
        balances: [
          { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
        ],
      })
      .expect(200);

    // Check status
    const statusRes = await supertest(server).get('/sync/status').expect(200);

    expect(statusRes.body.latest).toBeDefined();
    expect(statusRes.body.history).toHaveLength(1);
  });
});
