export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Recurso inexistente. */
export class NotFoundError extends AppError {
  readonly status = 404;
}

/** Entrada com formato válido, mas que referencia algo inválido. */
export class ValidationError extends AppError {
  readonly status = 400;
}

/** Operação que viola uma regra do domínio. */
export class BusinessRuleError extends AppError {
  readonly status = 422;
}

/** Não autenticado. */
export class UnauthorizedError extends AppError {
  readonly status = 401;
}

/** Autenticado, mas sem permissão. */
export class ForbiddenError extends AppError {
  readonly status = 403;
}

/** Excesso de tentativas. */
export class TooManyRequestsError extends AppError {
  readonly status = 429;
}
