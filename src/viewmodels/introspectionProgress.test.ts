import { describe, expect, it } from 'vitest';
import type { IntrospectionProgress } from '../../shared/types.ts';
import { describeProgress, describeResumable, formatElapsed } from './introspectionProgress.ts';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const p = (o: Partial<IntrospectionProgress> = {}): IntrospectionProgress => ({
  repo: 'api',
  depth: 'full',
  stage: 'collecting',
  done: null,
  total: null,
  startedAt: new Date(NOW - 65_000).toISOString(),
  stageStartedAt: new Date(NOW - 5_000).toISOString(),
  ...o,
});

describe('introspectionProgress', () => {
  it('formata o tempo decorrido', () => {
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('etapa contável: rótulo com posição, contador e porcentagem', () => {
    expect(describeProgress(p({ stage: 'scanning', done: 120, total: 300 }), NOW)).toEqual({
      repo: 'api',
      label: 'Etapa 4 de 6 · Lendo o código',
      counter: '120/300 arquivos',
      percent: 40,
      elapsed: '1:05',
    });
    expect(describeProgress(p({ stage: 'mapping', done: 2, total: 2 }), NOW)).toMatchObject({ counter: '2/2 lotes', percent: 100 });
    // Coleta e histórico também são contáveis (arquivos via Contents; requisições de PRs/revisões/commits).
    expect(describeProgress(p({ stage: 'collecting', done: 12, total: 40 }), NOW)).toMatchObject({
      label: 'Etapa 1 de 6 · Lendo arquivos de configuração e dependências',
      counter: '12/40 arquivos',
      percent: 30,
    });
    expect(describeProgress(p({ stage: 'history', done: 35, total: 83 }), NOW)).toMatchObject({
      label: 'Etapa 2 de 6 · Lendo PRs, revisões e commits',
      counter: '35/83 requisições',
    });
  });

  it('etapa sem contagem: barra indeterminada; rápida e média têm 4 etapas', () => {
    expect(describeProgress(p({ depth: 'medium', stage: 'analyzing' }), NOW)).toMatchObject({
      label: 'Etapa 3 de 4 · Analisando com o LLM',
      counter: null,
      percent: null,
    });
    expect(describeProgress(p({ depth: 'fast', stage: 'analyzing' }), NOW).label).toBe('Etapa 3 de 4 · Montando a proposta (heurística)');
    expect(describeProgress(p({ stage: 'scoring', done: 0, total: 0 }), NOW)).toMatchObject({
      label: 'Etapa 6 de 6 · Calculando a nota e o documento',
      percent: null,
    });
    // Etapa fora da lista da profundidade (não deveria acontecer) cai na primeira posição.
    expect(describeProgress(p({ depth: 'fast', stage: 'scanning', done: 1, total: 2 }), NOW).label).toBe('Etapa 1 de 4 · Lendo o código');
  });
});

describe('describeResumable', () => {
  it('etapa com e sem contagem', () => {
    const base = { depth: 'max' as const, updatedAt: 'x' };
    expect(describeResumable({ ...base, stage: 'scanning', done: 1200, total: 5000 })).toBe('Parou em: Lendo o código · 1200/5000 arquivos');
    expect(describeResumable({ ...base, stage: 'mapping', done: 0, total: null })).toBe('Parou em: Mapeando as chamadas com o LLM · 0 lotes');
    expect(describeResumable({ ...base, stage: 'analyzing', done: null, total: null })).toBe('Parou em: Analisando com o LLM');
  });
});
