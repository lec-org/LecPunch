import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EquipTitleDto {
  /** 传 null 或空字符串表示恢复自动佩戴最高优先级荣誉称号。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  titleId?: string | null;
}
