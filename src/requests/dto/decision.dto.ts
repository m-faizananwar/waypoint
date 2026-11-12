import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CATEGORIES, PRIORITIES, TEAMS } from '../../triage/proposal';

/** Approvers can accept the proposal as is, or override any field. Overrides are recorded. */
export class ApproveRequestDto {
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  @IsOptional()
  @IsIn(TEAMS)
  team?: (typeof TEAMS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class RejectRequestDto {
  @IsString()
  @Length(3, 500)
  note: string;
}
