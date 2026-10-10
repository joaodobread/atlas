import type { FormEvent } from 'react';
import { useConnectionDetailViewModel } from '../../viewmodels/useConnectionDetailViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Section } from '../common/Section.tsx';

const onSubmit = (fn: () => unknown) => (e: FormEvent) => {
  e.preventDefault();
  void fn();
};

export function ConnectionDetailView({ connectionId }: { connectionId: number }) {
  const vm = useConnectionDetailViewModel(connectionId);
  if (!vm.conn) return <p className="muted">Conexão não encontrada.</p>;

  const f = vm.form;
  const cs = vm.callSiteForm;
  const conn = vm.conn;

  return (
    <div className="detail">
      <div className="detail-header">
        <span className="arrow-icon">⇢</span>
        <div>
          <h2>Conexão</h2>
          <p className="flow">
            <span className="link" onClick={() => vm.selectNode(conn.source_id)}>
              {vm.sourcePath}
            </span>
            <span className="muted"> chama </span>
            <span className="link" onClick={() => vm.selectNode(conn.target_id)}>
              {vm.targetPath}
            </span>
          </p>
        </div>
      </div>

      <fieldset className="plain" disabled={!vm.canEdit}>
        <form className="card" onSubmit={onSubmit(vm.save)}>
          <div className="row">
            <Field label="Protocolo" error={f.errors.protocol}>
              <select value={f.values.protocol} onChange={(e) => f.set('protocol', e.target.value)}>
                <option value="">—</option>
                {vm.protocols.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Interface do destino" error={f.errors.target_interface_id}>
              <select value={f.values.target_interface_id} onChange={(e) => f.set('target_interface_id', e.target.value)}>
                <option value="">— nenhuma —</option>
                {vm.targetInterfaces.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Implementa a saída" error={f.errors.parent_connection_id}>
            <select value={f.values.parent_connection_id} onChange={(e) => f.set('parent_connection_id', e.target.value)}>
              <option value="">— nenhuma —</option>
              {vm.parentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descrição" error={f.errors.description}>
            <textarea rows={2} value={f.values.description} onChange={(e) => f.set('description', e.target.value)} />
          </Field>
          <div className="row actions">
            <button className="primary" disabled={vm.busy}>
              Salvar
            </button>
            {vm.canEdit && (
              <button type="button" className="danger" disabled={vm.busy} onClick={vm.remove}>
                Excluir
              </button>
            )}
          </div>
        </form>

        {vm.parent && (
          <Section title="Implementa">
            <p className="link" onClick={() => vm.selectConnection(vm.parent!.id)}>
              {vm.label(vm.parent)}
            </p>
          </Section>
        )}

        <Section title="Implementada por" count={vm.implementations.length}>
          {vm.implementations.length === 0 ? (
            <p className="muted">Nenhum submódulo detalha esta saída ainda.</p>
          ) : (
            <ul className="list">
              {vm.implementations.map((c) => (
                <li key={c.id} className="link" onClick={() => vm.selectConnection(c.id)}>
                  {c.label}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Onde a chamada é feita" count={vm.callSites.length}>
          <ul className="list">
            {vm.callSites.map((s) => (
              <li key={s.id}>
                <span>
                  <code>
                    {s.file_path}
                    {s.line != null && `:${s.line}`}
                  </code>
                  {s.symbol && <span className="muted"> {s.symbol}</span>}
                  {s.notes && <span className="note">{s.notes}</span>}
                </span>
                <button className="icon" title="Remover" onClick={() => vm.removeCallSite(s.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className="card nested" onSubmit={onSubmit(vm.addCallSite)}>
            <div className="row">
              <Field label="Arquivo" error={cs.errors.file_path}>
                <input placeholder="src/users/user.client.ts" value={cs.values.file_path} onChange={(e) => cs.set('file_path', e.target.value)} />
              </Field>
              <Field label="Linha" error={cs.errors.line}>
                <input className="narrow" inputMode="numeric" value={cs.values.line} onChange={(e) => cs.set('line', e.target.value)} />
              </Field>
            </div>
            <div className="row">
              <Field label="Símbolo" error={cs.errors.symbol}>
                <input placeholder="UserClient.fetchAll" value={cs.values.symbol} onChange={(e) => cs.set('symbol', e.target.value)} />
              </Field>
              <Field label="Notas" error={cs.errors.notes}>
                <input value={cs.values.notes} onChange={(e) => cs.set('notes', e.target.value)} />
              </Field>
            </div>
            <button className="primary" disabled={vm.busy}>
              Registrar local
            </button>
          </form>
        </Section>
      </fieldset>
    </div>
  );
}
