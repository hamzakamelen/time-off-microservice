import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';

/**
 * E2E test: Error handling scenarios.
 * Tests what happens when things go wrong: HCM failures, bad input, etc.
 */
describe('Error Handling (E2E)', () => {
  let app: INestApplication;

  const mockHcmClient = {
    getBalance: jest.fn(),
    submitTimeOff: jest.fn(),
    cancelTimeOff: jest.fn(),
    getAllBalances: jest.fn(),
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── VALIDATION ERRORS ─────────────────────────────────────

  it('should reject time-off request with missing required fields', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/time-off')
      .send({ employeeId: 'EMP-001' }) // Missing locationId, dates, etc.
      .expect(400);

    expect(res.body.message).toBeDefined();
  });

  it('should reject time-off request with invalid date format', async () => {
    await supertest(app.getHttpServer())
      .post('/balances')
      .send({ employeeId: 'EMP-001', locationId: 'LOC-NYC', balance: 20 })
      .expect(201);

    const res = await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        startDate: 'not-a-date',
        endDate: 'also-not-a-date',
        numberOfDays: 3,
      })
      .expect(400);

    expect(res.body.message).toBeDefined();
  });

  it('should reject time-off with negative days', async () => {
    await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: -1,
      })
      .expect(400);
  });

  // Fix #2: endDate must be >= startDate
  it('should reject time-off when endDate is before startDate', async () => {
    await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        startDate: '2026-06-05',
        endDate: '2026-06-01',
        numberOfDays: 3,
      })
      .expect(400);
  });

  // Fix #3: numberOfDays must not exceed date range
  it('should reject time-off when numberOfDays exceeds date range', async () => {
    await supertest(app.getHttpServer())
      .post('/balances')
      .send({ employeeId: 'EMP-RANGE', locationId: 'LOC-NYC', balance: 100 })
      .expect(201);

    await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-RANGE',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03', // 3 calendar days
        numberOfDays: 10, // Claims 10 days — impossible
      })
      .expect(400);
  });

  // Fix #9: Overlapping date ranges
  it('should reject overlapping time-off requests', async () => {
    const server = app.getHttpServer();

    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-OVERLAP', locationId: 'LOC-NYC', balance: 30 })
      .expect(201);

    // First request: June 1-5
    await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-OVERLAP',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        numberOfDays: 5,
      })
      .expect(201);

    // Second request: June 3-7 (overlaps June 3-5)
    const res = await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-OVERLAP',
        locationId: 'LOC-NYC',
        startDate: '2026-06-03',
        endDate: '2026-06-07',
        numberOfDays: 5,
      })
      .expect(400);

    expect(res.body.message).toContain('Overlapping');
  });

  // ─── INSUFFICIENT BALANCE ─────────────────────────────────

  it('should reject request when employee has no balance record', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-NO-BALANCE',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      })
      .expect(400);

    expect(res.body.message).toContain('Insufficient');
  });

  it('should reject request when balance is less than requested days', async () => {
    await supertest(app.getHttpServer())
      .post('/balances')
      .send({ employeeId: 'EMP-LOW', locationId: 'LOC-NYC', balance: 2 })
      .expect(201);

    const res = await supertest(app.getHttpServer())
      .post('/time-off')
      .send({
        employeeId: 'EMP-LOW',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        numberOfDays: 5,
      })
      .expect(400);

    expect(res.body.message).toContain('Insufficient');
  });

  // ─── HCM FAILURE DURING APPROVAL ─────────────────────────

  it('should mark request as FAILED when HCM rejects during approval', async () => {
    const server = app.getHttpServer();

    mockHcmClient.submitTimeOff.mockResolvedValue({
      success: false,
      error: 'Invalid dimensions',
    });

    // Setup
    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-HCM-FAIL', locationId: 'LOC-NYC', balance: 20 })
      .expect(201);

    // Create request
    const createRes = await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-HCM-FAIL',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      })
      .expect(201);

    // Approve (HCM will reject)
    const approveRes = await supertest(server)
      .patch(`/time-off/${createRes.body.request.id}/approve`)
      .send({ reviewedBy: 'MGR-001' })
      .expect(200);

    expect(approveRes.body.request.status).toBe('FAILED');

    // Balance should be restored
    const balanceRes = await supertest(server)
      .get('/balances/EMP-HCM-FAIL/LOC-NYC?leaveType=ANNUAL')
      .expect(200);

    expect(balanceRes.body.balance).toBe(20);
  });

  // ─── INVALID STATE TRANSITIONS ────────────────────────────

  it('should reject approving an already-synced request', async () => {
    const server = app.getHttpServer();

    mockHcmClient.submitTimeOff.mockResolvedValue({
      success: true,
      referenceId: 'HCM-001',
    });

    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-STATE', locationId: 'LOC-NYC', balance: 20 })
      .expect(201);

    const createRes = await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-STATE',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
      })
      .expect(201);

    // Approve first time
    await supertest(server)
      .patch(`/time-off/${createRes.body.request.id}/approve`)
      .send({ reviewedBy: 'MGR-001' })
      .expect(200);

    // Try to approve again — should fail
    await supertest(server)
      .patch(`/time-off/${createRes.body.request.id}/approve`)
      .send({ reviewedBy: 'MGR-001' })
      .expect(400);
  });

  // ─── NOT FOUND ─────────────────────────────────────────────

  it('should return 404 for non-existent request', async () => {
    await supertest(app.getHttpServer())
      .get('/time-off/non-existent-id')
      .expect(404);
  });

  it('should return 404 for non-existent balance', async () => {
    await supertest(app.getHttpServer())
      .get('/balances/EMP-NONE/LOC-NONE?leaveType=ANNUAL')
      .expect(404);
  });
});
