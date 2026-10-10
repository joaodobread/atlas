import type { FormEvent } from 'react';
import { useDocsPanelViewModel, type SearchMode } from '../../viewmodels/useDocsPanelViewModel.ts';
import { NodeIcon } from '../icons/NodeIcon.tsx';
import { DocsManager } from './DocsManager.tsx';

const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: 'hybrid', label: 'Híbrida' },
  { value: 'text', label: 'Texto' },
  { value: 'semantic', label: 'Semântica' },
];

export function DocsPanel() {
  const vm = useDocsPanelViewModel();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.search();
  };

  return (
    <div className="docs-panel">
      <form className="search-box" onSubmit={submit}>
        <textarea
          data-tour="docs-search"
          rows={2}
          placeholder="Buscar ou perguntar: “quem usa a tabela users?”"
          value={vm.query}
          onChange={(e) => vm.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void vm.search();
            }
          }}
        />
        <div className="row">
          <select value={vm.mode} onChange={(e) => vm.setMode(e.target.value as SearchMode)} aria-label="Tipo de busca">
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="primary" disabled={vm.searching || vm.asking}>
            {vm.searching ? 'Buscando…' : 'Buscar'}
          </button>
          <button
            type="button"
            disabled={!vm.llmConfigured || vm.asking || vm.searching}
            title={vm.llmConfigured ? `Responder com ${vm.llmLabel}` : 'Configure um LLM no .env (LLM_PROVIDER)'}
            onClick={() => void vm.ask()}
          >
            {vm.asking ? 'Pensando…' : 'Perguntar'}
          </button>
        </div>
        {vm.error && <p className="field-error">{vm.error}</p>}
        {vm.noDocuments && <p className="hint">Nenhum documento ainda — adicione .md abaixo.</p>}
      </form>

      {vm.answer && (
        <section className="answer">
          <h3>
            Resposta <span className="muted small">{vm.answer.model}</span>
          </h3>
          <p className="answer-text">
            {vm.answerParts(vm.answer.answer).map((p, i) =>
              p.cite != null ? (
                <button key={i} className="cite" onClick={() => vm.openCitation(p.cite!)}>
                  {p.text}
                </button>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        </section>
      )}

      {vm.result && (
        <>
          {vm.affected.length > 0 && (
            <section className="affected">
              <h3>
                Módulos afetados <span className="count">{vm.affected.length}</span>
              </h3>
              <div className="chips">
                {vm.affected.map((n) => (
                  <button key={n.id} className="chip" title={n.path} onClick={() => vm.focusNode(n.id)}>
                    <NodeIcon id={n.icon} size={12} color={n.color} />
                    {n.name}
                    <span className="muted">{n.hits}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="hits">
            <h3>
              {vm.answer ? 'Fontes' : 'Resultados'} <span className="count">{vm.result.hits.length}</span>
              <button className="link-button" onClick={vm.clear}>
                limpar
              </button>
            </h3>
            {vm.result.semanticUnavailable && <p className="hint">Busca semântica indisponível agora (modelo carregando); mostrando só texto.</p>}
            {vm.result.hits.length === 0 && <p className="muted">Nada encontrado.</p>}
            <ol className="hit-list">
              {vm.result.hits.map((h, i) => (
                <li key={h.chunkId} className="hit">
                  <button className="hit-head" onClick={() => vm.openHit(h)}>
                    {vm.answer && <span className="cite-n">[{i + 1}]</span>}
                    <span className="hit-file">{h.title}</span>
                    {vm.isModelHit(h) ? (
                      <span className="tag model">modelo</span>
                    ) : (
                      <span className="muted">
                        :{h.startLine}-{h.endLine}
                      </span>
                    )}
                  </button>
                  {h.heading && <div className="hit-heading">{h.heading}</div>}
                  <p className="hit-snippet">
                    {vm.snippetParts(h.snippet).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                  </p>
                  <div className="hit-meta">
                    {h.matchedBy.map((m) => (
                      <span key={m} className="tag subtle">
                        {m === 'text' ? 'texto' : 'semântica'}
                      </span>
                    ))}
                    {vm.nodesOf(h).map((n) => (
                      <button key={n.id} className="chip small" title={n.path} onClick={() => vm.focusNode(n.id)}>
                        <NodeIcon id={n.icon} size={10} color={n.color} />
                        {n.name}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <DocsManager />
    </div>
  );
}
