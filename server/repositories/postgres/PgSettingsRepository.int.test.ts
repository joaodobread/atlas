import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { AesGcmCipher } from '../../infra/crypto/AesGcmCipher.ts';
import { EncryptedSettingsStore } from './EncryptedSettingsStore.ts';
import { PgSettingsRepository } from './PgSettingsRepository.ts';

describe('PgSettingsRepository', () => {
  let repo: PgSettingsRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgSettingsRepository(db);
  });

  it('get de chave inexistente devolve null', async () => {
    expect(await repo.get('nada')).toBeNull();
  });

  it('grava e lê valores JSON de vários tipos; set sobrescreve', async () => {
    await repo.set('obj', { a: 1, b: [true, null] });
    await repo.set('num', 3);
    await repo.set('str', 'x');
    expect(await repo.get('obj')).toEqual({ a: 1, b: [true, null] });
    expect(await repo.get('num')).toBe(3);
    expect(await repo.get('str')).toBe('x');
    await repo.set('num', 4);
    expect(await repo.get('num')).toBe(4);
  });

  it('valor corrompido no banco (JSON inválido) vira null', async () => {
    const db = await testDatabase();
    await db.run("INSERT INTO settings (key, value) VALUES ('ruim', '{não é json')");
    expect(await repo.get('ruim')).toBeNull();
  });
});

describe('EncryptedSettingsStore', () => {
  let settings: PgSettingsRepository;
  let store: EncryptedSettingsStore;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    settings = new PgSettingsRepository(db);
    store = new EncryptedSettingsStore(settings, AesGcmCipher.fromSecret('chave-de-teste'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('guarda cifrado (o segredo não aparece no banco) e lê de volta', async () => {
    await store.set('llm', { apiKey: 'sk-secreta', model: 'x' });
    const raw = (await settings.get('llm')) as { enc: string };
    expect(raw.enc).toMatch(/^v1:/);
    expect(JSON.stringify(raw)).not.toContain('sk-secreta');
    expect(await store.get('llm')).toEqual({ apiKey: 'sk-secreta', model: 'x' });
  });

  it('devolve null quando não existe ou não está no formato { enc: string }', async () => {
    expect(await store.get('nada')).toBeNull();
    await settings.set('plano', { apiKey: 'em claro' });
    expect(await store.get('plano')).toBeNull();
    await settings.set('enc-numero', { enc: 123 });
    expect(await store.get('enc-numero')).toBeNull();
  });

  it('chave trocada: loga o erro e devolve null em vez de lançar', async () => {
    await store.set('llm', { apiKey: 'x' });
    const other = new EncryptedSettingsStore(settings, AesGcmCipher.fromSecret('outra'));
    expect(await other.get('llm')).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"llm"'), expect.any(String));
  });
});
