export interface ISettingsRepository {
  /** Valor bruto (JSON já desserializado) ou null. Valide antes de usar. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
