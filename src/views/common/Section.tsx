import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  count?: number;
  children: ReactNode;
}

export function Section({ title, count, children }: SectionProps) {
  return (
    <section className="section">
      <h3>
        {title}
        {count != null && <span className="count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}
