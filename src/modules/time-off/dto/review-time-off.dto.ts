import { IsString, IsOptional } from 'class-validator';

/**
 * DTO for a manager reviewing (approving/rejecting) a time-off request.
 */
export class ReviewTimeOffDto {
  @IsString()
  reviewedBy!: string; // Manager's employee ID

  @IsString()
  @IsOptional()
  rejectionReason?: string; // Required for rejections, optional for approvals
}
