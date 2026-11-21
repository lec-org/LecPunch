import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceModule } from '../attendance/attendance.module';
import { CardsModule } from '../cards/cards.module';
import { CardActionArchive, CardActionArchiveSchema } from '../cards/schemas/card-archive.schema';
import { CardGame, CardGameSchema } from '../cards/schemas/card-game.schema';
import { UsersModule } from '../users/users.module';
import { TitlesController } from './titles.controller';
import { TitlesService } from './titles.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CardActionArchive.name, schema: CardActionArchiveSchema },
      { name: CardGame.name, schema: CardGameSchema }
    ]),
    UsersModule,
    forwardRef(() => AttendanceModule),
    CardsModule
  ],
  controllers: [TitlesController],
  providers: [TitlesService],
  exports: [TitlesService]
})
export class TitlesModule {}
