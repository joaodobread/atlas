import type { GraphNode, MentionMethod, NodeInterface } from '../../../shared/types.ts';

interface Term {
  nodeId: number;
  term: string;
  pattern: RegExp;
  /** Forma normalizada (sem acento/espaço/pontuação), usada no casamento aproximado. */
  key: string;
  /** Só nomes de nós entram no aproximado; nomes de interface ("users") geram falsos positivos. */
  fuzzy: boolean;
}

export interface DetectedMention {
  nodeId: number;
  matched: string;
  method: Exclude<MentionMethod, 'llm'>;
  confidence: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Node API" / "node-api" / "NodeAPI" -> "nodeapi". */
export const normalizeKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const MIN_FUZZY_KEY = 6;

/** Uma palavra só, sem maiúsculas internas, dígitos ou símbolos: "users", "Vehicles". */
const isGenericWord = (name: string) => /^\p{Lu}?\p{Ll}+$/u.test(name.trim());

/**
 * Módulos com nome de palavra comum ("Vehicles", "Accounts", "Reservations") casariam com qualquer texto.
 * Esses só são reconhecidos pelo LLM. Marcas e serviços externos (ex.: "PayFlow") continuam valendo.
 */
const isGenericModuleName = (n: GraphNode) => n.kind === 'module' && isGenericWord(n.name);
const MAX_WINDOW_WORDS = 3;

/**
 * Encontra menções a nós do grafo num texto.
 * 1. Exato: nome do nó ou de uma interface, sem diferenciar maiúsculas, com fronteira de palavra.
 * 2. Aproximado: janelas de 1–3 palavras normalizadas comparadas por distância de edição
 *    ("NodApi" ~ "Node API", "Node-API" = "Node API"), só para nomes de nós com 6+ caracteres.
 */
export class MentionDetector {
  private readonly terms: Term[];

  constructor(nodes: readonly GraphNode[], interfaces: readonly NodeInterface[]) {
    const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
    const raw = [
      ...nodes.filter((n) => !isGenericModuleName(n)).map((n) => ({ nodeId: n.id, term: n.name, fuzzy: true })),
      ...interfaces.filter((i) => !isGenericWord(i.name) && kindOf.has(i.node_id)).map((i) => ({ nodeId: i.node_id, term: i.name, fuzzy: false })),
    ];
    const seen = new Set<string>();
    this.terms = raw
      .map((t) => ({ ...t, term: t.term.trim() }))
      .filter((t) => t.term.length >= 3)
      .filter((t) => {
        const key = `${t.nodeId}:${t.term.toLowerCase()}`;
        return !seen.has(key) && seen.add(key);
      })
      // Termos mais longos primeiro: "Node API" vence "API".
      .sort((a, b) => b.term.length - a.term.length)
      .map((t) => ({
        ...t,
        key: normalizeKey(t.term),
        pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${escape(t.term)}(?![\\p{L}\\p{N}_])`, 'iu'),
      }));
  }

  detect(text: string): DetectedMention[] {
    const found = new Map<number, DetectedMention>();
    for (const t of this.terms) {
      if (found.has(t.nodeId)) continue;
      const m = t.pattern.exec(text);
      if (m) found.set(t.nodeId, { nodeId: t.nodeId, matched: m[0], method: 'exact', confidence: 1 });
    }

    const pending = this.terms.filter((t) => t.fuzzy && !found.has(t.nodeId) && t.key.length >= MIN_FUZZY_KEY);
    if (!pending.length) return [...found.values()];

    for (const w of windows(text)) {
      for (const t of pending) {
        if (found.has(t.nodeId)) continue;
        const confidence = similarity(w.key, t.key);
        if (confidence > 0) found.set(t.nodeId, { nodeId: t.nodeId, matched: w.text, method: 'fuzzy', confidence });
      }
    }
    return [...found.values()];
  }
}

/** Janelas de 1..3 palavras consecutivas, com o texto original e a forma normalizada. */
function* windows(text: string): Generator<{ text: string; key: string }> {
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu)];
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_WINDOW_WORDS && i + n <= words.length; n++) {
      const first = words[i]!;
      const last = words[i + n - 1]!;
      // "node e api" não é "Node API": janelas compostas não podem ter palavras de 1–2 letras.
      if (n > 1 && words.slice(i, i + n).some((w) => w[0].length <= 2)) break;
      const original = text.slice(first.index!, last.index! + last[0].length);
      yield { text: original, key: normalizeKey(original) };
    }
  }
}

/** 0 = não casa; senão confiança em (0, 1]. Igual após normalizar = 0.95. */
function similarity(candidate: string, key: string): number {
  if (candidate.length < MIN_FUZZY_KEY - 1 || candidate[0] !== key[0]) return 0;
  if (candidate === key) return 0.95;
  const maxDist = key.length >= 10 ? 2 : 1;
  if (Math.abs(candidate.length - key.length) > maxDist) return 0;
  const d = levenshtein(candidate, key, maxDist);
  return d <= maxDist ? Math.round((1 - d / key.length) * 0.9 * 100) / 100 : 0;
}

/** Distância de edição com corte: retorna `limit + 1` assim que passar do limite. */
function levenshtein(a: string, b: string, limit: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length]!;
}
