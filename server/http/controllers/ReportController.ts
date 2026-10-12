import { generateSecurityReportSchema, repoKeySchema } from '../../../shared/schemas.ts';
import type { ISecurityReportService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, ok, type HttpResponse } from '../HttpResponse.ts';

export class ReportController {
  constructor(private readonly security: ISecurityReportService) {}

  async securityPortfolio(): Promise<HttpResponse> {
    return ok(await this.security.portfolio());
  }

  async securityRepo(req: HttpRequest): Promise<HttpResponse> {
    const { owner, repo } = repoKeySchema.parse(req.params);
    return ok(await this.security.repo(owner, repo));
  }

  async generateSecurity(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.security.generate(generateSecurityReportSchema.parse(req.body ?? {}), req.user?.user.id ?? null));
  }
}
