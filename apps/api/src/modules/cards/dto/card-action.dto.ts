import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { CardGameActionInput } from '@lecpunch/shared';
export class CardActionDto implements CardGameActionInput {
  @IsUUID('4') requestKey!: string;
  @IsIn(['draw', 'use', 'gift']) action!: 'draw' | 'use' | 'gift';
  @IsOptional() @IsString() @Matches(/^card-\d{2}$/) cardId?: string;
  @IsOptional() @IsString() @Matches(/^[a-f\d]{24}$/i) targetId?: string;
  @IsOptional() @IsString() @Matches(/^[a-f\d]{24}$/i) secondTargetId?: string;
}
