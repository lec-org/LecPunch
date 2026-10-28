import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { PointsService } from './points.service';
import { MyPointsQueryDto } from './dto/my-points-query.dto';
import { CardsService } from '../cards/cards.service';
import { parseIsoWeekKey } from '../../common/utils/time.util';

@Controller('points')
@UseGuards(JwtAuthGuard)
export class PointsController {
  constructor(private readonly pointsService: PointsService, private readonly cards: CardsService) {}

  @Get('me')
  async getMine(@CurrentUser() user: AuthUser, @Query() query: MyPointsQueryDto) {
    // Register this controller in CardsModule: the audit provider remains independent
    // of card state, so attendance -> PointsModule never introduces a module cycle.
    const audit = await this.pointsService.getMyPoints(user, query.week);
    const weekKey = parseIsoWeekKey(audit.week)!.toFormat('yyyy-LL-dd');
    return { ...audit, drawPoints: { weekKey, ...await this.cards.getWeekPoints(user, weekKey) } };
  }
}
