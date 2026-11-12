import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TRIAGE_QUEUE } from '../triage/triage.queue';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRIAGE_QUEUE) private readonly queue: Queue,
  ) {}

  @Public()
  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up', () => 'down'),
      this.queue.client
        .then((c) => (c as unknown as { ping(): Promise<string> }).ping())
        .then(() => 'up', () => 'down'),
    ]);
    const body = { status: database === 'up' && redis === 'up' ? 'ok' : 'degraded', database, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
