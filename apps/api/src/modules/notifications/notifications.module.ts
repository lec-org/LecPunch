import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';
import { UsersModule } from '../users/users.module';
import { NotificationReceipt, NotificationReceiptSchema } from './schemas/notification-receipt.schema';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }, { name: NotificationReceipt.name, schema: NotificationReceiptSchema }])],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService]
})
export class NotificationsModule {}
