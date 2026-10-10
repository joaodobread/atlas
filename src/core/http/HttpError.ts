export interface HttpIssue {
  path: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: HttpIssue[] = [],
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** Mensagem amigável, incluindo erros de validação por campo. */
  get detailed(): string {
    if (!this.issues.length) return this.message;
    return `${this.message}: ${this.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}`;
  }
}
