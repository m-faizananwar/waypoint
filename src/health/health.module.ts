import { Module } from '@nestjs/common';
import { TriageModule } from '../triage/triage.module';
import { HealthController } from './health.controller';

@Module({ imports: [TriageModule], controllers: [HealthController] })
export class HealthModule {}
