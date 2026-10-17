import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export class AdjustCurrentWeekDurationDto {
  @IsOptional() @IsString() @MinLength(1) username?: string;
  @IsOptional() @Matches(/^[a-fA-F0-9]{24}$/) userId?: string;
  @IsIn(['add', 'subtract']) operation!: 'add' | 'subtract';
  @IsInt() @Min(1) @Max(604800) durationSeconds!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestKey?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedWeekKey?: string;
}
