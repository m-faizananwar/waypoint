import { Module } from '@nestjs/common';
import { TriageModule } from '../triage/triage.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [TriageModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
