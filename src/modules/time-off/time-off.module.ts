import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from '../../entities/time-off-request.entity.js';
import { TimeOffController } from './time-off.controller.js';
import { TimeOffService } from './time-off.service.js';
import { BalanceModule } from '../balance/balance.module.js';
import { HcmClientModule } from '../hcm-client/hcm-client.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalanceModule,     // To check and deduct balances
    HcmClientModule,   // To sync approved requests to HCM
  ],
  controllers: [TimeOffController],
  providers: [TimeOffService],
  exports: [TimeOffService],
})
export class TimeOffModule {}
