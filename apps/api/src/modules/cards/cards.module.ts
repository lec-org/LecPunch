import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CardGame, CardGameSchema } from './schemas/card-game.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AttendanceSession, AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { PointLedgerEntry, PointLedgerEntrySchema } from '../points/schemas/point-ledger-entry.schema';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
@Module({
  imports: [MongooseModule.forFeature([
    { name: CardGame.name, schema: CardGameSchema }, { name: User.name, schema: UserSchema },
    { name: AttendanceSession.name, schema: AttendanceSessionSchema }, { name: PointLedgerEntry.name, schema: PointLedgerEntrySchema }
  ])],
  controllers: [CardsController], providers: [CardsService], exports: [CardsService]
})
export class CardsModule {}
