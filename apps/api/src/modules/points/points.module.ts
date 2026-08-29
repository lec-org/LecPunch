import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import { PointLedgerEntry, PointLedgerEntrySchema } from './schemas/point-ledger-entry.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: PointLedgerEntry.name, schema: PointLedgerEntrySchema }])],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService]
})
export class PointsModule {}
