import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { TRIAGE_QUEUE } from './triage.queue';
import { TriageProcessor } from './triage.processor';
import { TriageService } from './triage.service';

@Module({
  imports: [BullModule.registerQueue({ name: TRIAGE_QUEUE })],
  providers: [
    {
      provide: TriageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => TriageService.fromConfig(config),
    },
    TriageProcessor,
  ],
  exports: [BullModule, TriageService],
})
export class TriageModule {}
