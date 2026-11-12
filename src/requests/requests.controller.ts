import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/user';
import { CreateRequestDto } from './dto/create-request.dto';
import { ApproveRequestDto, RejectRequestDto } from './dto/decision.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import { RequestsService } from './requests.service';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /** 201 for a new request, 200 when an earlier call with the same Idempotency-Key is replayed. */
  @Post()
  @Roles('requester')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!key || !IDEMPOTENCY_KEY.test(key)) {
      throw new BadRequestException('Idempotency-Key header is required (8 to 100 characters, letters, digits, - or _)');
    }
    const { request, created } = await this.requests.create(user, dto, key);
    res.status(created ? 201 : 200);
    if (!created) res.setHeader('Idempotent-Replayed', 'true');
    return request;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListRequestsDto) {
    return this.requests.list(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('approver')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveRequestDto) {
    return this.requests.approve(user, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('approver')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectRequestDto) {
    return this.requests.reject(user, id, dto);
  }

  @Post(':id/retriage')
  @HttpCode(202)
  @Roles('approver')
  retriage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.retriage(user, id);
  }
}
