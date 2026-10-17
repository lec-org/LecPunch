import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
export class ProcessReportDto {
  @IsIn(['open', 'processed']) status!: 'open' | 'processed';
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
