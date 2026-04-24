import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Audit log for sync operations between ExampleHR and HCM.
 */
@Entity('sync_logs')
export class SyncLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  syncType!: string; // 'BATCH' or 'REALTIME'

  @Column()
  status!: string; // 'SUCCESS', 'PARTIAL', 'FAILED'

  @Column({ nullable: true })
  details!: string; // JSON string with sync details

  @Column({ type: 'int', default: 0 })
  recordsProcessed!: number;

  @Column({ type: 'int', default: 0 })
  recordsFailed!: number;

  @CreateDateColumn()
  startedAt!: Date;

  @Column({ nullable: true })
  completedAt!: Date;
}
