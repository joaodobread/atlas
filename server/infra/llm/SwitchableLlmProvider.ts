import type { ILlmProvider, JsonOutputSpec, LlmRequest } from './ILlmProvider.ts';
import { NullLlmProvider } from './NullLlmProvider.ts';

export interface ISwitchableLlm extends ILlmProvider {
  /** Troca o provedor em uso (configuração alterada pela interface). */
  use(provider: ILlmProvider): void;
}

/** Fachada estável injetada nos services; o provedor real pode mudar em tempo de execução. */
export class SwitchableLlmProvider implements ISwitchableLlm {
  private current: ILlmProvider = new NullLlmProvider();

  use(provider: ILlmProvider): void {
    this.current = provider;
  }

  get provider() {
    return this.current.provider;
  }

  get model() {
    return this.current.model;
  }

  get configured() {
    return this.current.configured;
  }

  complete(request: LlmRequest): Promise<string> {
    return this.current.complete(request);
  }

  completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    return this.current.completeJson(request, spec);
  }
}
