import type { CallSite } from '../../../shared/types.ts';
import type { CallSiteCreateData, CallSiteUpdateData, ICallSiteRepository } from '../contracts/ICallSiteRepository.ts';
import { PgCrudRepository } from './PgCrudRepository.ts';

export class PgCallSiteRepository extends PgCrudRepository<CallSite, CallSiteCreateData, CallSiteUpdateData> implements ICallSiteRepository {
  protected readonly table = 'call_sites';
  protected readonly writableColumns = ['connection_id', 'file_path', 'line', 'symbol', 'snippet', 'notes'] as const;
  protected override readonly orderBy = 'file_path, line';

  async existsAt(connectionId: number, filePath: string, line: number | null): Promise<boolean> {
    return (
      (await this.db.get('SELECT 1 FROM call_sites WHERE connection_id = ? AND file_path = ? AND line IS NOT DISTINCT FROM ?', [
        connectionId,
        filePath,
        line,
      ])) !== null
    );
  }
}
