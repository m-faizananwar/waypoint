import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { Env, validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { redisOptions } from './config/redis';

@Module({
  imports: [
    // Tests set their own environment, so a developer's local .env can never leak into them.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: process.env.NODE_ENV === 'test' }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      // Options rather than a client instance, so BullMQ owns its connections and closes them on shutdown.
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptions(config.get('REDIS_URL', { infer: true })),
      }),
    }),
    PrismaModule,
    AuthModule,
    RequestsModule,
    HealthModule,
  ],
})
export class AppModule {}
