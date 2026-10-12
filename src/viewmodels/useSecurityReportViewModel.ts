import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RiskLevel, SecurityPortfolioView, SecurityReportRecord, SecurityRepoView } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { ReportApi } from '../data/api/ReportApi.ts';
import {
  AXIS_HINT,
  AXIS_LABEL,
  EFFORT_LABEL,
  formatWhen,
  HORIZON_LABEL,
  MATURITY_LABELS,
  pctOf,
  RISK_LABEL,
  RISK_LEVELS,
  riskRank,
  scoreBand,
  securityMarkdown,
  SECURITY_AXES,
  STATUS_LABEL,
} from '../domain/securityReport.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { usePermissions } from './usePermissions.ts';

export type ReportKind = SecurityReportRecord['kind'];

/** Tela de segurança/DevSecOps: portfólio ou um repositório, relatório escrito, dicas e histórico. */
export function useSecurityReportViewModel() {
  const scope = useUiStore((s) => s.securityScope);
  const showSecurity = useUiStore((s) => s.showSecurity);
  const showRepos = useUiStore((s) => s.showRepos);
  const pushToast = useUiStore((s) => s.pushToast);
  const perms = usePermissions();

  const [portfolio, setPortfolio] = useState<SecurityPortfolioView | null>(null);
  const [repoView, setRepoView] = useState<SecurityRepoView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<ReportKind | null>(null);
  const [focus, setFocus] = useState('');
  /** Relatório/dicas escolhidos no histórico (por escopo; null = os mais recentes). */
  const [pickedState, setPicked] = useState<{ key: string; id: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [risk, setRisk] = useState<RiskLevel | ''>('');
  const key = scope ? `${scope.owner}/${scope.name}` : '*';
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async () => {
    const requested = key;
    setLoading(true);
    setError(null);
    try {
      const api = ReportApi.getInstance();
      if (scope) {
        const v = await api.securityRepo(scope.owner, scope.name);
        if (keyRef.current === requested) setRepoView(v);
      } else {
        const v = await api.securityPortfolio();
        if (keyRef.current === requested) setPortfolio(v);
      }
    } catch (err) {
      if (keyRef.current === requested) setError(errorMessage(err));
    } finally {
      if (keyRef.current === requested) setLoading(false);
    }
  }, [key, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickedId = pickedState?.key === key ? pickedState.id : null;
  const setPickedId = (id: number | null) => setPicked(id == null ? null : { key, id });

  const view = scope ? repoView : portfolio;
  const reports = view?.reports ?? [];
  const picked = reports.find((r) => r.id === pickedId) ?? null;
  const latest = (kind: ReportKind) => reports.find((r) => r.kind === kind) ?? null;
  const report = picked?.kind === 'report' ? picked : latest('report');
  const tips = picked?.kind === 'tips' ? picked : latest('tips');

  const generate = async (kind: ReportKind) => {
    setGenerating(kind);
    try {
      const created = await ReportApi.getInstance().generateSecurity({
        ...(scope ? { owner: scope.owner, repo: scope.name } : {}),
        kind,
        ...(focus.trim() ? { focus: focus.trim() } : {}),
      });
      if (created.llmError) pushToast('error', `O LLM falhou (${created.llmError}); o conteúdo foi gerado pela heurística.`);
      else pushToast('success', kind === 'tips' ? 'Dicas geradas.' : 'Relatório gerado.');
      setPickedId(null);
      await load();
    } catch (err) {
      pushToast('error', errorMessage(err));
    } finally {
      setGenerating(null);
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (portfolio?.posture.rows ?? [])
      .filter((r) => (!risk || r.risk === risk) && (!q || `${r.owner}/${r.name}`.toLowerCase().includes(q)))
      .sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || (a.score ?? 101) - (b.score ?? 101));
  }, [portfolio, filter, risk]);

  const exportMarkdown = () => {
    const md = securityMarkdown({
      posture: scope ? (repoView?.posture ?? null) : null,
      portfolio: scope ? null : (portfolio?.posture ?? null),
      report,
      tips,
    });
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const name = scope ? `${scope.owner}-${scope.name}` : 'portfolio';
    Object.assign(document.createElement('a'), { href: url, download: `seguranca-${name}-${new Date().toISOString().slice(0, 10)}.md` }).click();
    URL.revokeObjectURL(url);
  };

  return {
    scope,
    loading,
    error,
    reload: () => void load(),
    portfolio: portfolio?.posture ?? null,
    posture: repoView?.posture ?? null,
    llm: view?.llm ?? null,
    reports,
    report,
    tips,
    pickedId,
    pick: (id: number | null) => setPickedId(id),
    canGenerate: perms.canEditGraph,
    generating,
    generate: (kind: ReportKind) => void generate(kind),
    focus,
    setFocus,
    filter,
    setFilter,
    risk,
    setRisk,
    rows,
    openRepo: (owner: string, name: string) => showSecurity({ owner, name }),
    back: () => showSecurity(null),
    openRepos: showRepos,
    exportMarkdown,
    print: () => window.print(),
    labels: {
      axis: AXIS_LABEL,
      axisHint: AXIS_HINT,
      status: STATUS_LABEL,
      horizon: HORIZON_LABEL,
      effort: EFFORT_LABEL,
      risk: RISK_LABEL,
      maturity: MATURITY_LABELS,
    },
    axes: SECURITY_AXES,
    riskLevels: RISK_LEVELS,
    band: scoreBand,
    pct: pctOf,
    when: formatWhen,
  };
}
