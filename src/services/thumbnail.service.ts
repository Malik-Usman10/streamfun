// Thumbnail generation service for videos and images
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  timestamp?: number; // For videos, timestamp in seconds to capture frame
}

export class ThumbnailService {
  private readonly defaultWidth = 320;
  private readonly defaultHeight = 180;
  private readonly defaultQuality = 80;

  /**
   * Generate thumbnail from video file
   */
  async generateVideoThumbnail(
    videoPath: string,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const { width = this.defaultWidth, height = this.defaultHeight, timestamp = 5 } = options;
    const outputPath = join(tmpdir(), `thumb-${uuidv4()}.jpg`);

    try {
      // Extract frame at specified timestamp using ffmpeg
      await execAsync(
        `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`,
        { timeout: 30000 }
      );

      // Read thumbnail and convert to base64
      const thumbnailBuffer = await readFile(outputPath);
      const base64 = thumbnailBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      // Clean up temp file
      await unlink(outputPath);

      logger.info({ videoPath, timestamp }, 'Video thumbnail generated');

      return dataUrl;
    } catch (error: any) {
      logger.error({ error: error.message, videoPath }, 'Failed to generate video thumbnail');
      
      // Clean up on error
      try {
        await unlink(outputPath);
      } catch {}
      
      throw new Error(`Thumbnail generation failed: ${error.message}`);
    }
  }

  /**
   * Generate thumbnail from image file
   */
  async generateImageThumbnail(
    imagePath: string,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const { width = this.defaultWidth, height = this.defaultHeight, quality = this.defaultQuality } = options;

    try {
      const buffer = await sharp(imagePath)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();

      const base64 = buffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      logger.info({ imagePath }, 'Image thumbnail generated using Sharp');
      return dataUrl;
    } catch (error: any) {
      logger.error({ error: error.message, imagePath }, 'Failed to generate image thumbnail with Sharp');
      throw new Error(`Thumbnail generation failed: ${error.message}`);
    }
  }

  /**
   * Generate thumbnail from buffer (for in-memory processing)
   */
  async generateThumbnailFromBuffer(
    buffer: Buffer,
    mimeType: string,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    try {
      if (mimeType.startsWith('image/')) {
        const { width = this.defaultWidth, height = this.defaultHeight, quality = this.defaultQuality } = options;
        const outBuffer = await sharp(buffer)
          .resize(width, height, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality })
          .toBuffer();

        const base64 = outBuffer.toString('base64');
        return `data:image/jpeg;base64,${base64}`;
      } else if (mimeType.startsWith('video/')) {
        // For video, we still need to write to disk for ffmpeg
        const ext = mimeType.split('/')[1] || 'bin';
        const tempInputPath = join(tmpdir(), `input-${uuidv4()}.${ext}`);
        
        try {
          await writeFile(tempInputPath, buffer);
          const thumbnail = await this.generateVideoThumbnail(tempInputPath, options);
          await unlink(tempInputPath);
          return thumbnail;
        } catch (error) {
          try { await unlink(tempInputPath); } catch {}
          throw error;
        }
      } else {
        throw new Error(`Unsupported MIME type for thumbnail: ${mimeType}`);
      }
    } catch (error: any) {
      throw error;
    }
  }
}
