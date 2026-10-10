import { describe, expect, it } from 'vitest';
import { MarkdownChunker } from './MarkdownChunker.ts';

describe('MarkdownChunker.chunk', () => {
  it('divide por seção com o caminho de cabeçalhos e a faixa de linhas', () => {
    const md = ['Intro solta', '', '# Pagamentos', 'Texto A', '## Pix', 'Texto B', '### Detalhe ###', 'Texto C', '## Boleto', 'Texto D'].join('\n');
    const chunks = new MarkdownChunker().chunk(md);
    expect(chunks.map((c) => c.heading)).toEqual(['', 'Pagamentos', 'Pagamentos > Pix', 'Pagamentos > Pix > Detalhe', 'Pagamentos > Boleto']);
    expect(chunks[0]).toEqual({ ordinal: 0, heading: '', content: 'Intro solta', start_line: 1, end_line: 2 });
    expect(chunks[2]).toMatchObject({ ordinal: 2, content: '## Pix\nTexto B', start_line: 5, end_line: 6 });
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it('ignora cabeçalhos dentro de blocos de código e normaliza CRLF', () => {
    const md = '# Título\r\n```\r\n# não é cabeçalho\r\n```\r\ndepois';
    const chunks = new MarkdownChunker().chunk(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Título');
    expect(chunks[0]!.content).toContain('# não é cabeçalho');
    expect(chunks[0]!.end_line).toBe(5);
  });

  it('descarta seções vazias e documentos em branco', () => {
    const c = new MarkdownChunker();
    expect(c.chunk('')).toEqual([]);
    expect(c.chunk('   \n\n')).toEqual([]);
    expect(c.chunk('# A\n# B\ntexto').map((x) => x.heading)).toEqual(['A', 'B']);
  });

  it('quebra seções grandes em parágrafos respeitando o tamanho máximo', () => {
    const p1 = 'a'.repeat(30);
    const p2 = 'b'.repeat(30);
    const p3 = 'c'.repeat(10);
    const md = `# S\n${p1}\n\n${p2}\n\n${p3}`;
    const chunks = new MarkdownChunker(50).chunk(md);
    expect(chunks.map((c) => c.content)).toEqual([`# S\n${p1}`, `${p2}\n\n${p3}`]);
    expect(chunks.every((c) => c.heading === 'S')).toBe(true);
    expect(chunks[1]!.start_line).toBe(4);
  });

  it('não quebra parágrafos dentro de blocos de código', () => {
    const code = ['```', 'x'.repeat(20), '', 'y'.repeat(20), '```'].join('\n');
    const md = `${'z'.repeat(20)}\n\n${code}`;
    const chunks = new MarkdownChunker(30).chunk(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.content).toBe(code);
  });

  it('pula partes que só têm linhas em branco', () => {
    const md = `${'a'.repeat(40)}\n\n\n\n${'b'.repeat(40)}`;
    const chunks = new MarkdownChunker(20).chunk(md);
    expect(chunks.map((c) => c.content)).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
  });
});

describe('MarkdownChunker.title', () => {
  const c = new MarkdownChunker();
  it('usa o primeiro H1', () => {
    expect(c.title('texto\n## Sub\n# Principal ##\n# Outro', 'arq.md')).toBe('Principal');
  });
  it('cai no nome do arquivo sem H1 ou com H1 vazio', () => {
    expect(c.title('## Só H2', 'arq.md')).toBe('arq.md');
    expect(c.title('#  ##', 'arq.md')).toBe('arq.md');
  });
});
