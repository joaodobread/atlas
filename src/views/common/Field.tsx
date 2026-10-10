import type { ReactNode } from 'react';

interface FieldProps {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, error, children }: FieldProps) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
