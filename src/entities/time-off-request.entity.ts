import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * All possible states a time-off request can be in.
 */
export enum TimeOffStatus {
  PENDING = 'PENDING',     // Submitted by employee, awaiting manager approval
  APPROVED = 'APPROVED',   // Manager approved, will be synced to HCM
  REJECTED = 'REJECTED',   // Manager rejected
  CANCELLED = 'CANCELLED', // Employee cancelled
  SYNCED = 'SYNCED',       // Successfully synced to HCM
  FAILED = 'FAILED',       // HCM rejected the deduction
}

/**
 * Represents a single time-off request from an employee.
 * Tracks the full lifecycle from submission to HCM sync.
 */
@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  @Column()
  locationId!: string;

  @Column({ default: 'ANNUAL' })
  leaveType!: string;

  @Column()
  startDate!: string; // ISO date string "2026-01-15"

  @Column()
  endDate!: string; // ISO date string "2026-01-17"

  @Column({ type: 'real' })
  numberOfDays!: number;

  @Column({ default: TimeOffStatus.PENDING })
  status!: TimeOffStatus;

  @Column({ nullable: true })
  reason!: string; // Why the employee wants time off

  @Column({ nullable: true })
  reviewedBy!: string; // Manager who approved/rejected

  @Column({ nullable: true })
  reviewedAt!: Date;

  @Column({ nullable: true })
  hcmReferenceId!: string; // Reference ID from HCM after sync

  @Column({ nullable: true })
  rejectionReason!: string; // Why it was rejected (by manager or HCM)

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
