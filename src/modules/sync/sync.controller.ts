import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { SyncService } from './sync.service.js';
import { BatchSyncDto } from './dto/batch-sync.dto.js';

@ApiTags('Synchronization')
@ApiSecurity('x-api-key')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /**
   * POST /sync/batch
   * Receive batch balance update from HCM.
   * HCM pushes all current balances to this endpoint.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async batchSync(@Body() dto: BatchSyncDto) {
    const log = await this.syncService.processBatchSync(dto.balances);
    return {
      message: `Batch sync completed (${log.status})`,
      syncLog: log,
    };
  }

  /**
   * POST /sync/trigger
   * Manually trigger a full sync (pull all balances from HCM).
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerSync() {
    const log = await this.syncService.triggerFullSync();
    return {
      message: `Full sync completed (${log.status})`,
      syncLog: log,
    };
  }

  /**
   * GET /sync/status
   * Get the latest sync status and history.
   */
  @Get('status')
  async getSyncStatus() {
    const latest = await this.syncService.getLatestSyncStatus();
    const history = await this.syncService.getSyncHistory(5);
    return { latest, history };
  }
}
