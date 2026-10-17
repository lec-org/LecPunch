import { IsBoolean } from 'class-validator';
export class NotificationPreferenceDto { @IsBoolean() adminMessageBadgeEnabled!: boolean; }
