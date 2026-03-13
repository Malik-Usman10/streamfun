// Directory scanner using chokidar to watch /uploads bind-mount
// Discovers videos and image galleries, creates scan_jobs, enqueues to BullMQ
import { watch, type FSWatcher } from 'chokidar';
import { stat, readdir } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { lookup as mimeTypeLookup } from 'mime-types';
import { ScanJobRepository } from '../repositories/scan-job.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { AutoUploadQueue } from './auto-upload.queue.js';
import { appConfig } from '../config/index.js';
import logger from '../utils/logger.js';

const WATCH_DIR = process.env.UPLOAD_WATCH_DIR ?? '/uploads';

// File stabilisation: wait for file to stop being written before processing
const STABILISE_WAIT_MS = 5000;

const SUPPORTED_VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mpeg', '.mpg', '.3gp',
]);

const SUPPORTED_IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.avif', '.heic',
]);

function isSupportedVideo(filePath: string): boolean {
  return SUPPORTED_VIDEO_EXTS.has(extname(filePath).toLowerCase());
}

function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTS.has(extname(filePath).toLowerCase());
}

function isSupportedFile(filePath: string): boolean {
  return isSupportedVideo(filePath) || isSupportedImage(filePath);
}

export class DirectoryScanner {
  private watcher: FSWatcher | null = null;
  private stabiliseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private scanJobRepo: ScanJobRepository,
    private fileRepo: FileRepository,
    private autoUploadQueue: AutoUploadQueue
  ) {}

  async start(): Promise<void> {
    logger.info({ watchDir: WATCH_DIR }, 'Starting directory scanner');

    // Initial scan of existing files
    await this.scanDirectory(WATCH_DIR);

    // Watch for new files
    this.watcher = watch(WATCH_DIR, {
      persistent: true,
      ignoreInitial: true,      // we already did initial scan above
      awaitWriteFinish: false,  // we handle stabilisation ourselves
      depth: 3,                 // watch up to 3 levels deep (dir/subdir/file)
    });

    this.watcher.on('add', (filePath) => this.onFileAdded(filePath));
    this.watcher.on('error', (err) => logger.error({ err }, 'Chokidar watcher error'));

    logger.info({ watchDir: WATCH_DIR }, 'Directory watcher active');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    // Clear all pending stabilise timers
    for (const timer of this.stabiliseTimers.values()) {
      clearTimeout(timer);
    }
    this.stabiliseTimers.clear();
    logger.info('Directory scanner stopped');
  }

  /** Trigger a manual re-scan of the entire watch directory */
  async rescan(): Promise<{ discovered: number }> {
    logger.info('Manual re-scan triggered');
    const discovered = await this.scanDirectory(WATCH_DIR);
    return { discovered };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private onFileAdded(filePath: string): void {
    if (!isSupportedFile(filePath)) return;

    // Debounce — reset timer on every write event
    const existing = this.stabiliseTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.stabiliseTimers.delete(filePath);
      this.processFile(filePath).catch((err) =>
        logger.error({ err, filePath }, 'Failed to process newly added file')
      );
    }, STABILISE_WAIT_MS);

    this.stabiliseTimers.set(filePath, timer);
  }

  /** Walk the entire watch dir and register all discovered media files */
  private async scanDirectory(dir: string): Promise<number> {
    let discovered = 0;
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into sub-directory
          discovered += await this.scanDirectory(fullPath);
        } else if (entry.isFile() && isSupportedFile(fullPath)) {
          const registered = await this.processFile(fullPath);
          if (registered) discovered++;
        }
      }
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to scan directory');
    }
    return discovered;
  }

  /**
   * Register a single file as a scan_job and enqueue it.
   * Returns true if the file was newly registered, false if already tracked.
   */
  private async processFile(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      const filename = basename(filePath);
      const parentDir = dirname(filePath);
      const directoryName = parentDir === WATCH_DIR ? null : basename(parentDir);

      const mimeType =
        (mimeTypeLookup(filename) || undefined) ??
        (isSupportedVideo(filePath) ? 'video/mp4' : 'image/jpeg');

      // Check for duplicates in Files table first
      const exists = await this.fileRepo.existsByNameAndSize(filename, stats.size);
      if (exists) {
        logger.info({ filename, size: stats.size }, 'File already exists in library, skipping auto-upload');
        return false;
      }

      // Upsert returns null if path already tracked (UNIQUE constraint)
      const job = await this.scanJobRepo.upsert({
        sourcePath: filePath,
        filename,
        directoryName: directoryName ?? undefined,
        fileSize: stats.size,
        mimeType,
      });

      if (!job) {
        // Already tracked — only re-enqueue if it was previously failed
        const existing = await this.scanJobRepo.findBySourcePath(filePath);
        if (existing && existing.status === 'failed') {
          await this.scanJobRepo.resetForRetry(existing.id);
          await this.enqueueJob({ ...existing, mimeType: existing.mimeType });
        }
        return false;
      }

      await this.enqueueJob(job);
      return true;
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to process file');
      return false;
    }
  }

  private async enqueueJob(job: {
    id: string;
    sourcePath: string;
    filename: string;
    fileSize: number;
    mimeType: string | null;
    directoryName: string | null;
  }): Promise<void> {
    await this.autoUploadQueue.enqueue({
      scanJobId: job.id,
      sourcePath: job.sourcePath,
      filename: job.filename,
      fileSize: job.fileSize,
      mimeType: job.mimeType ?? 'application/octet-stream',
      directoryName: job.directoryName ?? undefined,
    });
  }
}
