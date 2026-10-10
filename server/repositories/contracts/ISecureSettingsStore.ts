/** Configurações sensíveis: gravadas criptografadas, lidas já descriptografadas. */
export interface ISecureSettingsStore {
  /** Valor desserializado, ou null se não existir ou não puder ser descriptografado. Valide antes de usar. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
