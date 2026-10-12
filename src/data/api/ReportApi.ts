import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { GenerateSecurityReportInput } from '../../../shared/schemas.ts';
import type { SecurityPortfolioView, SecurityReportRecord, SecurityRepoView } from '../../../shared/types.ts';

export class ReportApi {
  private static instance: ReportApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): ReportApi {
    return (ReportApi.instance ??= new ReportApi(http));
  }

  securityPortfolio(): Promise<SecurityPortfolioView> {
    return this.http.get('/reports/security');
  }

  securityRepo(owner: string, name: string): Promise<SecurityRepoView> {
    return this.http.get(`/reports/security/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  }

  /** Gera relatório ou dicas (sem owner/repo = portfólio). */
  generateSecurity(input: Partial<GenerateSecurityReportInput>): Promise<SecurityReportRecord> {
    return this.http.post('/reports/security', input);
  }
}
