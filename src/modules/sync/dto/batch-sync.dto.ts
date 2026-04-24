import { IsArray, ValidateNested, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A single balance record in a batch sync payload.
 */
export class BatchBalanceItemDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  leaveType!: string;

  @IsNumber()
  @Min(0)
  balance!: number;
}

/**
 * DTO for the batch sync endpoint.
 * HCM sends us an array of all current balances.
 */
export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemDto)
  balances!: BatchBalanceItemDto[];
}
