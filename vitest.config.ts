import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Três projetos:
 * - unit: lógica pura do servidor e do shared (sem banco);
 * - integration: repositórios, services e HTTP contra um Postgres real (um banco de teste, arquivos em série);
 * - web: lógica do front (domain, data, stores, viewmodels) em happy-dom.
 * Cobertura mínima de 90% no backend e na lógica do front (componentes de apresentação ficam fora).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['server/**/*.int.test.ts', 'test/**/*.int.test.ts'],
          setupFiles: ['test/support/integrationSetup.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['test/support/webSetup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html', 'lcov', 'json-summary'],
      include: [
        'server/**/*.ts',
        'shared/**/*.ts',
        'src/domain/**/*.ts',
        'src/core/**/*.ts',
        'src/data/**/*.ts',
        'src/stores/**/*.ts',
        'src/viewmodels/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.int.test.ts',
        'server/main.ts',
        'server/composition/**',
        'server/di/tokens.ts',
        'server/**/contracts/**',
        'server/infra/**/I[A-Z]*.ts',
        'shared/types.ts',
      ],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
