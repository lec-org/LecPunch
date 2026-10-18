import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  BadRequestException,
  Post,
  Query,
  Res,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { isValidObjectId } from 'mongoose';
import { ProcessReportDto } from './dto/process-report.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ReportsService, type UploadedReportImage } from './reports.service';

const MAX_REPORT_IMAGES = 3;
const MAX_REPORT_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('images', MAX_REPORT_IMAGES, {
      limits: { fileSize: MAX_REPORT_IMAGE_BYTES, files: MAX_REPORT_IMAGES },
      fileFilter: (_request, file, callback) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
          callback(new UnsupportedMediaTypeException('Only JPEG, PNG, or WebP images are allowed'), false);
          return;
        }
        callback(null, true);
      }
    })
  )
  createReport(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
    @UploadedFiles() images: Express.Multer.File[] = []
  ) {
    return this.reportsService.createReport(user, dto, images as UploadedReportImage[]);
  }

  @Get('admin')
  listReports(@CurrentUser() user: AuthUser, @Query() query: ListReportsQueryDto) {
    this.assertAdmin(user);
    return this.reportsService.listTeamReports(user.teamId, query.page, query.pageSize);
  }

  @Patch('admin/:reportId')
  processReport(@CurrentUser() user: AuthUser, @Param('reportId') id: string, @Body() input: ProcessReportDto) {
    this.assertAdmin(user);
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid report id');
    return this.reportsService.processReport(user, id, input);
  }

  @Get('admin/:reportId/images/:imageId')
  async getReportImage(
    @CurrentUser() user: AuthUser,
    @Param('reportId') reportId: string,
    @Param('imageId') imageId: string,
    @Res() response: Response
  ) {
    this.assertAdmin(user);
    if (!isValidObjectId(reportId)) throw new BadRequestException('Invalid report id');
    const image = await this.reportsService.getImageForAdmin(user.teamId, reportId, imageId);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', String(image.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.sendFile(image.absolutePath);
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admins can access reports');
    }
  }
}
