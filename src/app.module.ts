import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { getDatabaseConfig } from './config/database.config.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';

import { BalanceModule } from './modules/balance/balance.module.js';
import { TimeOffModule } from './modules/time-off/time-off.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { HcmClientModule } from './modules/hcm-client/hcm-client.module.js';

@Module({
  imports: [
    // Load environment variables from .env file
    ConfigModule.forRoot({
      isGlobal: true, // Available everywhere, no need to import per module
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),

    // Connect to SQLite using the DB_PATH from environment
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>('DB_PATH') || ':memory:';
        return getDatabaseConfig(dbPath);
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100, // 100 requests per minute
    }]),

    // Feature modules
    HcmClientModule,
    BalanceModule,
    TimeOffModule,
    SyncModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
