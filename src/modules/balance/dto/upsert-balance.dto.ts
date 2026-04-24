import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * DTO for creating or updating a leave balance manually.
 */
export class UpsertBalanceDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  @IsOptional()
  leaveType?: string; // Defaults to "ANNUAL"

  @IsNumber()
  @Min(0)
  balance!: number;
}
