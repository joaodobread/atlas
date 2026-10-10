import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ISecretCipher } from './ISecretCipher.ts';

const VERSION = 'v1';

/**
 * AES-256-GCM (autenticado). A chave de 32 bytes é derivada de APP_SECRET ou,
 * sem ele, de um arquivo gerado na primeira execução (permissão 0600).
 */
export class AesGcmCipher implements ISecretCipher {
  private readonly key: Buffer;

  private constructor(key: Buffer) {
    this.key = key;
  }

  static fromSecret(secret: string): AesGcmCipher {
    return new AesGcmCipher(crypto.createHash('sha256').update(`comm-graph:${secret}`).digest());
  }

  /** Lê (ou cria) a chave em `file`. Guarde esse arquivo junto com os backups do banco. */
  static fromKeyFile(file: string): AesGcmCipher {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
      console.log(`[crypto] chave de criptografia criada em ${file} — faça backup dela junto com o banco.`);
    }
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`Chave inválida em ${file} (esperado 32 bytes em base64)`);
    return new AesGcmCipher(key);
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Formato de dado criptografado inválido');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
