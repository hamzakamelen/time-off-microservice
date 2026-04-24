import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Custom validator: ensures endDate is on or after startDate.
 */
@ValidatorConstraint({ name: 'isEndDateAfterStartDate', async: false })
export class IsEndDateAfterStartDate implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateTimeOffDto;
    if (!dto.startDate || !dto.endDate) return true; // Let @IsDateString handle missing

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    return end >= start;
  }

  defaultMessage(): string {
    return 'endDate must be on or after startDate';
  }
}

/**
 * Custom validator: ensures numberOfDays doesn't exceed the date range.
 */
@ValidatorConstraint({ name: 'isDaysWithinRange', async: false })
export class IsDaysWithinRange implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CreateTimeOffDto;
    if (!dto.startDate || !dto.endDate || !dto.numberOfDays) return true;

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const calendarDays =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // numberOfDays should not exceed the calendar range
    return dto.numberOfDays <= calendarDays;
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as CreateTimeOffDto;
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const calendarDays =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return `numberOfDays (${dto.numberOfDays}) exceeds the date range of ${calendarDays} calendar day(s)`;
  }
}

/**
 * DTO for submitting a new time-off request.
 * Validates all fields including cross-field constraints.
 */
export class CreateTimeOffDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  @IsOptional()
  leaveType?: string; // Defaults to "ANNUAL"

  @IsDateString()
  startDate!: string; // e.g. "2026-05-01"

  @IsDateString()
  @Validate(IsEndDateAfterStartDate)
  endDate!: string; // e.g. "2026-05-03"

  @IsNumber()
  @Min(0.5) // Minimum half a day
  @Validate(IsDaysWithinRange)
  numberOfDays!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
