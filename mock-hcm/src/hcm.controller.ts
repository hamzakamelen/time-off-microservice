import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { HcmService } from './hcm.service.js';

@Controller('api/hcm')
export class HcmController {
  constructor(private readonly hcmService: HcmService) {}

  /**
   * GET /api/hcm/balance/:employeeId/:locationId?leaveType=ANNUAL
   * Real-time balance lookup.
   */
  @Get('balance/:employeeId/:locationId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('leaveType') leaveType: string = 'ANNUAL',
  ) {
    const balance = this.hcmService.getBalance(employeeId, locationId, leaveType);
    if (!balance) {
      throw new HttpException(
        `No balance found for ${employeeId}/${locationId}/${leaveType}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return balance;
  }

  /**
   * GET /api/hcm/balances/batch
   * Returns ALL balances (batch endpoint).
   */
  @Get('balances/batch')
  getAllBalances() {
    return this.hcmService.getAllBalances();
  }

  /**
   * POST /api/hcm/time-off
   * Submit a time-off request for deduction.
   */
  @Post('time-off')
  @HttpCode(HttpStatus.OK)
  submitTimeOff(
    @Body()
    body: {
      employeeId: string;
      locationId: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      numberOfDays: number;
    },
  ) {
    const result = this.hcmService.submitTimeOff(body);
    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.BAD_REQUEST,
      );
    }
    return result;
  }

  /**
   * DELETE /api/hcm/time-off/:referenceId
   * Cancel a previously submitted time-off.
   */
  @Delete('time-off/:referenceId')
  cancelTimeOff(@Param('referenceId') referenceId: string) {
    const result = this.hcmService.cancelTimeOff(referenceId);
    if (!result.success) {
      throw new HttpException(
        { success: false, error: result.error },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  // ─── SIMULATION ENDPOINTS (for testing) ───────────────────

  /**
   * POST /api/hcm/simulate/balance-change
   * Simulate an independent balance change (e.g., work anniversary).
   */
  @Post('simulate/balance-change')
  @HttpCode(HttpStatus.OK)
  simulateBalanceChange(
    @Body()
    body: {
      employeeId: string;
      locationId: string;
      leaveType: string;
      newBalance: number;
    },
  ) {
    this.hcmService.simulateBalanceChange(
      body.employeeId,
      body.locationId,
      body.leaveType,
      body.newBalance,
    );
    return { message: 'Balance change simulated' };
  }

  /**
   * POST /api/hcm/simulate/error
   * Make a specific employee trigger errors on time-off submission.
   */
  @Post('simulate/error')
  @HttpCode(HttpStatus.OK)
  simulateError(@Body() body: { employeeId: string; enable: boolean }) {
    if (body.enable) {
      this.hcmService.addErrorEmployee(body.employeeId);
    } else {
      this.hcmService.removeErrorEmployee(body.employeeId);
    }
    return { message: `Error simulation ${body.enable ? 'enabled' : 'disabled'} for ${body.employeeId}` };
  }

  /**
   * POST /api/hcm/reset
   * Reset mock HCM to initial seed state.
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    this.hcmService.reset();
    return { message: 'Mock HCM reset to seed data' };
  }
}
