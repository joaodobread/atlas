import type { ISecretCipher } from '../../infra/crypto/ISecretCipher.ts';
import type { ISecureSettingsStore } from '../contracts/ISecureSettingsStore.ts';
import type { ISettingsRepository } from '../contracts/ISettingsRepository.ts';

/** Decorator: guarda `{ enc: "<cifrado>" }` no repositório de configurações. */
export class EncryptedSettingsStore implements ISecureSettingsStore {
  constructor(
    private readonly settings: ISettingsRepository,
    private readonly cipher: ISecretCipher,
  ) {}

  async get(key: string): Promise<unknown> {
    const raw = (await this.settings.get(key)) as { enc?: unknown } | null;
    if (!raw || typeof raw.enc !== 'string') return null;
    try {
      return JSON.parse(this.cipher.decrypt(raw.enc)) as unknown;
    } catch (err) {
      console.error(`[settings] não foi possível descriptografar "${key}" (APP_SECRET/chave mudou?):`, (err as Error).message);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.settings.set(key, { enc: this.cipher.encrypt(JSON.stringify(value)) });
  }
}
