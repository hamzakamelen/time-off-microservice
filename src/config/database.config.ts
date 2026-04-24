import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LeaveBalance } from '../entities/leave-balance.entity.js';
import { TimeOffRequest } from '../entities/time-off-request.entity.js';
import { SyncLog } from '../entities/sync-log.entity.js';

/**
 * Creates TypeORM configuration for SQLite.
 * Uses the DB_PATH env var, defaulting to an in-memory database.
 *
 * Note: Employee entity was removed from active registration.
 * The HCM is the source of truth for employee data; we only store
 * employeeId as a string reference in LeaveBalance and TimeOffRequest.
 */
export function getDatabaseConfig(dbPath?: string): TypeOrmModuleOptions {
  return {
    type: 'better-sqlite3',
    database: dbPath || ':memory:',
    entities: [LeaveBalance, TimeOffRequest, SyncLog],
    synchronize: true, // Auto-create tables (fine for dev/exercise; use migrations in prod)
    logging: false,
  };
}
