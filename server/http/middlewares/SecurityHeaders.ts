import type { NextFunction, Request, Response } from 'express';

export interface SecurityHeadersOptions {
  /** HTTPS na frente: liga HSTS. */
  https: boolean;
  /** Origens extras de imagens (ex.: URL pública do bucket/CDN). */
  imageOrigins: string[];
}

/**
 * Cabeçalhos de segurança (equivalente enxuto ao helmet): CSP restritiva, sem embed em iframes,
 * sem sniffing de MIME e HSTS quando servido por HTTPS.
 */
export class SecurityHeaders {
  private readonly headers: Record<string, string>;

  constructor(options: SecurityHeadersOptions) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      // React aplica estilos inline (style={{}}); sem scripts inline.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      `img-src 'self' data: blob: ${options.imageOrigins.join(' ')}`.trim(),
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    this.headers = {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      ...(options.https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    };
  }

  readonly middleware = (_req: Request, res: Response, next: NextFunction): void => {
    for (const [k, v] of Object.entries(this.headers)) res.setHeader(k, v);
    next();
  };
}
