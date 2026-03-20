// Repository for scan_jobs table — tracks directory-watch auto-upload jobs
import { pool } from '../database/connection.js';
import logger from '../utils/logger.js';

export type ScanJobStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'skipped';

export interface ScanJob {
  id: string;
  sourcePath: string;
  filename: string;
  directoryName: string | null;
  fileSize: number;
  mimeType: string | null;
  status: ScanJobStatus;
  fileId: string | null;
  providerType: string | null;
  accountId: string | null;
  progress: number;
  errorMessage: string | null;
  retryCount: number;
  lastChunkIndex: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ScanJobStats {
  pending: number;
  uploading: number;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
}

function rowToJob(row: any): ScanJob {
  return {
    id: row.id,
    sourcePath: row.source_path,
    filename: row.filename,
    directoryName: row.directory_name,
    fileSize: parseInt(row.file_size),
    mimeType: row.mime_type,
    status: row.status,
    fileId: row.file_id,
    providerType: row.provider_type,
    accountId: row.account_id,
    progress: row.progress,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    lastChunkIndex: row.last_chunk_index || 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

export class ScanJobRepository {
  /**
   * Insert a new scan job (or silently skip if path already tracked)
   */
  async upsert(data: {
    sourcePath: string;
    filename: string;
    directoryName?: string;
    fileSize: number;
    mimeType?: string;
  }): Promise<ScanJob | null> {
    const result = await pool.query(
      `INSERT INTO scan_jobs (source_path, filename, directory_name, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_path) DO NOTHING
       RETURNING *`,
      [data.sourcePath, data.filename, data.directoryName ?? null, data.fileSize, data.mimeType ?? null]
    );
    if (result.rows.length === 0) return null; // already tracked
    logger.debug({ sourcePath: data.sourcePath }, 'Scan job created');
    return rowToJob(result.rows[0]);
  }

  async findById(id: string): Promise<ScanJob | null> {
    const result = await pool.query('SELECT * FROM scan_jobs WHERE id = $1', [id]);
    return result.rows.length ? rowToJob(result.rows[0]) : null;
  }

  async findBySourcePath(sourcePath: string): Promise<ScanJob | null> {
    const result = await pool.query('SELECT * FROM scan_jobs WHERE source_path = $1', [sourcePath]);
    return result.rows.length ? rowToJob(result.rows[0]) : null;
  }

  async findByFilenameAndSize(filename: string, fileSize: number): Promise<ScanJob | null> {
    const result = await pool.query('SELECT * FROM scan_jobs WHERE filename = $1 AND file_size = $2', [filename, fileSize]);
    return result.rows.length ? rowToJob(result.rows[0]) : null;
  }

  async findByStatus(status: ScanJobStatus): Promise<ScanJob[]> {
    const result = await pool.query(
      'SELECT * FROM scan_jobs WHERE status = $1 ORDER BY created_at ASC',
      [status]
    );
    return result.rows.map(rowToJob);
  }

  async getAll(options: { limit?: number; offset?: number; status?: ScanJobStatus } = {}): Promise<ScanJob[]> {
    const { limit = 50, offset = 0, status } = options;
    const params: any[] = [limit, offset];
    let where = '';
    if (status) {
      where = 'WHERE status = $3';
      params.push(status);
    }
    const result = await pool.query(
      `SELECT * FROM scan_jobs ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows.map(rowToJob);
  }

  async getStats(): Promise<ScanJobStats> {
    const result = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM scan_jobs GROUP BY status`
    );
    const stats: ScanJobStats = { pending: 0, uploading: 0, completed: 0, failed: 0, skipped: 0, total: 0 };
    for (const row of result.rows) {
      const key = row.status as ScanJobStatus;
      if (key in stats) stats[key] = row.count;
      stats.total += row.count;
    }
    return stats;
  }

  async updateStatus(id: string, status: ScanJobStatus): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    );
  }

  async updateProgress(id: string, progress: number, status?: ScanJobStatus): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET progress = $1, status = COALESCE($2, status), updated_at = NOW()
       WHERE id = $3`,
      [Math.round(progress), status ?? null, id]
    );
  }

  async updateChunkProgress(id: string, progress: number, chunkIndex: number): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET progress = $1, last_chunk_index = $2, updated_at = NOW()
       WHERE id = $3`,
      [Math.round(progress), chunkIndex, id]
    );
  }

  async markUploading(id: string, providerType: string, accountId: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET status = 'uploading', provider_type = $1, account_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [providerType, accountId, id]
    );
  }

  async updateFileId(id: string, fileId: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET file_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [fileId, id]
    );
  }

  async markCompleted(id: string, fileId: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET status = 'completed', file_id = $1, progress = 100, last_chunk_index = 0, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [fileId, id]
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET status = 'failed', error_message = $1, retry_count = retry_count + 1, updated_at = NOW()
       WHERE id = $2`,
      [errorMessage, id]
    );
  }

  async resetForRetry(id: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET status = 'pending', error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async updateSourcePath(id: string, newPath: string): Promise<void> {
    await pool.query(
      `UPDATE scan_jobs
       SET source_path = $1, updated_at = NOW()
       WHERE id = $2`,
      [newPath, id]
    );
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM scan_jobs WHERE id = $1', [id]);
  }

  /**
   * Find interrupted uploads (were uploading when container crashed) — needs re-enqueue
   */
  async findInterrupted(): Promise<ScanJob[]> {
    const result = await pool.query(
      `SELECT * FROM scan_jobs WHERE status = 'uploading' ORDER BY created_at ASC`
    );
    return result.rows.map(rowToJob);
  }
}
