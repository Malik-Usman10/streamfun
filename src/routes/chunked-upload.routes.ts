// Chunked upload routes for large files
import { Router } from 'express';
import { ChunkManager } from '../services/chunk-manager.service.js';
import { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export function createChunkedUploadRoutes(chunkManager: ChunkManager): Router {
  const router = Router();

  // Initialize chunked upload
  router.post('/init', async (req, res, next) => {
    try {
      const { filename, size, chunkSize, provider, mimeType, encrypt = true, collectionName } = req.body;
      
      if (!filename || !size || !provider) {
        return res.status(400).json({ 
          error: 'Filename, size, and provider required' 
        });
      }
      
      // Validate and convert provider string to ProviderType
      const providerMap: Record<string, ProviderType> = {
        'google_drive': ProviderType.GOOGLE_DRIVE,
        'koofr': ProviderType.KOOFR,
        'terabox': ProviderType.TERABOX,
        'filen': ProviderType.FILEN,
        'blomp': ProviderType.BLOMP,
      };
      
      const providerType = providerMap[provider];
      if (!providerType) {
        return res.status(400).json({ 
          error: `Invalid provider: ${provider}. Valid providers: google_drive, koofr, terabox, filen, blomp` 
        });
      }
      
      const finalChunkSize = chunkSize || 10 * 1024 * 1024; // Default 10 MB
      const totalChunks = Math.ceil(size / finalChunkSize);
      
      // Create file record
      const fileId = await chunkManager.initializeChunkedUpload({
        filename,
        size,
        chunkSize: finalChunkSize,
        totalChunks,
        providerType,
        mimeType,
        encrypt,
        collectionName,
      });
      
      res.status(201).json({
        fileId,
        totalChunks,
        chunkSize: finalChunkSize,
      });
    } catch (error) {
      next(error);
    }
  });

  // Upload a single chunk
  router.put('/:fileId/chunk/:chunkIndex', async (req, res, next) => {
    try {
      const { fileId, chunkIndex } = req.params;
      const index = parseInt(chunkIndex);
      
      if (isNaN(index) || index < 0) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }
      
      // Get chunk data from request body (simplified - in production use streaming)
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      
      await new Promise((resolve, reject) => {
        req.on('end', resolve);
        req.on('error', reject);
      });
      
      const chunkData = Buffer.concat(chunks);
      
      // Create ReadableStream from buffer
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunkData);
          controller.close();
        },
      });
      
      await chunkManager.uploadChunkData(fileId, index, stream, chunkData.length);
      
      res.json({ 
        success: true,
        chunkIndex: index,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get upload progress
  router.get('/:fileId/progress', async (req, res, next) => {
    try {
      const { fileId } = req.params;
      const progress = await chunkManager.getUploadProgress(fileId);
      
      res.json({
        fileId,
        totalChunks: progress.totalChunks,
        uploadedChunks: progress.uploadedChunks,
        percentage: progress.percentage,
        isComplete: progress.isComplete,
      });
    } catch (error) {
      next(error);
    }
  });

  // Complete chunked upload
  router.post('/:fileId/complete', async (req, res, next) => {
    try {
      const { fileId } = req.params;
      const file = await chunkManager.finalizeChunkedUpload(fileId);
      
      res.json({
        success: true,
        file: {
          id: file.id,
          filename: file.filename,
          size: file.size,
          provider: file.providerType,
          encrypted: !!file.encryptionKey,
          uploadedAt: file.uploadedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Resume interrupted upload
  router.post('/:fileId/resume', async (req, res, next) => {
    try {
      const { fileId } = req.params;
      
      // Get missing chunks
      const progress = await chunkManager.getUploadProgress(fileId);
      
      res.json({
        fileId,
        missingChunks: progress.missingChunks || [],
        uploadedChunks: progress.uploadedChunks,
        totalChunks: progress.totalChunks,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
