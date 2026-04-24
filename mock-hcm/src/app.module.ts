import { Module } from '@nestjs/common';
import { HcmController } from './hcm.controller.js';
import { HcmService } from './hcm.service.js';

@Module({
  controllers: [HcmController],
  providers: [HcmService],
})
export class AppModule {}
