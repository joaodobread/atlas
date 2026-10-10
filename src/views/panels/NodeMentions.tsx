import { useNodeMentionsViewModel } from '../../viewmodels/useNodeMentionsViewModel.ts';
import { Section } from '../common/Section.tsx';

export function NodeMentions({ nodeId }: { nodeId: number }) {
  const vm = useNodeMentionsViewModel(nodeId);
  if (!vm.mentions) return null;
  return (
    <Section title="Mencionado em documentos" count={vm.mentions.length}>
      {vm.mentions.length === 0 ? (
        <p className="muted">Nenhum documento menciona este nó.</p>
      ) : (
        <ul className="list">
          {vm.mentions.map((m) => (
            <li key={m.chunkId} className="link mention" onClick={() => vm.open(m)}>
              <span>
                <span className="hit-file">{vm.fileName(m.path)}</span>
                <span className="muted">
                  :{m.startLine}-{m.endLine}
                </span>
                {m.method !== 'exact' && (
                  <span className="tag subtle" title={`Confiança ${Math.round(m.confidence * 100)}%`}>
                    {m.method === 'llm' ? 'IA' : 'aprox.'}: “{m.matched}”
                  </span>
                )}
                {m.heading && <span className="note">{m.heading}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
