// File repository for managing file metadata
import { pool } from '../database/connection.js';
import type { FileRecord, ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export interface CreateFileData {
  id?: string;
  filename: string;
  mimeType?: string;
  size: number;
  providerType: ProviderType;
  accountId: string;
  providerFileId: string;
  isChunked?: boolean;
  encryptionKey?: string;
  encryptionIv?: string;
  metadata?: Record<string, any>;
  uploadedAt: Date;
}

export interface FileListOptions {
  page?: number;
  limit?: number;
  providerType?: ProviderType;
  mimeType?: string;
}

export class FileRepository {
  async create(data: CreateFileData): Promise<FileRecord> {
    const query = data.id
      ? `INSERT INTO files 
         (id, filename, mime_type, size, provider_type, account_id, provider_file_id, 
          is_chunked, encryption_key, encryption_iv, metadata, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`
      : `INSERT INTO files 
         (filename, mime_type, size, provider_type, account_id, provider_file_id, 
          is_chunked, encryption_key, encryption_iv, metadata, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`;
    
    const params = data.id
      ? [
          data.id,
          data.filename,
          data.mimeType,
          data.size,
          data.providerType,
          data.accountId,
          data.providerFileId,
          data.isChunked || false,
          data.encryptionKey,
          data.encryptionIv,
          data.metadata ? JSON.stringify(data.metadata) : null,
          data.uploadedAt,
        ]
      : [
          data.filename,
          data.mimeType,
          data.size,
          data.providerType,
          data.accountId,
          data.providerFileId,
          data.isChunked || false,
          data.encryptionKey,
          data.encryptionIv,
          data.metadata ? JSON.stringify(data.metadata) : null,
          data.uploadedAt,
        ];
    
    const result = await pool.query<FileRecord>(query, params);
    
    return this.mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<FileRecord | null> {
    const result = await pool.query<FileRecord>(
      'SELECT * FROM files WHERE id = $1',
      [id]
    );
    
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findByAccountId(accountId: string): Promise<FileRecord[]> {
    const result = await pool.query<FileRecord>(
      'SELECT * FROM files WHERE account_id = $1 ORDER BY uploaded_at DESC',
      [accountId]
    );
    
    return result.rows.map(this.mapRow);
  }

  async list(options: FileListOptions = {}): Promise<{ files: FileRecord[]; total: number }> {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM files WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;
    
    if (options.providerType) {
      query += ` AND provider_type = $${paramIndex}`;
      params.push(options.providerType);
      paramIndex++;
    }
    
    if (options.mimeType) {
      query += ` AND mime_type LIKE $${paramIndex}`;
      params.push(`${options.mimeType}%`);
      paramIndex++;
    }
    
    query += ` ORDER BY uploaded_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);
    
    const result = await pool.query<FileRecord>(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM files WHERE 1=1';
    const countParams: any[] = [];
    let countParamIndex = 1;
    
    if (options.providerType) {
      countQuery += ` AND provider_type = $${countParamIndex}`;
      countParams.push(options.providerType);
      countParamIndex++;
    }
    
    if (options.mimeType) {
      countQuery += ` AND mime_type LIKE $${countParamIndex}`;
      countParams.push(`${options.mimeType}%`);
    }
    
    const countResult = await pool.query<{ count: string }>(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);
    
    return {
      files: result.rows.map(this.mapRow),
      total,
    };
  }

  async update(id: string, data: Partial<CreateFileData>): Promise<FileRecord> {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.filename !== undefined) {
        fields.push(`filename = $${paramIndex++}`);
        values.push(data.filename);
      }

      if (data.metadata !== undefined) {
        fields.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(data.metadata));
      }

      if ((data as any).thumbnailData !== undefined) {
        fields.push(`thumbnail_data = $${paramIndex++}`);
        values.push((data as any).thumbnailData);
      }

      fields.push('updated_at = NOW()');
      values.push(id);

      const result = await pool.query<FileRecord>(
        `UPDATE files SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      return this.mapRow(result.rows[0]);
    }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM files WHERE id = $1', [id]);
  }

  private mapRow(row: any): FileRecord {
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: parseInt(row.size, 10),
      providerType: row.provider_type,
      accountId: row.account_id,
      providerFileId: row.provider_file_id,
      isChunked: row.is_chunked,
      encryptionKey: row.encryption_key,
      encryptionIv: row.encryption_iv,
      category: row.category,
      collectionName: row.collection_name,
      thumbnailData: row.thumbnail_data,
      metadata: row.metadata,
      uploadedAt: row.uploaded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
