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
  private readonly defaultWidth = 480;
  private readonly defaultHeight = 270;
  private readonly defaultQuality = 85;

  /**
   * Generate thumbnail from video file with robust fallback logic
   */
  async generateVideoThumbnail(
    videoPath: string,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const { width = this.defaultWidth, height = this.defaultHeight, timestamp = 5 } = options;
    const outputPath = join(tmpdir(), `thumb-${uuidv4()}.jpg`);

    // Common flags for network resilience
    const networkFlags = videoPath.startsWith('http') 
      ? '-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 2' 
      : '';

    // Strategy 1: Fast Seek (before -i) — most efficient
    // -an: disable audio, -sn: disable subtitles, -fflags: tolerate corrupt frames
    const baseFlags = '-an -sn -fflags +discardcorrupt+genpts -y';
    const fastSeekCmd = `ffmpeg ${networkFlags} -ss ${timestamp} -i "${videoPath}" -vframes 1 ${baseFlags} -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`;
    
    // Strategy 2: Fast Seek with Accurate flag
    const accurateFastSeekCmd = `ffmpeg ${networkFlags} -ss ${timestamp} -accurate_seek -i "${videoPath}" -vframes 1 ${baseFlags} -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`;
    
    // Strategy 3: Slow Seek (after -i) — most compatible for difficult streams
    const slowSeekCmd = `ffmpeg ${networkFlags} -i "${videoPath}" -ss ${timestamp} -vframes 1 ${baseFlags} -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`;
    
    // Strategy 4: Fallback to beginning of video (if deep seek fails)
    const fallbackStartCmd = `ffmpeg ${networkFlags} -ss 1 -i "${videoPath}" -vframes 1 ${baseFlags} -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`;

    const strategies = [
      { name: 'Fast Seek', cmd: fastSeekCmd },
      { name: 'Accurate Fast Seek', cmd: accurateFastSeekCmd },
      { name: 'Slow Seek', cmd: slowSeekCmd },
      { name: 'Fallback Start', cmd: fallbackStartCmd }
    ];

    let lastError = null;

    for (const strategy of strategies) {
      try {
        logger.debug({ strategy: strategy.name, videoPath, timestamp }, 'Attempting video frame capture');
        // Increase timeout for Slow Seek as it might need to download more data
        const timeout = strategy.name === 'Slow Seek' ? 60000 : 45000;
        await execAsync(strategy.cmd, { timeout });
        
        // Read thumbnail and convert to base64
        const thumbnailBuffer = await readFile(outputPath);
        const base64 = thumbnailBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64}`;

        // Clean up temp file
        await unlink(outputPath);
        logger.info({ strategy: strategy.name, timestamp }, 'Video thumbnail generated successfully');
        return dataUrl;
      } catch (error: any) {
        lastError = error;
        logger.warn({ 
          strategy: strategy.name, 
          error: error.message, 
          stderr: error.stderr?.substring(0, 500) 
        }, 'Video capture strategy failed');
        
        // Clean up temp file if it was partially created
        try { await unlink(outputPath); } catch {}
      }
    }

    logger.error({ videoPath, timestamp, lastError: lastError?.message }, 'All video thumbnail strategies failed');
    throw new Error(`Video thumbnail generation failed after all attempts: ${lastError?.message}`);
  }

  /**
   * Get duration of a video file in seconds
   */
  async getVideoDuration(videoPath: string): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      );
      return parseFloat(stdout.trim());
    } catch (error: any) {
      logger.error({ error: error.message, videoPath }, 'Failed to get video duration');
      return 0;
    }
  }

  /**
   * Generate multiple thumbnail candidates from a video at different timestamps
   */
  async generateMultipleVideoThumbnails(
    videoPath: string,
    duration: number,
    count: number = 6,
    options: ThumbnailOptions = {}
  ): Promise<string[]> {
    const thumbnails: string[] = [];
    
    // Percentages to capture: e.g. 10%, 25%, 40%, 55%, 70%, 85%
    const step = 0.75 / count;
    const start = 0.1;
    
    for (let i = 0; i < count; i++) {
      const percentage = start + (i * step);
      const timestamp = Math.floor(duration * percentage);
      try {
        const dataUrl = await this.generateVideoThumbnail(videoPath, {
          ...options,
          timestamp: Math.max(1, timestamp)
        });
        thumbnails.push(dataUrl);
      } catch (err) {
        logger.warn({ videoPath, timestamp, i }, 'Failed to generate one of the multiple thumbnails');
      }
    }
    
    return thumbnails;
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
      logger.warn({ error: error.message, imagePath }, 'Sharp failed to generate image thumbnail, attempting ffmpeg fallback');
      
      try {
        const dataUrl = await this.generateImageThumbnailWithFFmpeg(imagePath, options);
        logger.info({ imagePath }, 'Image thumbnail generated using ffmpeg fallback');
        return dataUrl;
      } catch (fallbackError: any) {
        logger.error({ error: fallbackError.message, imagePath }, 'FFmpeg fallback also failed for image thumbnail');
        throw new Error(`Thumbnail generation failed (Sharp and FFmpeg): ${error.message} / ${fallbackError.message}`);
      }
    }
  }

  /**
   * Helper to generate image thumbnail using ffmpeg (slower but more resilient than Sharp for some formats)
   */
  private async generateImageThumbnailWithFFmpeg(
    imagePath: string,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const { width = this.defaultWidth, height = this.defaultHeight } = options;
    const outputPath = join(tmpdir(), `image-thumb-${uuidv4()}.jpg`);

    try {
      // Use ffmpeg to convert image to jpeg thumbnail
      // -i input -vf scale=w:h (maintaining aspect ratio) -vframes 1 output
      await execAsync(
        `ffmpeg -i "${imagePath}" -vframes 1 -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease" "${outputPath}"`,
        { timeout: 15000 }
      );

      const buffer = await readFile(outputPath);
      const base64 = buffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      await unlink(outputPath);
      return dataUrl;
    } catch (error) {
      try { await unlink(outputPath); } catch {}
      throw error;
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
        try {
          const outBuffer = await sharp(buffer)
            .resize(width, height, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality })
            .toBuffer();

          const base64 = outBuffer.toString('base64');
          return `data:image/jpeg;base64,${base64}`;
        } catch (sharpError: any) {
          logger.warn({ error: sharpError.message }, 'Sharp failed to generate thumbnail from buffer, trying ffmpeg fallback');
          
          // Write buffer to temp file for ffmpeg
          const tempPath = join(tmpdir(), `buffer-input-${uuidv4()}.png`); // Assuming PNG or generic image
          try {
            await writeFile(tempPath, buffer);
            const thumbnail = await this.generateImageThumbnailWithFFmpeg(tempPath, options);
            await unlink(tempPath);
            return thumbnail;
          } catch (ffmpegError) {
            try { await unlink(tempPath); } catch {}
            throw new Error(`Buffer thumbnail generation failed (Sharp and FFmpeg): ${sharpError.message}`);
          }
        }
      } else if (mimeType.startsWith('video/')) {
        // For video, we still need to write to disk for ffmpeg
        const ext = mimeType.split('/')[1] || 'bin';
        const tempInputPath = join(tmpdir(), `input-${uuidv4()}.${ext}`);
        
        try {
          await writeFile(tempInputPath, buffer);
          // For buffers (which are often partial files), default to timestamp 0 to ensure we get a frame
          const thumbnail = await this.generateVideoThumbnail(tempInputPath, {
            ...options,
            timestamp: options.timestamp ?? 0
          });
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
