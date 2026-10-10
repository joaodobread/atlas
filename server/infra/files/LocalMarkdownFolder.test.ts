import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMarkdownFolder } from './LocalMarkdownFolder.ts';

describe('LocalMarkdownFolder', () => {
  let dir: string;
  const folder = new LocalMarkdownFolder();
  const write = (rel: string, content: string | Buffer) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commgraph-md-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exists só é verdadeiro para diretórios existentes', () => {
    const file = write('a.md', '# A');
    expect(folder.exists(dir)).toBe(true);
    expect(folder.exists(file)).toBe(false);
    expect(folder.exists(path.join(dir, 'nao-existe'))).toBe(false);
  });

  it('scan lê .md/.markdown/.mdx recursivamente e ignora pastas e arquivos irrelevantes', async () => {
    const a = write('a.md', '# A');
    const b = write('sub/deep/b.MARKDOWN', 'B');
    const c = write('sub/c.mdx', 'C');
    write('notes.txt', 'x');
    write('node_modules/pkg/readme.md', 'x');
    write('.git/x.md', 'x');
    write('.hidden/y.md', 'x');
    write('dist/z.md', 'x');
    write('big.md', Buffer.alloc(2_000_001, 'a'));
    const files = await folder.scan(dir);
    expect(files.map((f) => f.path).sort()).toEqual([a, b, c].sort());
    expect(files.find((f) => f.path === a)?.content).toBe('# A');
  });

  it('watch avisa (com debounce) quando um markdown muda e para ao chamar o retorno', async () => {
    const onChange = vi.fn<() => void>();
    const stop = folder.watch(dir, onChange);
    try {
      await new Promise((r) => setTimeout(r, 100));
      write('novo.md', '# novo');
      write('outro.md', '# outro');
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 100 });
    } finally {
      stop();
    }
  });

  it('watch ignora arquivos que não são markdown, aceita eventos sem nome e registra erros', () => {
    vi.useFakeTimers();
    let listener: ((event: string, file: string | null) => void) | undefined;
    const handlers = new Map<string, (err: Error) => void>();
    const close = vi.fn<() => void>();
    const fakeWatcher = {
      on: (ev: string, h: (err: Error) => void) => {
        handlers.set(ev, h);
        return fakeWatcher;
      },
      close,
    };
    const watchSpy = vi.spyOn(fs, 'watch').mockImplementation(((_dir: string, _opts: unknown, l: (event: string, file: string | null) => void) => {
      listener = l;
      return fakeWatcher;
    }) as unknown as typeof fs.watch);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const onChange = vi.fn<() => void>();
    const stop = folder.watch('/pasta', onChange);
    expect(watchSpy).toHaveBeenCalledWith('/pasta', { recursive: true }, expect.any(Function));

    listener!('change', 'imagem.png');
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();

    listener!('rename', null);
    vi.advanceTimersByTime(799);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    handlers.get('error')!(new Error('EMFILE'));
    expect(error).toHaveBeenCalledWith('[watch] /pasta:', 'EMFILE');

    listener!('change', 'doc.md');
    stop();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });
});
