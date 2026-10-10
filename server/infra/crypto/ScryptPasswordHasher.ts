import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { IPasswordHasher } from './IPasswordHasher.ts';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
/** scrypt com N=2^15 precisa de ~32MB; o padrão do Node (32MB) é justo demais. */
const MAXMEM = 64 * 1024 * 1024;

/** Formato: scrypt$N$r$p$salt$hash (base64url). */
export class ScryptPasswordHasher implements IPasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [alg, n, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return crypto.timingSafeEqual(key, expected);
  }
}
