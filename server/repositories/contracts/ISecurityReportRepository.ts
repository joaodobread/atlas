import type { SecurityReportRecord } from '../../../shared/types.ts';

export type NewSecurityReport = Omit<SecurityReportRecord, 'id' | 'createdAt' | 'createdBy'> & { createdBy: number | null };

export interface ISecurityReportRepository {
  insert(report: NewSecurityReport): Promise<SecurityReportRecord>;
  /** Mais novos primeiro. */
  list(scope: string, limit: number): Promise<SecurityReportRecord[]>;
}
