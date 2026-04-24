import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Represents an employee in the system.
 * This is a lightweight local copy — the HCM is the source of truth.
 */
@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  employeeId!: string; // External ID from HCM (e.g. "EMP-001")

  @Column()
  name!: string;

  @Column({ nullable: true })
  email!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
