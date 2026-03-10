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
    try {
      const { id } = req.params;
      const file = await fileService.getFileMetadata(id);
      
      // Set headers for streaming
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      
      // Handle range requests for video streaming
      const range = req.headers.range;
      
      if (range) {
        // Parse range header
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
        const chunkSize = end - start + 1;
        
        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
        res.setHeader('Content-Length', chunkSize.toString());
        
        // Download file with range
        const { stream } = await fileService.downloadFile(id);
        const reader = stream.getReader();
        
        // Skip to start position
        let bytesRead = 0;
        while (bytesRead < start) {
          const { done, value } = await reader.read();
          if (done) break;
          bytesRead += value.length;
        }
        
        // Stream the requested range
        let bytesStreamed = 0;
        while (bytesStreamed < chunkSize) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const bytesToWrite = Math.min(value.length, chunkSize - bytesStreamed);
          res.write(value.slice(0, bytesToWrite));
          bytesStreamed += bytesToWrite;
        }
        
        res.end();
      } else {
        // No range request - stream entire file
        res.setHeader('Content-Length', file.size.toString());
        
        const { stream } = await fileService.downloadFile(id);
        const reader = stream.getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        
        res.end();
      }
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
              thumbnailUrl = link.url; // For images, use same URL as thumbnail
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
            uploadedAt: f.uploadedAt,
            thumbnailUrl,
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
      
      res.json({
        files: filteredFiles.map((f) => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
          mimeType: f.mimeType,
          provider: f.providerType,
          encrypted: !!f.encryptionKey,
          uploadedAt: f.uploadedAt,
        })),
        pagination: {
          page,
          limit,
          total: filteredFiles.length,
          totalPages: Math.ceil(filteredFiles.length / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
