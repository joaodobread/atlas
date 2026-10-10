import { afterAll } from 'vitest';
import { closeTestDatabase } from './database.ts';

afterAll(async () => {
  await closeTestDatabase();
});
