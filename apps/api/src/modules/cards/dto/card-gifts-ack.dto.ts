import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';
export class CardGiftsAckDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @IsString({ each: true }) @Matches(/^[a-f\d]{64}$/, { each: true }) ids!: string[];
}
