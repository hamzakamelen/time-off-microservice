import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import { TimeOffService } from './time-off.service.js';
import { CreateTimeOffDto } from './dto/create-time-off.dto.js';
import { ReviewTimeOffDto } from './dto/review-time-off.dto.js';
import { TimeOffStatus } from '../../entities/time-off-request.entity.js';

@ApiTags('Time-Off Requests')
@ApiSecurity('x-api-key')
@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post()
  async createRequest(@Body() dto: CreateTimeOffDto) {
    const request = await this.timeOffService.createRequest(dto);
    return { message: 'Time-off request created', request };
  }

  /**
   * GET /time-off
   * List all requests in the system.
   */
  @Get()
  async listAllRequests(@Query('status') status?: TimeOffStatus) {
    const requests = await this.timeOffService.getAllRequests(status);
    return { total: requests.length, requests };
  }

  /**
   * GET /time-off/:id
   * Get a single request by ID.
   */
  @Get(':id')
  async getRequest(@Param('id') id: string) {
    return this.timeOffService.getRequestById(id);
  }

  /**
   * GET /time-off/employee/:employeeId
   * List all requests for an employee.
   */
  @Get('employee/:employeeId')
  async getEmployeeRequests(
    @Param('employeeId') employeeId: string,
    @Query('status') status?: TimeOffStatus,
  ) {
    const requests = await this.timeOffService.getRequestsByEmployee(
      employeeId,
      status,
    );
    return { employeeId, requests };
  }

  /**
   * PATCH /time-off/:id/approve
   * Manager approves a pending request.
   */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @Param('id') id: string,
    @Body() dto: ReviewTimeOffDto,
  ) {
    const request = await this.timeOffService.approveRequest(
      id,
      dto.reviewedBy,
    );
    return { message: `Request ${request.status.toLowerCase()}`, request };
  }

  /**
   * PATCH /time-off/:id/reject
   * Manager rejects a pending request.
   */
  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @Param('id') id: string,
    @Body() dto: ReviewTimeOffDto,
  ) {
    const request = await this.timeOffService.rejectRequest(
      id,
      dto.reviewedBy,
      dto.rejectionReason,
    );
    return { message: 'Request rejected', request };
  }

  /**
   * PATCH /time-off/:id/cancel
   * Employee cancels their own request.
   */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRequest(@Param('id') id: string) {
    const request = await this.timeOffService.cancelRequest(id);
    return { message: 'Request cancelled', request };
  }
}
