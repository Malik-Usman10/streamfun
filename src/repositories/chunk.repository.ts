// Chunk repository for managing file chunk metadata
import { pool } from '../database/connection.js';
import type { ChunkMetadata, ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export interface ChunkedFileRecord {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  totalChunks: number;
  chunkSize: number;
  encryptionKey: string;
  iv: string;
  chunks: ChunkMetadata[];
}

export class ChunkRepository {
  async createChunk(chunk: Omit<ChunkMetadata, 'id'>): Promise<ChunkMetadata> {
    const result = await pool.query<ChunkMetadata>(
      `INSERT INTO file_chunks 
       (file_id, chunk_index, chunk_size, account_id, provider_type, provider_file_id, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        chunk.fileId,
        chunk.chunkIndex,
        chunk.chunkSize,
        chunk.accountId,
        chunk.providerType,
        chunk.providerFileId,
        chunk.uploadedAt,
      ]
    );
    
    return result.rows[0];
  }

  async getChunksByFileId(fileId: string): Promise<ChunkMetadata[]> {
    const result = await pool.query(
      `SELECT 
        id,
        file_id as "fileId",
        chunk_index as "chunkIndex",
        chunk_size as "chunkSize",
        account_id as "accountId",
        provider_type as "providerType",
        provider_file_id as "providerFileId",
        uploaded_at as "uploadedAt"
       FROM file_chunks 
       WHERE file_id = $1 
       ORDER BY chunk_index`,
      [fileId]
    );
    
    return result.rows as ChunkMetadata[];
  }

  async getTotalChunks(fileId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM file_chunks WHERE file_id = $1',
      [fileId]
    );
    
    return parseInt(result.rows[0].count, 10);
  }

  async createChunkedFile(data: {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    totalChunks: number;
    chunkSize: number;
    encryptionKey: string;
    iv: string;
    chunks: Omit<ChunkMetadata, 'id'>[];
  }): Promise<void> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert chunks
      for (const chunk of data.chunks) {
        await client.query(
          `INSERT INTO file_chunks 
           (file_id, chunk_index, chunk_size, account_id, provider_type, provider_file_id, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            chunk.fileId,
            chunk.chunkIndex,
            chunk.chunkSize,
            chunk.accountId,
            chunk.providerType,
            chunk.providerFileId,
            chunk.uploadedAt,
          ]
        );
      }
      
      await client.query('COMMIT');
      logger.info({ fileId: data.fileId }, 'Chunked file created successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, fileId: data.fileId }, 'Failed to create chunked file');
      throw error;
    } finally {
      client.release();
    }
  }

  async getChunkedFile(fileId: string): Promise<ChunkedFileRecord | null> {
    const fileResult = await pool.query(
      `SELECT filename, mime_type, size, encryption_key, encryption_iv 
       FROM files WHERE id = $1 AND is_chunked = true`,
      [fileId]
    );
    
    if (fileResult.rows.length === 0) {
      return null;
    }
    
    const file = fileResult.rows[0];
    const chunks = await this.getChunksByFileId(fileId);
    
    // Default to a sane chunk size if no chunks exist yet (e.g. from appConfig)
    const storedChunkSize = chunks.length > 0 ? chunks[0].chunkSize : 10 * 1024 * 1024;
    
    // Correct chunk size if encrypted (stored size includes 16-byte auth tag)
    const decryptedChunkSize = (file.encryption_key && storedChunkSize > 16) 
      ? storedChunkSize - 16 
      : storedChunkSize;
    
    return {
      fileId,
      filename: file.filename,
      mimeType: file.mime_type,
      size: file.size,
      totalChunks: chunks.length,
      chunkSize: decryptedChunkSize,
      encryptionKey: file.encryption_key,
      iv: file.encryption_iv,
      chunks,
    };
  }

  async deleteChunksByFileId(fileId: string): Promise<void> {
    await pool.query('DELETE FROM file_chunks WHERE file_id = $1', [fileId]);
  }
}
