import { useEffect, useState } from 'react';
import { updateGithubSettingsSchema } from '../../shared/schemas.ts';
import type { GithubSettingsView, GithubTestResult } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { GithubApi } from '../data/api/GithubApi.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useForm } from './useForm.ts';

interface GithubForm {
  owner: string;
  /** Vazio = manter o token salvo. */
  token: string;
  clearToken: boolean;
  includeArchived: boolean;
  includeForks: boolean;
  /** Vazio = todos. */
  pushedWithinMonths: string;
}

const toForm = (s: GithubSettingsView): GithubForm => ({
  owner: s.owner ?? '',
  token: '',
  clearToken: false,
  includeArchived: s.includeArchived,
  includeForks: s.includeForks,
  pushedWithinMonths: s.pushedWithinMonths == null ? '' : String(s.pushedWithinMonths),
});

/** Exemplo de workflow que envia métricas para esta instância. */
export const workflowSnippet = (baseUrl: string) => `# .github/workflows/comm-graph.yml
name: comm-graph metrics
on:
  push:
    branches: [main]
jobs:
  metrics:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... seus passos de teste/SAST/DAST gerando os relatórios abaixo ...
      - uses: <sua-org>/comm-graph/integrations/github-action@main
        with:
          url: ${baseUrl}
          token: \${{ secrets.COMM_GRAPH_TOKEN }}
          coverage: coverage/coverage-summary.json   # ou lcov.info, coverage.out, cobertura.xml
          junit: reports/junit.xml
          sarif-sast: semgrep.sarif
          sarif-dast: zap.sarif`;

export function useGithubSettingsViewModel() {
  const pushToast = useUiStore((s) => s.pushToast);
  const [current, setCurrent] = useState<GithubSettingsView | null>(null);
  const [test, setTest] = useState<GithubTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<GithubForm>({ owner: '', token: '', clearToken: false, includeArchived: false, includeForks: false, pushedWithinMonths: '24' });

  useEffect(() => {
    GithubApi.getInstance()
      .settings()
      .then((s) => {
        setCurrent(s);
        form.reset(toForm(s));
      })
      .catch((err) => pushToast('error', errorMessage(err)));
  }, []);

  const save = async () => {
    const v = form.values;
    const months = v.pushedWithinMonths.trim();
    const input = form.validate(updateGithubSettingsSchema, {
      owner: v.owner,
      token: v.clearToken ? null : v.token.trim() ? v.token.trim() : undefined,
      includeArchived: v.includeArchived,
      includeForks: v.includeForks,
      pushedWithinMonths: months ? Number(months) : null,
    });
    if (!input) return;
    setBusy(true);
    try {
      const saved = await GithubApi.getInstance().updateSettings(input);
      setCurrent(saved);
      form.reset(toForm(saved));
      setTest(null);
      pushToast('success', 'Configuração do GitHub salva');
    } catch (err) {
      pushToast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await GithubApi.getInstance().testSettings());
    } catch (err) {
      setTest({ ok: false, login: null, repoCount: null, error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const apiBase = `${window.location.origin}/api`;
  return {
    form,
    current,
    test,
    busy,
    dirty: current != null && JSON.stringify(toForm(current)) !== JSON.stringify(form.values),
    tokenPlaceholder: current?.hasToken ? `Salvo (${current.tokenHint}) — deixe vazio para manter` : 'github_pat_… (fine-grained, somente leitura)',
    apiBase,
    workflow: workflowSnippet(window.location.origin),
    save,
    runTest,
  };
}
