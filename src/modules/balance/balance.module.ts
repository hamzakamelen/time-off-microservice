import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveBalance } from '../../entities/leave-balance.entity.js';
import { BalanceController } from './balance.controller.js';
import { BalanceService } from './balance.service.js';
import { HcmClientModule } from '../hcm-client/hcm-client.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveBalance]),
    HcmClientModule, // So we can call HCM to refresh balances
  ],
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
