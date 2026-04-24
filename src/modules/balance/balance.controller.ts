import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { BalanceService } from './balance.service.js';
import { UpsertBalanceDto } from './dto/upsert-balance.dto.js';

@ApiTags('Balances')
@ApiSecurity('x-api-key')
@Controller('balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  /**
   * GET /balances
   * Returns all balances for all employees in the system.
   */
  @Get()
  async listAllBalances() {
    const balances = await this.balanceService.getAllBalances();
    return { total: balances.length, balances };
  }

  /**
   * GET /balances/:employeeId
   * Returns all balances for an employee across all locations.
   */
  @Get(':employeeId')
  async getEmployeeBalances(@Param('employeeId') employeeId: string) {
    const balances =
      await this.balanceService.getBalancesForEmployee(employeeId);
    return { employeeId, balances };
  }

  /**
   * GET /balances/:employeeId/:locationId
   * Returns balances for an employee at a specific location.
   */
  @Get(':employeeId/:locationId')
  async getBalancesAtLocation(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('leaveType') leaveType?: string,
  ) {
    if (leaveType) {
      const balance = await this.balanceService.getSpecificBalance(
        employeeId,
        locationId,
        leaveType,
      );
      return balance;
    }
    const balances = await this.balanceService.getBalancesAtLocation(
      employeeId,
      locationId,
    );
    return { employeeId, locationId, balances };
  }

  /**
   * POST /balances/:employeeId/:locationId/refresh
   * Force a refresh of the balance from HCM.
   */
  @Post(':employeeId/:locationId/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query('leaveType') leaveType?: string,
  ) {
    const balance = await this.balanceService.refreshFromHcm(
      employeeId,
      locationId,
      leaveType || 'ANNUAL',
    );
    return { message: 'Balance refreshed from HCM', balance };
  }

  /**
   * POST /balances
   * Manually create or update a balance (used for initial setup or testing).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async upsertBalance(@Body() dto: UpsertBalanceDto) {
    const balance = await this.balanceService.upsertBalance(
      dto.employeeId,
      dto.locationId,
      dto.leaveType || 'ANNUAL',
      dto.balance,
    );
    return { message: 'Balance saved', balance };
  }
}
