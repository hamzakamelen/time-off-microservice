import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { HcmClientService } from '../../src/modules/hcm-client/hcm-client.service';

/**
 * E2E test: Full time-off request lifecycle via HTTP.
 * Tests the complete flow: setup balance → create request → approve → verify.
 */
describe('Time-Off Lifecycle (E2E)', () => {
  let app: INestApplication;

  const mockHcmClient = {
    getBalance: jest.fn().mockResolvedValue({
      employeeId: 'EMP-001',
      locationId: 'LOC-NYC',
      leaveType: 'ANNUAL',
      balance: 20,
    }),
    submitTimeOff: jest.fn().mockResolvedValue({
      success: true,
      referenceId: 'HCM-E2E-001',
    }),
    cancelTimeOff: jest.fn().mockResolvedValue({ success: true }),
    getAllBalances: jest.fn().mockResolvedValue([]),
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

  it('should complete full lifecycle: balance setup → request → approve → cancel', async () => {
    const server = app.getHttpServer();

    // Step 1: Set up a balance
    const balanceRes = await supertest(server)
      .post('/balances')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        balance: 20,
      })
      .expect(201);

    expect(balanceRes.body.balance.balance).toBe(20);

    // Step 2: Create a time-off request
    const createRes = await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-NYC',
        leaveType: 'ANNUAL',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        numberOfDays: 3,
        reason: 'Summer vacation',
      })
      .expect(201);

    const requestId = createRes.body.request.id;
    expect(createRes.body.request.status).toBe('PENDING');

    // Step 3: Get the request
    const getRes = await supertest(server)
      .get(`/time-off/${requestId}`)
      .expect(200);

    expect(getRes.body.status).toBe('PENDING');

    // Step 4: Approve the request
    const approveRes = await supertest(server)
      .patch(`/time-off/${requestId}/approve`)
      .send({ reviewedBy: 'MGR-001' })
      .expect(200);

    expect(approveRes.body.request.status).toBe('SYNCED');

    // Step 5: Verify balance was deducted
    const balanceCheck = await supertest(server)
      .get('/balances/EMP-001/LOC-NYC?leaveType=ANNUAL')
      .expect(200);

    expect(balanceCheck.body.balance).toBe(17); // 20 - 3

    // Step 6: Cancel the synced request
    const cancelRes = await supertest(server)
      .patch(`/time-off/${requestId}/cancel`)
      .expect(200);

    expect(cancelRes.body.request.status).toBe('CANCELLED');

    // Step 7: Verify balance was restored
    const finalBalance = await supertest(server)
      .get('/balances/EMP-001/LOC-NYC?leaveType=ANNUAL')
      .expect(200);

    expect(finalBalance.body.balance).toBe(20); // Restored
  });

  it('should reject a pending request', async () => {
    const server = app.getHttpServer();

    // Setup balance
    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-002', locationId: 'LOC-LDN', balance: 10 })
      .expect(201);

    // Create request
    const createRes = await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-002',
        locationId: 'LOC-LDN',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        numberOfDays: 2,
      })
      .expect(201);

    // Reject
    const rejectRes = await supertest(server)
      .patch(`/time-off/${createRes.body.request.id}/reject`)
      .send({
        reviewedBy: 'MGR-001',
        rejectionReason: 'Team needs coverage',
      })
      .expect(200);

    expect(rejectRes.body.request.status).toBe('REJECTED');
  });

  it('should list requests for an employee', async () => {
    const server = app.getHttpServer();

    // Setup
    await supertest(server)
      .post('/balances')
      .send({ employeeId: 'EMP-003', locationId: 'LOC-NYC', balance: 15 })
      .expect(201);

    // Create 2 requests
    await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-003',
        locationId: 'LOC-NYC',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        numberOfDays: 2,
      })
      .expect(201);

    await supertest(server)
      .post('/time-off')
      .send({
        employeeId: 'EMP-003',
        locationId: 'LOC-NYC',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        numberOfDays: 3,
      })
      .expect(201);

    // List
    const listRes = await supertest(server)
      .get('/time-off/employee/EMP-003')
      .expect(200);

    expect(listRes.body.requests).toHaveLength(2);
  });
});
