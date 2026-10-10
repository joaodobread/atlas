import type { NodeKind } from '../../shared/constants.ts';

export type IconGroup = 'Genéricos' | 'Bancos de dados' | 'Mensageria' | 'Linguagens & runtimes' | 'Frameworks' | 'Infra & cloud' | 'Serviços';

export interface IconEntry {
  /** "si:<slug>" (marca, simple-icons) ou "lu:<nome>" (genérico, lucide). */
  id: string;
  label: string;
  group: IconGroup;
  /** Termos que, achados na "tecnologia" do nó, escolhem este ícone automaticamente. */
  keywords: string[];
}

const lu = (name: string, label: string, keywords: string[] = []): IconEntry => ({ id: `lu:${name}`, label, group: 'Genéricos', keywords });
const si = (slug: string, label: string, group: IconGroup, keywords: string[] = []): IconEntry => ({
  id: `si:${slug}`,
  label,
  group,
  keywords: [label.toLowerCase(), ...keywords],
});

export const ICONS: readonly IconEntry[] = [
  lu('folder', 'Projeto'),
  lu('server', 'Serviço / API', ['api', 'backend']),
  lu('database', 'Banco de dados', ['db', 'sql']),
  lu('cloud', 'Infra / Cloud', ['cloud']),
  lu('inbox', 'Fila', ['queue', 'fila']),
  lu('globe', 'Externo', ['external', 'third']),
  lu('box', 'Módulo'),
  lu('puzzle', 'Componente'),
  lu('network', 'Gateway', ['gateway', 'proxy']),
  lu('shield', 'Autenticação', ['auth', 'sso', 'oauth']),
  lu('lock', 'Segurança', ['security', 'vault']),
  lu('monitor', 'Frontend web', ['web', 'frontend', 'spa']),
  lu('smartphone', 'App mobile', ['mobile', 'app']),
  lu('hard-drive', 'Storage', ['storage', 'bucket', 'blob']),
  lu('mail', 'E-mail', ['email', 'smtp']),
  lu('bell', 'Notificações', ['notification', 'push']),
  lu('credit-card', 'Pagamentos', ['payment', 'pagamento']),
  lu('users', 'Usuários', ['user', 'usuario']),
  lu('file-text', 'Arquivos / Docs', ['file', 'document']),
  lu('search', 'Busca', ['search']),
  lu('clock', 'Job / Cron', ['cron', 'job', 'scheduler', 'worker']),
  lu('zap', 'Função serverless', ['lambda', 'function', 'serverless']),
  lu('webhook', 'Webhook', ['webhook']),
  lu('chart-bar', 'Analytics', ['analytics', 'metrics', 'bi']),
  lu('bot', 'IA / Bot', ['ai', 'llm', 'bot']),
  lu('cpu', 'Processamento', ['compute', 'processing']),

  si('mysql', 'MySQL', 'Bancos de dados'),
  si('mariadb', 'MariaDB', 'Bancos de dados'),
  si('postgresql', 'PostgreSQL', 'Bancos de dados', ['postgres', 'pg']),
  si('sqlite', 'SQLite', 'Bancos de dados'),
  si('mongodb', 'MongoDB', 'Bancos de dados', ['mongo']),
  si('redis', 'Redis', 'Bancos de dados'),
  si('elasticsearch', 'Elasticsearch', 'Bancos de dados', ['elastic']),
  si('apachecassandra', 'Cassandra', 'Bancos de dados'),
  si('oracle', 'Oracle', 'Bancos de dados'),
  si('amazondynamodb', 'DynamoDB', 'Bancos de dados', ['dynamo']),
  si('supabase', 'Supabase', 'Bancos de dados'),
  si('firebase', 'Firebase', 'Bancos de dados'),

  si('rabbitmq', 'RabbitMQ', 'Mensageria', ['rabbit', 'amqp']),
  si('apachekafka', 'Kafka', 'Mensageria'),
  si('amazonsqs', 'SQS', 'Mensageria'),

  si('nodedotjs', 'Node.js', 'Linguagens & runtimes', ['node']),
  si('typescript', 'TypeScript', 'Linguagens & runtimes'),
  si('javascript', 'JavaScript', 'Linguagens & runtimes'),
  si('openjdk', 'Java', 'Linguagens & runtimes', ['jdk', 'jvm']),
  si('kotlin', 'Kotlin', 'Linguagens & runtimes'),
  si('scala', 'Scala', 'Linguagens & runtimes'),
  si('python', 'Python', 'Linguagens & runtimes'),
  si('go', 'Go', 'Linguagens & runtimes', ['golang']),
  si('rust', 'Rust', 'Linguagens & runtimes'),
  si('dotnet', '.NET', 'Linguagens & runtimes', ['dotnet', 'c#', 'csharp']),
  si('php', 'PHP', 'Linguagens & runtimes'),
  si('ruby', 'Ruby', 'Linguagens & runtimes'),
  si('elixir', 'Elixir', 'Linguagens & runtimes'),
  si('swift', 'Swift', 'Linguagens & runtimes'),
  si('bun', 'Bun', 'Linguagens & runtimes'),
  si('deno', 'Deno', 'Linguagens & runtimes'),

  si('spring', 'Spring', 'Frameworks', ['spring boot']),
  si('nestjs', 'NestJS', 'Frameworks', ['nest']),
  si('express', 'Express', 'Frameworks'),
  si('nextdotjs', 'Next.js', 'Frameworks', ['next']),
  si('react', 'React', 'Frameworks'),
  si('angular', 'Angular', 'Frameworks'),
  si('vuedotjs', 'Vue', 'Frameworks'),
  si('django', 'Django', 'Frameworks'),
  si('fastapi', 'FastAPI', 'Frameworks'),
  si('laravel', 'Laravel', 'Frameworks'),
  si('rubyonrails', 'Rails', 'Frameworks'),
  si('flutter', 'Flutter', 'Frameworks'),
  si('android', 'Android', 'Frameworks'),
  si('graphql', 'GraphQL', 'Frameworks'),

  si('docker', 'Docker', 'Infra & cloud'),
  si('kubernetes', 'Kubernetes', 'Infra & cloud', ['k8s', 'eks', 'gke', 'aks']),
  si('amazonwebservices', 'AWS', 'Infra & cloud', ['amazon']),
  si('awslambda', 'AWS Lambda', 'Infra & cloud'),
  si('amazons3', 'S3', 'Infra & cloud'),
  si('googlecloud', 'Google Cloud', 'Infra & cloud', ['gcp']),
  si('cloudflare', 'Cloudflare', 'Infra & cloud'),
  si('vercel', 'Vercel', 'Infra & cloud'),
  si('nginx', 'Nginx', 'Infra & cloud'),
  si('apache', 'Apache', 'Infra & cloud', ['httpd']),
  si('linux', 'Linux', 'Infra & cloud'),
  si('terraform', 'Terraform', 'Infra & cloud'),
  si('minio', 'MinIO', 'Infra & cloud'),
  si('jenkins', 'Jenkins', 'Infra & cloud'),
  si('github', 'GitHub', 'Infra & cloud'),
  si('gitlab', 'GitLab', 'Infra & cloud'),
  si('prometheus', 'Prometheus', 'Infra & cloud'),
  si('grafana', 'Grafana', 'Infra & cloud'),

  si('stripe', 'Stripe', 'Serviços'),
  si('auth0', 'Auth0', 'Serviços'),
  si('keycloak', 'Keycloak', 'Serviços'),
  si('openai', 'OpenAI', 'Serviços'),
  si('anthropic', 'Anthropic', 'Serviços', ['claude']),
];

const BY_ID = new Map(ICONS.map((i) => [i.id, i]));

export const KIND_DEFAULT_ICON: Record<NodeKind, string> = {
  project: 'lu:folder',
  service: 'lu:server',
  database: 'lu:database',
  infra: 'lu:cloud',
  queue: 'lu:inbox',
  external: 'lu:globe',
  module: 'lu:box',
};

export function iconEntry(id: string | null | undefined): IconEntry | undefined {
  return id ? BY_ID.get(id) : undefined;
}

const BRAND_KEYWORDS = ICONS.filter((i) => i.id.startsWith('si:')).flatMap((i) => i.keywords.map((k) => ({ k, id: i.id })));

/** Posição do termo na tecnologia (palavra inteira; termos com espaço/ponto por substring), ou -1. */
function keywordPosition(tech: string, keyword: string): number {
  if (keyword.includes(' ') || keyword.includes('.')) return tech.indexOf(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tech.search(new RegExp(`(^|[^a-z0-9#.+])${escaped}($|[^a-z0-9#.+])`));
}

/** Ícone efetivo: escolhido > deduzido da tecnologia > padrão do tipo. */
export function resolveIcon(node: { icon: string | null; tech: string | null; kind: NodeKind }): string {
  if (node.icon && BY_ID.has(node.icon)) return node.icon;
  const tech = node.tech?.toLowerCase();
  if (tech) {
    // O termo que aparece primeiro vence ("node / express" -> Node.js); empate: o mais longo.
    let best: { pos: number; len: number; id: string } | null = null;
    for (const { k, id } of BRAND_KEYWORDS) {
      const pos = keywordPosition(tech, k);
      if (pos < 0) continue;
      if (!best || pos < best.pos || (pos === best.pos && k.length > best.len)) best = { pos, len: k.length, id };
    }
    if (best) return best.id;
  }
  return KIND_DEFAULT_ICON[node.kind];
}

export function searchIcons(query: string): IconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ICONS];
  return ICONS.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)) || i.id.includes(q));
}
