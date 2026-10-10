import { HttpError, type HttpIssue } from './HttpError.ts';
import type { IHttpService } from './IHttpService.ts';

/** Implementação de IHttpService sobre fetch. */
export class HttpService implements IHttpService {
  private static instance: HttpService | undefined;

  private unauthorizedHandler: (() => void) | null = null;

  private constructor(private readonly baseUrl: string) {}

  /** Chamado quando a API responde 401 (sessão expirou/foi encerrada). */
  onUnauthorized(handler: () => void): void {
    this.unauthorizedHandler = handler;
  }

  static getInstance(baseUrl = '/api'): HttpService {
    return (HttpService.instance ??= new HttpService(baseUrl));
  }

  get<T>(url: string): Promise<T> {
    return this.request<T>('GET', url);
  }

  post<T>(url: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', url, body);
  }

  patch<T>(url: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', url, body);
  }

  put<T>(url: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', url, body);
  }

  delete<T = void>(url: string): Promise<T> {
    return this.request<T>('DELETE', url);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        // Exigido pela API em mutações (proteção CSRF).
        'X-Requested-With': 'comm-graph',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !url.startsWith('/auth/')) this.unauthorizedHandler?.();
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; issues?: HttpIssue[] };
      throw new HttpError(res.status, err.error ?? res.statusText, err.issues ?? []);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}
