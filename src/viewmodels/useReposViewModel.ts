import { useEffect, useMemo, useRef, useState } from 'react';
import { daysSince, HEALTH_LIMITS, monthsSince } from '../../shared/repoHealth.ts';
import type {
  AttentionLevel,
  IntrospectionRunState,
  QualityCategory,
  QualityCheckStatus,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
} from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { GithubApi } from '../data/api/GithubApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { describeProgress } from './introspectionProgress.ts';
import { useCommand } from './useCommand.ts';
import { usePermissions } from './usePermissions.ts';

const POLL_MS = 2500;

export const CHECK_STATUS_LABEL: Record<QualityCheckStatus, string> = { pass: 'PASSOU', fail: 'FALHOU', warn: 'ATENÇÃO', na: 'N/A', unknown: 'DESCONHECIDO' };
export const CATEGORY_LABEL: Record<QualityCategory, string> = {
  ci: 'CI & relatório',
  tests: 'Testes',
  security: 'Segurança',
  guardrails: 'Guardrails',
  process: 'Processo',
  docs: 'Documentação',
};

export type Band = 'good' | 'mid' | 'bad' | 'none';
export const BAND_LABEL: Record<Band, string> = { good: 'Bom (≥ 8)', mid: 'Atenção (5–7,9)', bad: 'Ruim (< 5)', none: 'Sem nota' };
export const bandOf = (score: number | null): Band => (score == null ? 'none' : score >= 8 ? 'good' : score >= 5 ? 'mid' : 'bad');

export const ATTENTION_LABEL: Record<AttentionLevel, string> = { attention: 'Precisa de atenção', watch: 'Observar', ok: 'Ok' };
const ATTENTION_RANK: Record<AttentionLevel, number> = { attention: 2, watch: 1, ok: 0 };

/** Filtro de atividade: sem commits há pelo menos N meses. */
export const IDLE_OPTIONS = [3, 6, 12, 24] as const;
export type IdleFilter = (typeof IDLE_OPTIONS)[number] | '';
export type AttentionFilter = '' | 'attention' | 'watch';

/** "hoje", "há 12 dias", "há 3 meses", "há 2 anos". */
export function ageLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const days = daysSince(iso, now);
  if (days < 1) return 'hoje';
  if (days < 60) return `há ${days} dia${days === 1 ? '' : 's'}`;
  const months = monthsSince(iso, now)!;
  return months < 24 ? `há ${months} meses` : `há ${Math.floor(months / 12)} anos`;
}

/** Classe de cor pela idade do último push. */
export const idleClass = (iso: string | null, now = Date.now()): string => {
  const m = monthsSince(iso, now);
  return m == null ? 'muted' : m >= HEALTH_LIMITS.idleAttentionMonths ? 'bad-text' : m >= HEALTH_LIMITS.idleWatchMonths ? 'warn-text' : '';
};

type SortKey = 'system' | 'name' | 'score' | 'confidence' | 'coverage' | 'security' | 'pushedAt' | 'attention' | 'openPrs';
const NO_SYSTEM = 'Sem sistema';

/** Ordena com nulos sempre no fim. */
function compare(a: number | string | null, b: number | string | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * dir;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function useReposViewModel() {
  const pushToast = useUiStore((s) => s.pushToast);
  const openDocument = useUiStore((s) => s.openDocument);
  const openSettings = useUiStore((s) => s.openSettings);
  const graphId = useUiStore((s) => s.graphId);
  const graphs = useGraphStore((s) => s.graphs);
  const perms = usePermissions();
  const command = useCommand();
  const [repos, setRepos] = useState<RepoIntrospectionSummary[]>([]);
  const [state, setState] = useState<IntrospectionRunState | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RepoIntrospectionDetail | null>(null);
  const [filter, setFilter] = useState('');
  const [band, setBand] = useState<Band | ''>('');
  const [failing, setFailing] = useState<QualityCategory | ''>('');
  const [idle, setIdle] = useState<IdleFilter>('');
  const [attention, setAttention] = useState<AttentionFilter>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'system', dir: 1 });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const api = GithubApi.getInstance();
  const fail = (err: unknown) => pushToast('error', errorMessage(err));
  const loadDetail = (id: number) => api.repo(id).then(setDetail).catch(fail);

  const refresh = async () => {
    const [list, st] = await Promise.all([api.repos(), api.state()]);
    setRepos(list);
    setState(st);
    if (selectedRef.current != null) void loadDetail(selectedRef.current);
    return st;
  };

  useEffect(() => {
    void refresh().catch(fail);
  }, []);

  // Enquanto houver análise rodando, atualiza periodicamente.
  useEffect(() => {
    if (!state?.running && !state?.queued) return;
    const t = setTimeout(() => {
      void refresh()
        .then((st) => {
          if (!st.running && !st.queued) void DocsSync.getInstance().reload();
        })
        .catch(fail);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [state]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const currentGraphName = graphs.find((g) => g.id === graphId)?.name ?? 'atual';

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return repos.filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || (r.system ?? '').toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) &&
        (!band || bandOf(r.score) === band) &&
        (!failing || r.failingCategories.includes(failing)) &&
        (!idle || (monthsSince(r.pushedAt) ?? 0) >= idle) &&
        (!attention || ATTENTION_RANK[r.attention.level] >= ATTENTION_RANK[attention]),
    );
  }, [repos, filter, band, failing, idle, attention]);

  /** Padrão: agrupado por sistema, piores primeiro; sem sistema no fim. Outras colunas: lista única. */
  const groups = useMemo(() => {
    const value = (r: RepoIntrospectionSummary): number | string | null =>
      ({
        system: r.score,
        name: r.name,
        score: r.score,
        confidence: r.confidence,
        coverage: r.coverage,
        security: r.securityFindings,
        pushedAt: r.pushedAt,
        // Nível primeiro; empate pelo número de motivos.
        attention: ATTENTION_RANK[r.attention.level] * 100 + r.attention.reasons.length,
        openPrs: r.activity?.openPrs ?? null,
      })[sort.key];
    const rows = [...filtered].sort((a, b) => compare(value(a), value(b), sort.key === 'system' ? 1 : sort.dir) || a.name.localeCompare(b.name));
    if (sort.key !== 'system') return [{ name: null as string | null, repos: rows }];
    const bySystem = new Map<string, RepoIntrospectionSummary[]>();
    for (const r of rows) bySystem.set(r.system ?? NO_SYSTEM, [...(bySystem.get(r.system ?? NO_SYSTEM) ?? []), r]);
    const worst = (list: RepoIntrospectionSummary[]) => Math.min(...list.map((r) => r.score ?? 11));
    return [...bySystem.entries()]
      .sort(([a, la], [b, lb]) => (a === NO_SYSTEM ? 1 : b === NO_SYSTEM ? -1 : worst(la) - worst(lb) || a.localeCompare(b)))
      .map(([name, list]) => ({ name: name as string | null, repos: list }));
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const bands: Record<Band, number> = { good: 0, mid: 0, bad: 0, none: 0 };
    for (const r of repos) bands[bandOf(r.score)]++;
    const analyzed = repos.filter((r) => r.analyzedAt);
    const conf = median(analyzed.map((r) => r.confidence).filter((c): c is number => c != null));
    return {
      total: repos.length,
      analyzed: analyzed.length,
      bands,
      withMetrics: analyzed.length ? Math.round((analyzed.filter((r) => r.hasMetrics).length / analyzed.length) * 100) : null,
      medianConfidence: conf == null ? null : Math.round(conf * 100),
      linked: repos.filter((r) => r.nodeId != null).length,
      needAttention: repos.filter((r) => r.attention.level === 'attention').length,
      watch: repos.filter((r) => r.attention.level === 'watch').length,
      idleYear: repos.filter((r) => !r.archived && (monthsSince(r.pushedAt) ?? 0) >= HEALTH_LIMITS.idleAttentionMonths).length,
      oldPrs: repos.reduce((a, r) => a + (r.activity?.oldPrs ?? 0), 0),
      reposWithOldPrs: repos.filter((r) => (r.activity?.oldPrs ?? 0) > 0).length,
      /** Repositórios cujo token não deixou ler PRs. */
      prsUnreadable: repos.filter((r) => r.activity && r.activity.openPrs == null).length,
    };
  }, [repos]);

  return {
    groups,
    visibleCount: filtered.length,
    /** Repositórios em análise agora (etapa, barra, tempo). */
    progressRows: (state?.progress ?? []).map((p) => describeProgress(p)),
    stats,
    state,
    detail,
    selectedId,
    filter,
    setFilter,
    band,
    setBand,
    failing,
    setFailing,
    idle,
    setIdle,
    attention,
    setAttention,
    /** Atalho dos cartões: mostra só quem precisa de atenção / parados há 1 ano, ordenado pelo pior. */
    showAttention: () => {
      setAttention('attention');
      setSort({ key: 'attention', dir: -1 });
    },
    showIdleYear: () => {
      setIdle(12);
      setSort({ key: 'pushedAt', dir: 1 });
    },
    showOldPrs: () => setSort({ key: 'openPrs', dir: -1 }),
    sort,
    sortBy: (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'system' ? 1 : -1 })),
    checked,
    force,
    setForce,
    busy: busy || command.busy,
    canRun: perms.canEditGraph,
    canConfigure: perms.canManageSettings,
    toggleChecked: (name: string) =>
      setChecked((s) => {
        const next = new Set(s);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      }),
    select: (id: number) => {
      setSelectedId(id);
      setDetail(null);
      void loadDetail(id);
    },
    closeDetail: () => {
      setSelectedId(null);
      setDetail(null);
    },
    sync: () =>
      withBusy(async () => {
        setRepos(await api.sync());
        pushToast('success', 'Lista de repositórios atualizada');
      }),
    introspect: (onlyChecked: boolean) =>
      withBusy(async () => {
        setState(await api.introspect({ repos: onlyChecked ? [...checked] : undefined, force, depth: 'medium' }));
        setRepos(await api.repos());
      }),
    apply: async () => {
      if (!detail) return;
      const r = await command.run(() => api.apply(detail.id, graphId), `Proposta aplicada no grafo “${currentGraphName}”`);
      if (r) {
        if (r.warnings.length) pushToast('info', r.warnings.join('; '));
        void refresh().catch(fail);
      }
    },
    openDocument: () => {
      if (detail?.documentId) openDocument({ documentId: detail.documentId });
    },
    openSettings: () => openSettings('github'),
    currentGraphName,
    /** Repositórios marcados (para a janela "Gerar grafo"). */
    selectedRepos: repos.filter((r) => checked.has(r.name)),
    generating,
    openGenerate: () => setGenerating(true),
    closeGenerate: () => {
      setGenerating(false);
      void refresh().catch(fail);
    },
    bandOf,
    statusLabel: CHECK_STATUS_LABEL,
    categoryLabel: CATEGORY_LABEL,
    bandLabel: BAND_LABEL,
    attentionLabel: ATTENTION_LABEL,
    idleOptions: IDLE_OPTIONS,
    ageLabel,
    idleClass,
  };
}

export type ReposViewModel = ReturnType<typeof useReposViewModel>;
