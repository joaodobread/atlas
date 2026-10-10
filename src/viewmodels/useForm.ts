import { useCallback, useState } from 'react';
import type { ZodType } from 'zod';

export type FieldErrors = Record<string, string>;

/** Estado de formulário + validação zod do payload antes de enviar. */
export function useForm<TValues extends object>(initial: TValues) {
  const [values, setValues] = useState<TValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = useCallback(<K extends keyof TValues>(field: K, value: TValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (!((field as string) in e)) return e;
      const { [field as string]: _removed, ...rest } = e;
      return rest;
    });
  }, []);

  const reset = useCallback((next: TValues) => {
    setValues(next);
    setErrors({});
  }, []);

  /** Valida o payload; em caso de erro preenche `errors` (por campo) e retorna null. */
  const validate = useCallback(<T>(schema: ZodType<T, unknown>, payload: unknown): T | null => {
    const result = schema.safeParse(payload);
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const next: FieldErrors = {};
    for (const issue of result.error.issues) next[issue.path.join('.') || '_'] ??= issue.message;
    setErrors(next);
    return null;
  }, []);

  return { values, errors, set, reset, validate, setValues };
}

/** '' -> null, senão número. Para selects de id. */
export const idOrNull = (v: string): number | null => (v === '' ? null : Number(v));
