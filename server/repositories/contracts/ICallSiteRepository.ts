import type { CallSite } from '../../../shared/types.ts';
import type { ICrudRepository } from './ICrudRepository.ts';

export type CallSiteCreateData = Pick<CallSite, 'connection_id' | 'file_path'> &
  Partial<Pick<CallSite, 'line' | 'symbol' | 'snippet' | 'notes' | 'end_line' | 'code'>>;
export type CallSiteUpdateData = Partial<Pick<CallSite, 'file_path' | 'line' | 'symbol' | 'snippet' | 'notes' | 'end_line' | 'code'>>;

export interface ICallSiteRepository extends ICrudRepository<CallSite, CallSiteCreateData, CallSiteUpdateData> {
  existsAt(connectionId: number, filePath: string, line: number | null): Promise<boolean>;
}
