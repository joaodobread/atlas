import type { ChunkInput } from '../../repositories/contracts/IDocumentRepository.ts';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

interface Section {
  heading: string;
  lines: Array<{ text: string; line: number }>;
}

/**
 * Divide markdown em trechos por seção de cabeçalho ("Título > Subtítulo"), preservando a faixa de linhas.
 * Seções grandes são quebradas em parágrafos até `maxChars`.
 */
export class MarkdownChunker {
  constructor(private readonly maxChars = 1500) {}

  chunk(markdown: string): ChunkInput[] {
    const sections = this.sections(markdown);
    const chunks: ChunkInput[] = [];
    for (const s of sections) {
      for (const part of this.split(s)) {
        const content = part
          .map((l) => l.text)
          .join('\n')
          .trim();
        if (!content) continue;
        chunks.push({
          ordinal: chunks.length,
          heading: s.heading,
          content,
          start_line: part[0]!.line,
          end_line: part[part.length - 1]!.line,
        });
      }
    }
    return chunks;
  }

  /** Título do documento: primeiro H1, senão o nome do arquivo. */
  title(markdown: string, fallback: string): string {
    const h1 = markdown.split('\n').find((l) => /^#\s+/.test(l));
    return h1
      ? h1
          .replace(/^#\s+/, '')
          .replace(/\s*#*\s*$/, '')
          .trim() || fallback
      : fallback;
  }

  private sections(markdown: string): Section[] {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const stack: string[] = [];
    const sections: Section[] = [{ heading: '', lines: [] }];
    let inFence = false;
    lines.forEach((text, i) => {
      if (FENCE.test(text)) inFence = !inFence;
      const m = !inFence ? HEADING.exec(text) : null;
      if (m) {
        const level = m[1]!.length;
        stack.length = level - 1;
        stack[level - 1] = m[2]!.trim();
        sections.push({ heading: stack.filter(Boolean).join(' > '), lines: [] });
      }
      sections[sections.length - 1]!.lines.push({ text, line: i + 1 });
    });
    return sections.filter((s) => s.lines.some((l) => l.text.trim()));
  }

  /** Quebra por parágrafos (linhas em branco fora de blocos de código) respeitando o tamanho máximo. */
  private split(section: Section): Array<Section['lines']> {
    const total = section.lines.reduce((n, l) => n + l.text.length + 1, 0);
    if (total <= this.maxChars) return [section.lines];

    const paragraphs: Array<Section['lines']> = [[]];
    let inFence = false;
    for (const l of section.lines) {
      if (FENCE.test(l.text)) inFence = !inFence;
      paragraphs[paragraphs.length - 1]!.push(l);
      if (!inFence && !l.text.trim()) paragraphs.push([]);
    }

    const parts: Array<Section['lines']> = [];
    let current: Section['lines'] = [];
    let size = 0;
    for (const p of paragraphs.filter((x) => x.length)) {
      const pSize = p.reduce((n, l) => n + l.text.length + 1, 0);
      if (current.length && size + pSize > this.maxChars) {
        parts.push(current);
        current = [];
        size = 0;
      }
      current.push(...p);
      size += pSize;
    }
    if (current.length) parts.push(current);
    return parts;
  }
}
