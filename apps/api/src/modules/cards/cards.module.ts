import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CardGame, CardGameSchema } from './schemas/card-game.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AttendanceSession, AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { PointsModule } from '../points/points.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardStorageService } from './card-storage.service';
import { CardActionArchive, CardActionArchiveSchema, CardWeekArchive, CardWeekArchiveSchema } from './schemas/card-archive.schema';
@Module({
  imports: [PointsModule, MongooseModule.forFeature([
    { name: CardGame.name, schema: CardGameSchema }, { name: User.name, schema: UserSchema },
    { name: CardActionArchive.name, schema: CardActionArchiveSchema }, { name: CardWeekArchive.name, schema: CardWeekArchiveSchema },
    { name: AttendanceSession.name, schema: AttendanceSessionSchema }
  ])],
  controllers: [CardsController], providers: [CardsService, CardStorageService], exports: [CardsService]
})
export class CardsModule {}
