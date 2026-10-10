import type { FormEvent } from 'react';
import type { NodeKind } from '../../../shared/constants.ts';
import { useNodeDetailViewModel } from '../../viewmodels/useNodeDetailViewModel.ts';
import { Field } from '../common/Field.tsx';
import { IconPicker } from '../common/IconPicker.tsx';
import { NodeIcon } from '../icons/NodeIcon.tsx';
import { NodeMentions } from './NodeMentions.tsx';
import { Section } from '../common/Section.tsx';

type ConnectionRow = ReturnType<typeof useNodeDetailViewModel>['outgoing'][number];

const onSubmit = (fn: () => unknown) => (e: FormEvent) => {
  e.preventDefault();
  void fn();
};

export function NodeDetailView({ nodeId }: { nodeId: number }) {
  const vm = useNodeDetailViewModel(nodeId);
  if (!vm.node) return <p className="muted">Nó não encontrado.</p>;

  const nf = vm.nodeForm;
  const cf = vm.childForm;
  const inf = vm.interfaceForm;
  const of = vm.outputForm;

  return (
    <div className="detail">
      <div className="detail-header">
        <span className="header-icon" style={{ borderColor: vm.color }}>
          <NodeIcon id={vm.icon} size={20} color={vm.color} />
        </span>
        <div>
          <h2>{vm.node.name}</h2>
          <p className="muted path">{vm.path}</p>
        </div>
      </div>

      <fieldset className="plain" disabled={!vm.canEdit}>
        <form className="card" onSubmit={onSubmit(vm.save)}>
          <div className="row">
            <Field label="Ícone">
              <IconPicker value={nf.values.icon} onChange={(v) => nf.set('icon', v)} kind={nf.values.kind} tech={nf.values.tech} />
            </Field>
            <Field label="Nome" error={nf.errors.name}>
              <input value={nf.values.name} onChange={(e) => nf.set('name', e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <Field label="Tipo" error={nf.errors.kind}>
              <select value={nf.values.kind} onChange={(e) => nf.set('kind', e.target.value as NodeKind)}>
                {vm.kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tecnologia" error={nf.errors.tech}>
              <input value={nf.values.tech} onChange={(e) => nf.set('tech', e.target.value)} />
            </Field>
          </div>
          <Field label="Pertence a" error={nf.errors.parent_id}>
            <select value={nf.values.parent_id} onChange={(e) => nf.set('parent_id', e.target.value)}>
              <option value="">— raiz —</option>
              {vm.parentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descrição" error={nf.errors.description}>
            <textarea rows={2} value={nf.values.description} onChange={(e) => nf.set('description', e.target.value)} />
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

        <Section title="Submódulos" count={vm.children.length}>
          <ul className="list">
            {vm.children.map((c) => (
              <li key={c.id} className="link" onClick={() => vm.selectNode(c.id)}>
                {c.name} <span className="muted">{c.tech}</span>
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={onSubmit(vm.addChild)}>
            <Field error={cf.errors.name}>
              <input placeholder="Novo submódulo" value={cf.values.name} onChange={(e) => cf.set('name', e.target.value)} />
            </Field>
            <select value={cf.values.kind} onChange={(e) => cf.set('kind', e.target.value as NodeKind)}>
              {vm.kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <button disabled={vm.busy}>+</button>
          </form>
        </Section>

        <Section title="Interfaces expostas" count={vm.interfaces.length}>
          <p className="hint">O que outros nós podem chamar aqui: endpoints, tabelas, tópicos, métodos.</p>
          <ul className="list">
            {vm.interfaces.map((i) => (
              <li key={i.id}>
                <span>
                  <code>{i.name}</code> {i.type && <span className="tag">{i.type}</span>}
                  {i.spec && <span className="muted"> {i.spec}</span>}
                </span>
                <button className="icon" title="Remover" onClick={() => vm.removeInterface(i.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={onSubmit(vm.addInterface)}>
            <Field error={inf.errors.name}>
              <input placeholder="ex.: GET /users" value={inf.values.name} onChange={(e) => inf.set('name', e.target.value)} />
            </Field>
            <input placeholder="tipo" className="narrow" value={inf.values.type} onChange={(e) => inf.set('type', e.target.value)} />
            <button disabled={vm.busy}>+</button>
          </form>
        </Section>

        <Section title="Saídas (chama →)" count={vm.outgoing.length}>
          <ConnectionList rows={vm.outgoing} side="target" onOpen={vm.selectConnection} onRemove={vm.removeConnection} />

          <form className="card nested" onSubmit={onSubmit(vm.addOutput)}>
            <h4>Nova saída</h4>
            {vm.inheritedOutputs.length > 0 && (
              <Field label="Usar saída de um nó pai">
                <select value={of.values.inherit} onChange={(e) => vm.inheritOutput(e.target.value)}>
                  <option value="">— não —</option>
                  {vm.inheritedOutputs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.source} → {c.target}
                      {c.iface ? ` [${c.iface}]` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Destino" error={of.errors.target_id}>
              <select
                value={of.values.target_id}
                onChange={(e) => {
                  of.set('target_id', e.target.value);
                  of.set('target_interface_id', '');
                }}
              >
                <option value="">— escolha —</option>
                {vm.targetOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row">
              <Field label="Interface do destino" error={of.errors.target_interface_id}>
                <select
                  value={of.values.target_interface_id}
                  disabled={!of.values.target_id || !!of.values.new_interface}
                  onChange={(e) => of.set('target_interface_id', e.target.value)}
                >
                  <option value="">— nenhuma —</option>
                  {vm.targetInterfaces.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ou nova interface" error={of.errors.name}>
                <input
                  placeholder="ex.: POST /orders"
                  disabled={!of.values.target_id}
                  value={of.values.new_interface}
                  onChange={(e) => of.set('new_interface', e.target.value)}
                />
              </Field>
            </div>
            <div className="row">
              <Field label="Protocolo" error={of.errors.protocol}>
                <select value={of.values.protocol} onChange={(e) => of.set('protocol', e.target.value)}>
                  {vm.protocols.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Descrição" error={of.errors.description}>
                <input value={of.values.description} onChange={(e) => of.set('description', e.target.value)} />
              </Field>
            </div>
            <button className="primary" disabled={vm.busy}>
              Adicionar saída
            </button>
          </form>
        </Section>

        <Section title="Entradas (← chamado por)" count={vm.incoming.length}>
          <ConnectionList rows={vm.incoming} side="source" onOpen={vm.selectConnection} onRemove={vm.removeConnection} />
        </Section>

        <NodeMentions nodeId={nodeId} />
      </fieldset>
    </div>
  );
}

interface ConnectionListProps {
  rows: ConnectionRow[];
  side: 'source' | 'target';
  onOpen(id: number): void;
  onRemove(id: number): void;
}

function ConnectionList({ rows, side, onOpen, onRemove }: ConnectionListProps) {
  if (!rows.length) return <p className="muted">Nenhuma.</p>;
  return (
    <ul className="list">
      {rows.map((c) => (
        <li key={c.id} className="link" onClick={() => onOpen(c.id)}>
          <span>
            {side === 'target' ? '→ ' : '← '}
            {side === 'target' ? c.target : c.source}
            {c.iface && <code> {c.iface}</code>}
            {c.protocol && <span className="tag">{c.protocol}</span>}
            {c.implementsParent && <span className="tag subtle">herdada</span>}
            {c.callSiteCount > 0 && <span className="tag subtle">{c.callSiteCount} loc</span>}
          </span>
          <button
            className="icon"
            title="Excluir"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(c.id);
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
