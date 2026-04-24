import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HcmClientService } from './hcm-client.service.js';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000, // 5-second timeout for HCM calls
    }),
  ],
  providers: [HcmClientService],
  exports: [HcmClientService],
})
export class HcmClientModule {}
