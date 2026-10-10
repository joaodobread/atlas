import { useEffect, useLayoutEffect, useState } from 'react';
import { errorMessage } from '../core/errorMessage.ts';
import { AuthApi } from '../data/api/AuthApi.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export interface TourStep {
  /** Seletor do elemento destacado (atributo data-tour); null = card centralizado. */
  target: string | null;
  title: string;
  body: string;
  /** Prepara a tela antes de mostrar o passo (ex.: abrir o painel certo). */
  prepare?: () => void;
}

const ui = () => useUiStore.getState();

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Bem-vindo ao Comm Graph',
    body: 'Aqui você mapeia como sistemas, filas, bancos, infra e serviços externos se comunicam — e pergunta sobre eles. Este tour mostra o essencial em 1 minuto.',
    prepare: () => ui().showGraph(),
  },
  {
    target: '[data-tour="nav"]',
    title: 'Navegação',
    body: 'Pela barra lateral você abre a Estrutura (árvore do grafo), os Documentos (busca e perguntas), os Repositórios do GitHub, importação/exportação, as Configurações e a sua conta.',
  },
  {
    target: '[data-tour="graph-switcher"]',
    title: 'Grafos',
    body: 'Você pode ter vários grafos independentes (um por produto, time ou ambiente). Troque, crie e renomeie por aqui.',
    prepare: () => ui().showGraph(),
  },
  {
    target: '[data-tour="layouts"]',
    title: 'Visualização',
    body: 'Infra mostra caixas aninhadas (contas, VPCs, clusters); Camadas organiza em colunas; Livre usa forças. Clique num nó para focar, duplo clique para expandir, e exporte em PNG ou SVG pelo botão de download.',
  },
  {
    target: '[data-tour="new-node"]',
    title: 'Monte o grafo',
    body: 'Crie nós raiz aqui e, no painel de detalhes, adicione submódulos, interfaces e conexões. Também dá para importar um JSON (gerado por um LLM, por exemplo).',
    prepare: () => {
      ui().showGraph();
      if (!ui().leftOpen || ui().leftTab !== 'tree') ui().toggleLeft('tree');
    },
  },
  {
    target: '[data-tour="docs-search"]',
    title: 'Documentos, busca e perguntas',
    body: 'Envie .md ou monitore pastas: tudo é indexado (texto + semântica) junto com o próprio grafo. Busque ou pergunte; as respostas citam as fontes e destacam os nós afetados.',
    prepare: () => {
      ui().showGraph();
      if (!ui().leftOpen || ui().leftTab !== 'docs') ui().toggleLeft('docs');
    },
  },
  {
    target: '[data-tour="nav-repos"]',
    title: 'Repositórios e qualidade',
    body: 'Conecte o GitHub para analisar os repositórios (scorecard de CI, testes, segurança e processo), gerar documentação e grafos a partir deles, e receber métricas do CI.',
  },
  {
    target: '[data-tour="nav-settings"]',
    title: 'Configurações',
    body: 'Conta e tokens de API, usuários e permissões, LLM (Claude, OpenAI-compatível ou local) e integração com o GitHub. Pronto — você pode rever este tour em Minha conta.',
  },
];

/** Tutorial de primeiro acesso: aparece até o usuário concluir ou dispensar. */
export function useOnboardingViewModel() {
  const user = useAuthStore((s) => s.user);
  const apply = useAuthStore((s) => s.apply);
  const pushToast = useUiStore((s) => s.pushToast);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [closing, setClosing] = useState(false);
  const active = !!user && !user.onboarded_at && !closing;
  const step = TOUR_STEPS[index]!;

  // Recomeça do início quando o tutorial é reativado.
  useEffect(() => {
    if (user && !user.onboarded_at) {
      setIndex(0);
      setClosing(false);
    }
  }, [user?.onboarded_at]);

  useEffect(() => {
    if (active) step.prepare?.();
  }, [active, index]);

  // Acompanha a posição do alvo (painéis abrem/animam depois do prepare).
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [active, index]);

  const finish = async () => {
    setClosing(true);
    try {
      apply(await AuthApi.getInstance().setOnboarded(true));
    } catch (err) {
      pushToast('error', errorMessage(err));
    }
  };

  return {
    active,
    step,
    index,
    total: TOUR_STEPS.length,
    rect: step.target ? rect : null,
    isLast: index === TOUR_STEPS.length - 1,
    next: () => (index === TOUR_STEPS.length - 1 ? void finish() : setIndex(index + 1)),
    back: () => setIndex(Math.max(0, index - 1)),
    skip: () => void finish(),
  };
}

/** Reabre o tutorial (Minha conta). */
export async function restartOnboarding(): Promise<void> {
  useAuthStore.getState().apply(await AuthApi.getInstance().setOnboarded(false));
  useUiStore.getState().showGraph();
}
