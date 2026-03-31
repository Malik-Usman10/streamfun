// File operation routes
import { Router } from 'express';
import { FileService } from '../services/file.service.js';
import { StreamService } from '../services/stream.service.js';
import { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export function createFileRoutes(fileService: FileService, streamService: StreamService): Router {
  const router = Router();

  // Upload file
  router.post('/upload', async (req, res, next) => {
    try {
      // For now, simplified - in production use multer or similar
      const { filename, mimeType, size, provider, encrypt = true } = req.body;

      if (!filename || !size || !provider) {
        return res.status(400).json({ error: 'Filename, size, and provider required' });
      }

      // Create a simple stream for testing
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('test file content'));
          controller.close();
        },
      });

      const file = await fileService.uploadFile(
        provider as ProviderType,
        { filename, mimeType, size, stream },
        encrypt
      );

      res.status(201).json({
        id: file.id,
        filename: file.filename,
        size: file.size,
        provider: file.providerType,
        encrypted: !!file.encryptionKey,
        uploadedAt: file.uploadedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // Upload file from URL
  router.post('/url-upload', async (req, res, next) => {
    try {
      const { url, filename, provider, encrypt = false } = req.body;

      if (!url || !filename || !provider) {
        return res.status(400).json({ error: 'URL, filename, and provider required' });
      }

      const file = await fileService.uploadFromUrl(
        provider as ProviderType,
        url,
        filename,
        encrypt
      );

      res.status(201).json({
        id: file.id,
        filename: file.filename,
        size: file.size,
        provider: file.providerType,
        encrypted: !!file.encryptionKey,
        uploadedAt: file.uploadedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // Download file
  router.get('/:id/download', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { stream, file } = await fileService.downloadFile(id);

      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Length', file.size.toString());

      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }

      res.end();
    } catch (error) {
      next(error);
    }
  });

  // List files
  router.get('/', async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const provider = req.query.provider as ProviderType | undefined;
      const mimeType = req.query.type as string | undefined;

      const result = await fileService.listFiles({
        page,
        limit,
        providerType: provider,
        mimeType,
      });

      res.json({
        files: result.files.map((f) => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
          mimeType: f.mimeType,
          provider: f.providerType,
          encrypted: !!f.encryptionKey,
          chunked: f.isChunked,
          thumbnail: f.thumbnailData,
          uploadedAt: f.uploadedAt,
        })),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Get categories for a specific file type (MUST be before /:id route)
  router.get('/categories', async (req, res, next) => {
    try {
      const fileType = req.query.type as string; // 'image' or 'video'

      if (!fileType || !['image', 'video'].includes(fileType)) {
        return res.status(400).json({
          error: 'File type required (image or video)'
        });
      }

      const categories = await fileService.getCategories(fileType as 'image' | 'video');

      res.json({
        categories: categories.map(cat => ({
          name: cat.name,
          count: cat.count,
          fileType,
          thumbnail: cat.thumbnail,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Gallery view - optimized for images and videos
  router.get('/gallery', async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const fileType = req.query.type as string; // 'image' or 'video'
      const category = req.query.category as string; // specific category filter
      const sortBy = req.query.sortBy as string;
      const sortOrder = req.query.sortOrder as string;

      // Map file type to MIME type prefix
      let mimeType: string | undefined;
      if (fileType === 'image') {
        mimeType = 'image/';
      } else if (fileType === 'video') {
        mimeType = 'video/';
      }

      const result = await fileService.listFiles({
        page,
        limit,
        mimeType,
        category,
        sortBy: sortBy === 'filename' ? 'filename' : undefined,
        sortOrder: sortOrder === 'ASC' ? 'ASC' : undefined,
      });

      // Generate thumbnail/streaming URLs for gallery items
      const galleryItems = await Promise.all(
        result.files.map(async (f) => {
          let thumbnailUrl: string | undefined;
          let streamingUrl: string | undefined;

          // Generate streaming link for videos and images
          if (f.mimeType?.startsWith('video/') || f.mimeType?.startsWith('image/')) {
            try {
              const link = await streamService.generateStreamingLink(f.id);
              streamingUrl = link.url;
              
              // Only use streaming link as thumbnail for images
              if (f.mimeType.startsWith('image/')) {
                thumbnailUrl = link.url;
              }
            } catch (error) {
              logger.warn({ fileId: f.id, error }, 'Failed to generate streaming link for gallery item');
            }
          }

          return {
            id: f.id,
            filename: f.filename,
            size: f.size,
            mimeType: f.mimeType,
            provider: f.providerType,
            category: f.category,
            collectionName: f.collectionName,
            encrypted: !!f.encryptionKey,
            uploadedAt: f.uploadedAt,
            thumbnail: f.thumbnailData || thumbnailUrl,
            streamingUrl,
          };
        })
      );

      res.json({
        items: galleryItems,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Search files
  router.get('/search', async (req, res, next) => {
    try {
      const query = req.query.q as string;
      const fileType = req.query.type as string;
      const dateFrom = req.query.dateFrom as string;
      const dateTo = req.query.dateTo as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      if (!query && !fileType && !dateFrom && !dateTo) {
        return res.status(400).json({
          error: 'At least one search parameter required (q, type, dateFrom, dateTo)'
        });
      }

      // Map file type to MIME type prefix
      let mimeType: string | undefined;
      if (fileType === 'image') {
        mimeType = 'image/';
      } else if (fileType === 'video') {
        mimeType = 'video/';
      } else if (fileType) {
        mimeType = fileType;
      }

      // For now, use basic filtering (in production, implement full-text search)
      const result = await fileService.listFiles({
        page,
        limit,
        mimeType,
      });

      // Filter by filename if query provided
      let filteredFiles = result.files;
      if (query) {
        const lowerQuery = query.toLowerCase();
        filteredFiles = filteredFiles.filter(f =>
          f.filename.toLowerCase().includes(lowerQuery)
        );
      }

      // Filter by date range
      if (dateFrom) {
        const fromDate = new Date(dateFrom);
        filteredFiles = filteredFiles.filter(f =>
          new Date(f.uploadedAt) >= fromDate
        );
      }

      if (dateTo) {
        const toDate = new Date(dateTo);
        filteredFiles = filteredFiles.filter(f =>
          new Date(f.uploadedAt) <= toDate
        );
      }

      // Generate thumbnail/streaming URLs for search results
      const items = await Promise.all(
        filteredFiles.map(async (f) => {
          let thumbnailUrl: string | undefined;
          let streamingUrl: string | undefined;

          if (f.mimeType?.startsWith('video/') || f.mimeType?.startsWith('image/')) {
            try {
              const link = await streamService.generateStreamingLink(f.id);
              streamingUrl = link.url;
              thumbnailUrl = link.url;
            } catch (error) {
              logger.warn({ fileId: f.id, error }, 'Failed to generate streaming link for search item');
            }
          }

          return {
            id: f.id,
            filename: f.filename,
            size: f.size,
            mimeType: f.mimeType,
            provider: f.providerType,
            category: f.category,
            collectionName: f.collectionName,
            encrypted: !!f.encryptionKey,
            uploadedAt: f.uploadedAt,
            thumbnail: f.thumbnailData || thumbnailUrl,
            streamingUrl,
          };
        })
      );

      res.json({
        files: items, // keep key 'files' for app.js loadSearchFiles
        pagination: {
          page,
          limit,
          total: items.length,
          totalPages: Math.ceil(items.length / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Get file metadata
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const file = await fileService.getFileMetadata(id);

      res.json({
        id: file.id,
        filename: file.filename,
        size: file.size,
        mimeType: file.mimeType,
        provider: file.providerType,
        encrypted: !!file.encryptionKey,
        chunked: file.isChunked,
        uploadedAt: file.uploadedAt,
        metadata: file.metadata,
      });
    } catch (error) {
      next(error);
    }
  });

  // Rename a category (bulk update collection_name)
  // Body: { oldName: string, newName: string, type: 'image' | 'video' }
  router.patch('/rename-category', async (req, res, next) => {
    try {
      const { oldName, newName, type } = req.body;

      if (!oldName || !newName || !type) {
        return res.status(400).json({ error: 'oldName, newName, and type are required' });
      }

      const { pool } = await import('../database/connection.js');
      const mimeTypePrefix = type === 'image' ? 'image/%' : 'video/%';

      // Use a transaction or single update
      // If oldName is 'Uncategorized', it means collection_name IS NULL
      let query;
      const params = [newName, mimeTypePrefix];
      
      if (oldName === 'Uncategorized') {
        query = `UPDATE files SET collection_name = $1 WHERE collection_name IS NULL AND mime_type LIKE $2`;
      } else {
        params.push(oldName);
        query = `UPDATE files SET collection_name = $1 WHERE collection_name = $3 AND mime_type LIKE $2`;
      }

      const result = await pool.query(query, params);

      res.json({
        success: true,
        message: `Renamed ${result.rowCount} files from "${oldName}" to "${newName}"`,
        count: result.rowCount
      });
    } catch (error) {
      next(error);
    }
  });

  // Rename a file (video title) or image collection
  // Body: { filename?: string, collectionName?: string }
  router.patch('/:id/rename', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { filename, collectionName } = req.body;

      if (!filename && !collectionName) {
        return res.status(400).json({ error: 'Provide filename or collectionName to rename' });
      }

      const { pool } = await import('../database/connection.js');

      // Check file exists
      const check = await pool.query('SELECT id, category FROM files WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (filename) {
        params.push(filename);
        updates.push(`filename = $${params.length}`);
      }
      if (collectionName) {
        params.push(collectionName);
        updates.push(`collection_name = $${params.length}`);
      }

      params.push(id);
      await pool.query(
        `UPDATE files SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params
      );

      res.json({ success: true, id, filename, collectionName });
    } catch (error) {
      next(error);
    }
  });

  // Delete file
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      await fileService.deleteFile(id);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Regenerate thumbnail for a file
  router.post('/:id/thumbnail', async (req, res, next) => {
    try {
      const { id } = req.params;
      const thumbnailData = await fileService.regenerateThumbnail(id);
      
      res.json({
        success: true,
        thumbnail: thumbnailData
      });
    } catch (error) {
      next(error);
    }
  });

  // Get multiple thumbnail candidates (for picker)
  router.get('/:id/thumbnails/candidates', async (req, res, next) => {
    try {
      const { id } = req.params;
      const count = parseInt(req.query.count as string) || 6;
      const candidates = await fileService.generateThumbnailCandidates(id, count);
      
      res.json({
        success: true,
        candidates
      });
    } catch (error) {
      next(error);
    }
  });

  // Apply a selected thumbnail
  router.post('/:id/thumbnail/apply', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { thumbnail } = req.body;

      if (!thumbnail) {
        return res.status(400).json({ error: 'Thumbnail data required' });
      }

      await fileService.updateFileThumbnail(id, thumbnail);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Generate streaming link
  router.get('/:id/stream', async (req, res, next) => {
    try {
      const { id } = req.params;

      // Return our own streaming URL instead of relying on rclone link
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const streamingUrl = `${baseUrl}/api/files/${id}/play`;

      res.json({
        url: streamingUrl,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });
    } catch (error) {
      next(error);
    }
  });

  // Serve file for streaming (supports range requests for video)
  router.get('/:id/play', async (req, res, next) => {
    const startTime = Date.now();
    const { id } = req.params;
    const internalToken = req.query.internalToken;
    
    // Allow internal bypass or require auth
    const { appConfig } = await import('../config/index.js');
    const isInternal = internalToken === appConfig.server.internalSecret;

    try {
      // If not internal, we rely on the parent router's requireAuth middleware 
      // (which is already applied to /api/files in app.ts)
      const file = await fileService.getFileMetadata(id);

      // Set basic headers for streaming
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      let start = 0;
      let end = file.size - 1;

      if (range) {
        // Parse range header
        const parts = range.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
        const chunkSize = end - start + 1;

        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
        res.setHeader('Content-Length', chunkSize.toString());
        
        logger.info({ fileId: id, range: `bytes=${start}-${end}`, size: file.size }, 'Handling range request');
      } else {
        res.setHeader('Content-Length', file.size.toString());
        logger.info({ fileId: id, size: file.size }, 'Handling full file request');
      }

      // Initialize download with the request's abort signal (Express 5+) or a manual one
      const abortController = new AbortController();
      const signal = (req as any).signal || abortController.signal;
      
      const { stream } = await fileService.downloadFile(id, start, end, signal);
      const reader = stream.getReader();
      let streamActive = true;
 
      const cleanup = async () => {
        if (!streamActive) return;
        streamActive = false;
        abortController.abort(); // Signal cancellation to the provider/limiter
        try {
          await reader.cancel();
        } catch (err) {
          // Ignore cancellation errors if stream is already closed
        }
      };
 
      req.on('close', cleanup);

      let firstByteSent = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          if (!firstByteSent) {
            const ttfb = Date.now() - startTime;
            logger.info({ fileId: id, ttfb }, 'First byte sent to client');
            firstByteSent = true;
          }
          
          res.write(value);
        }
        streamActive = false; // Mark as done before end
        res.end();
      } catch (streamError: any) {
         streamActive = false;
         logger.error({ error: streamError.message, fileId: id }, 'Stream interrupted during playback');
         if (!res.headersSent) return next(streamError);
         res.end();
      } finally {
        req.off('close', cleanup);
        reader.releaseLock();
      }
    } catch (error: any) {
      logger.error({ error: error.message, fileId: id }, 'Playback initialization failed');
      if (!res.headersSent) {
        res.status(error.name === 'FileNotFoundError' ? 404 : 500).json({ error: error.message });
      } else {
        res.end();
      }
    }
  });

  return router;
}
