import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  VersionColumn,
} from 'typeorm';

/**
 * Tracks time-off balances per employee, per location, per leave type.
 * Uses optimistic locking (version column) to prevent race conditions.
 */
@Entity('leave_balances')
@Unique(['employeeId', 'locationId', 'leaveType'])
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string; // References Employee.employeeId

  @Column()
  locationId!: string; // e.g. "LOC-NYC", "LOC-LDN"

  @Column()
  leaveType!: string; // e.g. "ANNUAL", "SICK", "PERSONAL"

  @Column({ type: 'real', default: 0 })
  balance!: number; // Number of days available

  @Column({ nullable: true })
  lastSyncedAt!: Date; // When we last synced with HCM

  @VersionColumn()
  version!: number; // For optimistic locking

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
