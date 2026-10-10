import { BusinessRuleError } from '../../core/errors/AppError.ts';
import type { ILlmProvider } from './ILlmProvider.ts';

/** Usado quando nenhum LLM está configurado (LLM_PROVIDER=none). */
export class NullLlmProvider implements ILlmProvider {
  readonly provider = 'none' as const;
  readonly model = null;
  readonly configured = false;

  complete(): Promise<string> {
    return Promise.reject(new BusinessRuleError('Nenhum LLM configurado. Defina LLM_PROVIDER no .env (veja .env.example).'));
  }

  completeJson<T>(): Promise<T> {
    return this.complete() as Promise<never>;
  }
}
