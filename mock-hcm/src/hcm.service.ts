import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory storage for the mock HCM.
 * Simulates a real HCM system like Workday or SAP.
 */

export interface BalanceRecord {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

interface TimeOffRecord {
  referenceId: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  numberOfDays: number;
  startDate: string;
  endDate: string;
  status: string;
}

@Injectable()
export class HcmService {
  private readonly logger = new Logger(HcmService.name);

  // In-memory storage
  private balances: Map<string, BalanceRecord> = new Map();
  private timeOffRecords: Map<string, TimeOffRecord> = new Map();

  // Error simulation: set of employee IDs that should trigger errors
  private errorEmployees: Set<string> = new Set();

  constructor() {
    // Seed some default data
    this.seedData();
  }

  private seedData(): void {
    // Create balances for a few employees
    const seedBalances: BalanceRecord[] = [
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 20 },
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'SICK', balance: 10 },
      { employeeId: 'EMP-001', locationId: 'LOC-NYC', leaveType: 'PERSONAL', balance: 5 },
      { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'ANNUAL', balance: 25 },
      { employeeId: 'EMP-002', locationId: 'LOC-LDN', leaveType: 'SICK', balance: 8 },
      { employeeId: 'EMP-003', locationId: 'LOC-NYC', leaveType: 'ANNUAL', balance: 15 },
      { employeeId: 'EMP-003', locationId: 'LOC-TKY', leaveType: 'ANNUAL', balance: 12 },
    ];

    for (const b of seedBalances) {
      const key = this.balanceKey(b.employeeId, b.locationId, b.leaveType);
      this.balances.set(key, b);
    }

    this.logger.log(`Mock HCM seeded with ${seedBalances.length} balance records`);
  }

  private balanceKey(employeeId: string, locationId: string, leaveType: string): string {
    return `${employeeId}::${locationId}::${leaveType}`;
  }

  // ─── BALANCE OPERATIONS ───────────────────────────────────

  getBalance(employeeId: string, locationId: string, leaveType: string): BalanceRecord | null {
    const key = this.balanceKey(employeeId, locationId, leaveType);
    return this.balances.get(key) || null;
  }

  getAllBalances(): BalanceRecord[] {
    return Array.from(this.balances.values());
  }

  setBalance(employeeId: string, locationId: string, leaveType: string, balance: number): void {
    const key = this.balanceKey(employeeId, locationId, leaveType);
    this.balances.set(key, { employeeId, locationId, leaveType, balance });
  }

  // ─── TIME-OFF OPERATIONS ──────────────────────────────────

  submitTimeOff(request: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    numberOfDays: number;
  }): { success: boolean; referenceId?: string; error?: string } {
    // Check if this employee should trigger an error
    if (this.errorEmployees.has(request.employeeId)) {
      return { success: false, error: 'HCM error: Employee flagged for review' };
    }

    // Check balance
    const balance = this.getBalance(
      request.employeeId,
      request.locationId,
      request.leaveType,
    );

    if (!balance) {
      return {
        success: false,
        error: `Invalid dimensions: no balance for ${request.employeeId}/${request.locationId}/${request.leaveType}`,
      };
    }

    if (balance.balance < request.numberOfDays) {
      return {
        success: false,
        error: `Insufficient balance: have ${balance.balance}, need ${request.numberOfDays}`,
      };
    }

    // Deduct the balance
    balance.balance -= request.numberOfDays;

    // Create a record
    const referenceId = `HCM-${uuidv4().slice(0, 8).toUpperCase()}`;
    this.timeOffRecords.set(referenceId, {
      referenceId,
      ...request,
      status: 'APPROVED',
    });

    this.logger.log(`Time-off approved: ${referenceId} (${request.numberOfDays} days deducted)`);
    return { success: true, referenceId };
  }

  cancelTimeOff(referenceId: string): { success: boolean; error?: string } {
    const record = this.timeOffRecords.get(referenceId);
    if (!record) {
      return { success: false, error: `Reference ${referenceId} not found` };
    }

    // Restore the balance
    const balance = this.getBalance(record.employeeId, record.locationId, record.leaveType);
    if (balance) {
      balance.balance += record.numberOfDays;
    }

    record.status = 'CANCELLED';
    this.logger.log(`Time-off cancelled: ${referenceId}`);
    return { success: true };
  }

  // ─── SIMULATION HELPERS ───────────────────────────────────

  /**
   * Simulate an independent balance change (e.g., work anniversary bonus).
   */
  simulateBalanceChange(
    employeeId: string,
    locationId: string,
    leaveType: string,
    newBalance: number,
  ): void {
    this.setBalance(employeeId, locationId, leaveType, newBalance);
    this.logger.log(
      `Simulated balance change: ${employeeId}/${locationId}/${leaveType} → ${newBalance}`,
    );
  }

  /**
   * Add an employee to the error simulation list.
   */
  addErrorEmployee(employeeId: string): void {
    this.errorEmployees.add(employeeId);
  }

  /**
   * Remove an employee from the error simulation list.
   */
  removeErrorEmployee(employeeId: string): void {
    this.errorEmployees.delete(employeeId);
  }

  /**
   * Reset all data back to seed state.
   */
  reset(): void {
    this.balances.clear();
    this.timeOffRecords.clear();
    this.errorEmployees.clear();
    this.seedData();
  }
}
