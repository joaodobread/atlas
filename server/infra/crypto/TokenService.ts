import crypto from 'node:crypto';

export interface ITokenService {
  /** Token aleatório (256 bits) com prefixo legível, ex.: "cgs_…" (sessão) ou "cgt_…" (API). */
  generate(prefix: string): string;
  /** Hash armazenado no banco (o token em si nunca é guardado). */
  hash(token: string): string;
}

export class TokenService implements ITokenService {
  generate(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  }

  hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
