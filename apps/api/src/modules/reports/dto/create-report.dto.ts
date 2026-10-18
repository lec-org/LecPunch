import { IsOptional, Matches, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @IsOptional() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestKey?: string;
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  description!: string;
}
