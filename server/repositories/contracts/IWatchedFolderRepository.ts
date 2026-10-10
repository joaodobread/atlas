import type { WatchedFolder } from '../../../shared/types.ts';

export interface IWatchedFolderRepository {
  list(): Promise<WatchedFolder[]>;
  findById(id: number): Promise<WatchedFolder | null>;
  findByPath(path: string): Promise<WatchedFolder | null>;
  insert(path: string): Promise<WatchedFolder>;
  delete(id: number): Promise<boolean>;
  touchScan(id: number): Promise<void>;
}
