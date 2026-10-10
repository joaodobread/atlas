export interface ISecretCipher {
  /** Texto -> "v1:<iv>:<tag>:<dados>" (base64url). */
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}
