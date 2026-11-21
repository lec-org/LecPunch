import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { EquipTitleDto } from './dto/equip-title.dto';
import { TitlesService } from './titles.service';

@Controller('titles')
@UseGuards(JwtAuthGuard)
export class TitlesController {
  constructor(private readonly titlesService: TitlesService) {}

  @Get('me')
  getMyTitles(@CurrentUser() user: AuthUser) {
    return this.titlesService.getMyTitles(user.teamId, user.userId);
  }

  @Patch('me/equip')
  equipTitle(@CurrentUser() user: AuthUser, @Body() dto: EquipTitleDto) {
    return this.titlesService.equipTitle(user.teamId, user.userId, dto.titleId ?? null);
  }

  @Get('team')
  async getTeamTitles(@CurrentUser() user: AuthUser) {
    const items = await this.titlesService.getTeamDisplayTitlesByMemberKey(user.teamId);
    return { items };
  }
}
