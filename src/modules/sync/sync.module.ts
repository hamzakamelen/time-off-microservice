import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncLog } from '../../entities/sync-log.entity.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { BalanceModule } from '../balance/balance.module.js';
import { HcmClientModule } from '../hcm-client/hcm-client.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncLog]),
    BalanceModule,
    HcmClientModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
