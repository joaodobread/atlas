import type { ComponentType, CSSProperties } from 'react';
import {
  Bell,
  Bot,
  Box,
  ChartBar,
  Clock,
  Cloud,
  Cpu,
  CreditCard,
  Database,
  FileText,
  Folder,
  Globe,
  HardDrive,
  Inbox,
  Lock,
  Mail,
  Monitor,
  Network,
  Puzzle,
  Search,
  Server,
  Shield,
  Smartphone,
  Users,
  Webhook,
  Zap,
  type LucideProps,
} from 'lucide-react';
import {
  siMysql,
  siMariadb,
  siPostgresql,
  siSqlite,
  siMongodb,
  siRedis,
  siElasticsearch,
  siApachecassandra,
  siSupabase,
  siFirebase,
  siRabbitmq,
  siApachekafka,
  siNodedotjs,
  siTypescript,
  siJavascript,
  siOpenjdk,
  siKotlin,
  siScala,
  siPython,
  siGo,
  siRust,
  siDotnet,
  siPhp,
  siRuby,
  siElixir,
  siSwift,
  siBun,
  siDeno,
  siSpring,
  siNestjs,
  siExpress,
  siNextdotjs,
  siReact,
  siAngular,
  siVuedotjs,
  siDjango,
  siFastapi,
  siLaravel,
  siRubyonrails,
  siFlutter,
  siAndroid,
  siGraphql,
  siDocker,
  siKubernetes,
  siGooglecloud,
  siCloudflare,
  siVercel,
  siNginx,
  siApache,
  siLinux,
  siTerraform,
  siMinio,
  siJenkins,
  siGithub,
  siGitlab,
  siPrometheus,
  siGrafana,
  siStripe,
  siAuth0,
  siKeycloak,
  siAnthropic,
  type SimpleIcon,
} from 'simple-icons';

// Renderizadores dos ids do catálogo (src/domain/iconCatalog.ts). Imports nomeados para o bundle só levar estes ícones.

const BRANDS: Record<string, SimpleIcon> = {
  mysql: siMysql,
  mariadb: siMariadb,
  postgresql: siPostgresql,
  sqlite: siSqlite,
  mongodb: siMongodb,
  redis: siRedis,
  elasticsearch: siElasticsearch,
  apachecassandra: siApachecassandra,
  supabase: siSupabase,
  firebase: siFirebase,
  rabbitmq: siRabbitmq,
  apachekafka: siApachekafka,
  nodedotjs: siNodedotjs,
  typescript: siTypescript,
  javascript: siJavascript,
  openjdk: siOpenjdk,
  kotlin: siKotlin,
  scala: siScala,
  python: siPython,
  go: siGo,
  rust: siRust,
  dotnet: siDotnet,
  php: siPhp,
  ruby: siRuby,
  elixir: siElixir,
  swift: siSwift,
  bun: siBun,
  deno: siDeno,
  spring: siSpring,
  nestjs: siNestjs,
  express: siExpress,
  nextdotjs: siNextdotjs,
  react: siReact,
  angular: siAngular,
  vuedotjs: siVuedotjs,
  django: siDjango,
  fastapi: siFastapi,
  laravel: siLaravel,
  rubyonrails: siRubyonrails,
  flutter: siFlutter,
  android: siAndroid,
  graphql: siGraphql,
  docker: siDocker,
  kubernetes: siKubernetes,
  googlecloud: siGooglecloud,
  cloudflare: siCloudflare,
  vercel: siVercel,
  nginx: siNginx,
  apache: siApache,
  linux: siLinux,
  terraform: siTerraform,
  minio: siMinio,
  jenkins: siJenkins,
  github: siGithub,
  gitlab: siGitlab,
  prometheus: siPrometheus,
  grafana: siGrafana,
  stripe: siStripe,
  auth0: siAuth0,
  keycloak: siKeycloak,
  anthropic: siAnthropic,
};

const GENERIC: Record<string, ComponentType<LucideProps>> = {
  folder: Folder,
  server: Server,
  database: Database,
  cloud: Cloud,
  inbox: Inbox,
  globe: Globe,
  box: Box,
  puzzle: Puzzle,
  network: Network,
  shield: Shield,
  lock: Lock,
  monitor: Monitor,
  smartphone: Smartphone,
  'hard-drive': HardDrive,
  mail: Mail,
  bell: Bell,
  'credit-card': CreditCard,
  users: Users,
  'file-text': FileText,
  search: Search,
  clock: Clock,
  zap: Zap,
  webhook: Webhook,
  'chart-bar': ChartBar,
  bot: Bot,
  cpu: Cpu,
};

/**
 * Marcas que o simple-icons removeu (16.x, por pedido dos donos das marcas): os ids continuam válidos
 * (dados salvos não quebram) e viram um ícone genérico equivalente.
 */
const REMOVED_BRANDS: Record<string, string> = {
  amazonwebservices: 'cloud',
  awslambda: 'zap',
  amazons3: 'hard-drive',
  amazonsqs: 'inbox',
  amazondynamodb: 'database',
  oracle: 'database',
  openai: 'bot',
};

interface NodeIconProps {
  id: string;
  size?: number;
  /** Cor dos ícones genéricos e, se `monochrome`, também das marcas. */
  color?: string;
  /** Força a cor `color` nas marcas (padrão: cor oficial da marca, clareada para fundo escuro). */
  monochrome?: boolean;
  style?: CSSProperties;
  /** Posição quando renderizado dentro de um <svg>. */
  x?: number;
  y?: number;
}

export function NodeIcon({ id, size = 16, color = 'currentColor', monochrome = false, style, x, y }: NodeIconProps) {
  const [set, name] = id.split(':') as [string, string];
  if (set === 'si') {
    const icon = BRANDS[name];
    if (icon) {
      return (
        <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" style={style} role="img" aria-label={icon.title}>
          <path d={icon.path} fill={monochrome ? color : brandColor(icon.hex)} />
        </svg>
      );
    }
  }
  const Generic = GENERIC[set === 'si' ? (REMOVED_BRANDS[name] ?? name) : name] ?? Box;
  return <Generic x={x} y={y} size={size} color={color} strokeWidth={2} style={style} />;
}

/** Marcas muito escuras (ex.: preto) ficam invisíveis no tema escuro: clareia. */
function brandColor(hex: string): string {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.35 ? '#e6ebf5' : `#${hex}`;
}
