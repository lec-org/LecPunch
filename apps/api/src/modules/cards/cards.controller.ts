import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { CardsService } from './cards.service';
import { CardActionDto } from './dto/card-action.dto';
import { CardGiftsAckDto } from './dto/card-gifts-ack.dto';

@Controller('cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly cards: CardsService) {}
  @Get('me') me(@CurrentUser() user: AuthUser) { return this.cards.getMe(user); }
  @Post('actions') action(@CurrentUser() user: AuthUser, @Body() input: CardActionDto) { return this.cards.action(user, input); }
  @Post('gifts/ack') acknowledgeGifts(@CurrentUser() user: AuthUser, @Body() input: CardGiftsAckDto) { return this.cards.acknowledgeGifts(user, input.ids); }
  @Get('actions/:requestKey') status(@CurrentUser() user: AuthUser, @Param('requestKey') key: string) { return this.cards.actionStatus(user, key); }
  @Get('art/:cardId') async art(@CurrentUser() user: AuthUser, @Param('cardId') id: string, @Res() response: Response) {
    const file = await this.cards.artwork(user, id);
    response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Type', 'image/png');
    response.sendFile(file);
  }
}
