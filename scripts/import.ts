// Importa um grafo (formato de troca) e/ou monitora uma pasta de .md, direto no banco.
// Uso:
//   npm run import -- --graph caminho/grafo.json [--graph-id 1] [--docs /caminho/absoluto/docs]
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AppConfig } from '../server/config/AppConfig.ts';
import { buildContainer } from '../server/composition/buildContainer.ts';
import { MIGRATIONS } from '../server/infra/database/migrations.ts';
import { TOKENS } from '../server/di/tokens.ts';
import { exchangeDocumentSchema, watchedFolderSchema } from '../shared/schemas.ts';

const argsSchema = z
  .object({ graph: z.string().min(1).optional(), graphId: z.coerce.number().int().positive().default(1), docs: z.array(z.string().min(1)).default([]) })
  .refine((a) => a.graph || a.docs.length, 'Informe --graph e/ou --docs');

function parseArgs(argv: string[]) {
  const raw: { graph?: string; graphId?: string; docs: string[] } = { docs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--graph') raw.graph = argv[++i];
    else if (argv[i] === '--graph-id') raw.graphId = argv[++i];
    else if (argv[i] === '--docs') raw.docs.push(argv[++i]!);
  }
  return argsSchema.parse(raw);
}

const args = parseArgs(process.argv.slice(2));
const container = buildContainer(AppConfig.fromEnv());
const db = container.resolve(TOKENS.Database);
await db.waitUntilReady();
await db.migrate(MIGRATIONS);

if (args.graph) {
  const doc = exchangeDocumentSchema.parse(JSON.parse(fs.readFileSync(path.resolve(args.graph), 'utf8')));
  console.log('Grafo:', await container.resolve(TOKENS.ExchangeService).importDocument(doc, args.graphId));
}

const folders = container.resolve(TOKENS.FolderWatchService);
for (const dir of args.docs) {
  const { path: folder } = watchedFolderSchema.parse({ path: path.resolve(dir) });
  const existing = (await folders.list()).find((f) => f.path === folder);
  const result = existing ? await folders.rescan(existing.id) : await folders.add(folder);
  console.log(`Pasta ${result.path}: ${result.documentCount} documento(s)`);
}

// Watchers abertos pelo add() manteriam o processo vivo.
process.exit(0);
