import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
export class ProcessReportDto {
  @IsIn(['open', 'processed']) status!: 'open' | 'processed';
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(2000) note?: string;
}
