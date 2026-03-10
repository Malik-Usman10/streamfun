// Thumbnail generation service for videos and images
import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
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
    const { width = this.defaultWidth, height = this.defaultHeight } = options;
    const outputPath = join(tmpdir(), `thumb-${uuidv4()}.jpg`);

    try {
      // Resize image using ffmpeg
      await execAsync(
        `ffmpeg -i "${imagePath}" -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`,
        { timeout: 30000 }
      );

      // Read thumbnail and convert to base64
      const thumbnailBuffer = await readFile(outputPath);
      const base64 = thumbnailBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      // Clean up temp file
      await unlink(outputPath);

      logger.info({ imagePath }, 'Image thumbnail generated');

      return dataUrl;
    } catch (error: any) {
      logger.error({ error: error.message, imagePath }, 'Failed to generate image thumbnail');
      
      // Clean up on error
      try {
        await unlink(outputPath);
      } catch {}
      
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
    const tempInputPath = join(tmpdir(), `input-${uuidv4()}`);
    
    try {
      // Write buffer to temp file
      await require('fs/promises').writeFile(tempInputPath, buffer);
      
      // Generate thumbnail based on MIME type
      let thumbnail: string;
      if (mimeType.startsWith('video/')) {
        thumbnail = await this.generateVideoThumbnail(tempInputPath, options);
      } else if (mimeType.startsWith('image/')) {
        thumbnail = await this.generateImageThumbnail(tempInputPath, options);
      } else {
        throw new Error(`Unsupported MIME type for thumbnail: ${mimeType}`);
      }
      
      // Clean up input file
      await unlink(tempInputPath);
      
      return thumbnail;
    } catch (error: any) {
      // Clean up on error
      try {
        await unlink(tempInputPath);
      } catch {}
      
      throw error;
    }
  }
}
