import fs from 'node:fs';
import path from 'node:path';
import type { IMarkdownFolder, MarkdownFile } from './IMarkdownFolder.ts';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', '.venv', 'target']);
const MAX_FILE_BYTES = 2_000_000;

export class LocalMarkdownFolder implements IMarkdownFolder {
  exists(dir: string): boolean {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }

  async scan(dir: string): Promise<MarkdownFile[]> {
    const out: MarkdownFile[] = [];
    const walk = async (current: string) => {
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(current, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full);
        } else if (e.isFile() && /\.(md|markdown|mdx)$/i.test(e.name)) {
          const stat = await fs.promises.stat(full);
          if (stat.size <= MAX_FILE_BYTES) out.push({ path: full, content: await fs.promises.readFile(full, 'utf8') });
        }
      }
    };
    await walk(dir);
    return out;
  }

  watch(dir: string, onChange: () => void): () => void {
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
      if (file && !/\.(md|markdown|mdx)$/i.test(String(file))) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, 800);
    });
    watcher.on('error', (err) => console.error(`[watch] ${dir}:`, err.message));
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  }
}
