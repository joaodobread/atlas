import type { MaturityLevel, RiskLevel, SecurityNarrative, SecurityReportRecord, SecurityTip } from '../../../shared/types.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { ISecurityReportRepository, NewSecurityReport } from '../contracts/ISecurityReportRepository.ts';

interface Row {
  id: number;
  scope: string;
  kind: 'report' | 'tips';
  focus: string | null;
  method: 'llm' | 'heuristic';
  model: string | null;
  llm_error: string | null;
  score: number | null;
  risk: RiskLevel | null;
  level: MaturityLevel | null;
  content_json: string;
  created_by_name: string | null;
  created_at: string;
}

const SELECT = `SELECT r.*, u.name AS created_by_name FROM security_reports r LEFT JOIN users u ON u.id = r.created_by`;

const toRecord = (r: Row): SecurityReportRecord => {
  const content = JSON.parse(r.content_json) as { narrative?: SecurityNarrative; tips?: SecurityTip[] };
  return {
    id: r.id,
    scope: r.scope,
    kind: r.kind,
    focus: r.focus,
    method: r.method,
    model: r.model,
    llmError: r.llm_error,
    score: r.score,
    risk: r.risk,
    level: r.level,
    narrative: content.narrative ?? null,
    tips: content.tips ?? null,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
  };
};

export class PgSecurityReportRepository implements ISecurityReportRepository {
  constructor(private readonly db: IDatabase) {}

  async insert(r: NewSecurityReport): Promise<SecurityReportRecord> {
    const content = r.kind === 'tips' ? { tips: r.tips ?? [] } : { narrative: r.narrative };
    const id = await this.db.insert(
      `INSERT INTO security_reports (scope, kind, focus, method, model, llm_error, score, risk, level, content_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.scope, r.kind, r.focus, r.method, r.model, r.llmError, r.score, r.risk, r.level, JSON.stringify(content), r.createdBy],
    );
    return toRecord((await this.db.get<Row>(`${SELECT} WHERE r.id = ?`, [id]))!);
  }

  async list(scope: string, limit: number): Promise<SecurityReportRecord[]> {
    return (await this.db.all<Row>(`${SELECT} WHERE r.scope = ? ORDER BY r.id DESC LIMIT ?`, [scope, limit])).map(toRecord);
  }
}
