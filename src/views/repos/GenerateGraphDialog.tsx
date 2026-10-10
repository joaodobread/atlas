import type { RepoIntrospectionSummary } from '../../../shared/types.ts';
import { useGenerateGraphViewModel } from '../../viewmodels/useGenerateGraphViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Modal } from '../common/Modal.tsx';
import { ProgressList } from './ProgressList.tsx';

export function GenerateGraphDialog({ repos, onClose }: { repos: RepoIntrospectionSummary[]; onClose(): void }) {
  const vm = useGenerateGraphViewModel(repos, onClose);
  return (
    <Modal title="Gerar grafo" onClose={vm.close}>
      <p className="muted small">
        {vm.selectedNames.length} repositório(s): {vm.selectedNames.join(', ')}
      </p>
      <Field label="Nome do grafo">
        <input value={vm.name} disabled={vm.busy} onChange={(e) => vm.setName(e.target.value)} />
      </Field>

      <div className="depth-options" role="radiogroup" aria-label="Profundidade">
        {vm.options.map((o) => (
          <label key={o.depth} className={`depth-option${vm.depth === o.depth ? ' active' : ''}`}>
            <input type="radio" name="depth" checked={vm.depth === o.depth} disabled={vm.busy} onChange={() => vm.setDepth(o.depth)} />
            <span>
              <strong>{o.label}</strong>
              <span className="muted small">{o.description}</span>
            </span>
          </label>
        ))}
      </div>

      {vm.pendingCount > 0 && <p className="hint">{vm.pendingCount} repositório(s) serão (re)analisados nessa profundidade antes de gerar.</p>}
      {vm.showLlmWarning && (
        <p className="warn-box">Nenhum LLM configurado: a análise cai no modo heurístico (bem menos detalhada). Configure em Configurações → LLM.</p>
      )}
      {vm.showCostWarning && (
        <div className="warn-box">
          <strong>Atenção: a geração completa consome muitos tokens.</strong> Para cada repositório o servidor lê até 300 arquivos de código pela API do GitHub
          e envia as chamadas encontradas ao LLM em lotes (várias requisições grandes por repositório, com esforço alto). Com {vm.selectedNames.length}{' '}
          repositório(s) isso pode levar vários minutos e custar bem mais que a média.
          <label className="check">
            <input type="checkbox" checked={vm.acknowledged} disabled={vm.busy} onChange={(e) => vm.setAcknowledged(e.target.checked)} />
            Entendo o custo e quero continuar
          </label>
        </div>
      )}

      {vm.phase.type === 'analyzing' && (
        <>
          <p className="hint">
            Analisando repositórios… {vm.phase.done}/{vm.phase.total} concluído(s). Pode fechar a janela: a análise continua no servidor.
          </p>
          <ProgressList rows={vm.phase.progress} />
        </>
      )}
      {vm.phase.type === 'generating' && <p className="hint">Montando o grafo…</p>}
      {vm.error && <p className="field-error">{vm.error}</p>}

      <div className="row actions">
        <button className="primary" disabled={!vm.canSubmit} onClick={vm.submit}>
          {vm.busy ? 'Gerando…' : 'Gerar grafo'}
        </button>
        <button onClick={vm.close}>{vm.busy ? 'Fechar (continua analisando)' : 'Cancelar'}</button>
      </div>
    </Modal>
  );
}
