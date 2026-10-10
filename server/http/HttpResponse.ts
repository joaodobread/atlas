export interface CookieDirective {
  name: string;
  /** null = apagar o cookie. */
  value: string | null;
  expires?: Date;
}

/** Resultado de uma action de controller, independente do Express. */
export interface HttpResponse {
  status: number;
  body?: unknown;
  cookies?: CookieDirective[];
}

/** Corpo de resposta: nunca uma Promise (esquecer o await serializaria "{}"). */
type Body<T> = T extends PromiseLike<unknown> ? never : T;

export const ok = <T>(body: Body<T>, cookies?: CookieDirective[]): HttpResponse => ({ status: 200, body, cookies });
export const created = <T>(body: Body<T>): HttpResponse => ({ status: 201, body });
export const noContent = (cookies?: CookieDirective[]): HttpResponse => ({ status: 204, cookies });
