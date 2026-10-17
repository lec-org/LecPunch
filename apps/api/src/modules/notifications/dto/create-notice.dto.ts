import { IsString, Length, Matches } from 'class-validator';
export class CreateNoticeDto {
  @IsString() @Length(1, 100) title!: string;
  @IsString() @Length(1, 2000) message!: string;
  @IsString() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestKey!: string;
}
