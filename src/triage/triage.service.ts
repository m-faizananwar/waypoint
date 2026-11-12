import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { OpenAiCompatibleTriageModel } from './openai-compatible.model';
import { TriageInput, TriageModel, TriageResult } from './proposal';
import { RulesTriageModel } from './rules.model';

export const TRIAGE_MODELS = Symbol('TRIAGE_MODELS');

/**
 * Tries each model in order and returns the first valid proposal, recording
 * which model answered. The rules model is always last, so triage degrades
 * instead of failing when the LLM is down, slow or returns junk.
 */
@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(private readonly models: TriageModel[]) {}

  static fromConfig(config: ConfigService<Env, true>): TriageService {
    const models: TriageModel[] = [];
    const apiKey = config.get('LLM_API_KEY', { infer: true });
    if (apiKey) {
      models.push(
        new OpenAiCompatibleTriageModel({
          baseUrl: config.get('LLM_BASE_URL', { infer: true }),
          apiKey,
          model: config.get('LLM_MODEL', { infer: true }),
          timeoutMs: config.get('LLM_TIMEOUT_MS', { infer: true }),
        }),
      );
    }
    models.push(new RulesTriageModel());
    return new TriageService(models);
  }

  async triage(input: TriageInput): Promise<TriageResult> {
    let lastError: unknown;
    for (const model of this.models) {
      try {
        const proposal = await model.propose(input);
        return { proposal, model: model.name };
      } catch (err) {
        lastError = err;
        this.logger.warn(`Triage model ${model.name} failed, trying the next one: ${(err as Error).message}`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All triage models failed');
  }
}
