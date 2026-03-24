// Storage path utilities for category-based file organization

/**
 * Sanitize folder name by removing special characters and file extensions
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')  // Remove file extension
    .replace(/[^a-zA-Z0-9_-]/g, '_')  // Replace special chars with underscore
    .replace(/_+/g, '_')  // Collapse multiple consecutive underscores
    .replace(/^_|_$/g, '');  // Remove leading/trailing underscores
}

/**
 * Detect file category from MIME type
 */
export function detectCategory(mimeType?: string): 'videos' | 'images' {
  if (!mimeType) {
    return 'videos'; // Default to videos if no MIME type
  }
  if (mimeType.startsWith('video/')) {
    return 'videos';
  }
  if (mimeType.startsWith('image/')) {
    return 'images';
  }
  // Default to videos for unknown types
  return 'videos';
}

/**
 * Generate default collection name based on current date
 */
export function generateDefaultCollectionName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `collection_${year}_${month}_${day}`;
}

/**
 * Generate storage path based on category
 * 
 * For videos: videos/{sanitized_filename}/chunk_{index}
 * For images: images/{collection_name}/{filename}
 */
export function generateStoragePath(options: {
  category?: 'videos' | 'images';
  collectionName?: string;
  filename: string;
  chunkIndex?: number;
  remoteName?: string;
  providerType?: string;
}): string {
  const { category = 'videos', collectionName, filename, chunkIndex, remoteName, providerType } = options;
  
  // Handle Blomp bucket name requirement
  let basePath = '';
  if (providerType === 'blomp' && remoteName) {
    // For Blomp, bucket name should be in remoteName
    basePath = '';  // Don't add extra prefix, provider handles it
  }
  
  if (category === 'videos') {
    const sanitizedCollection = collectionName ? sanitizeFolderName(collectionName) : null;
    const sanitizedFile = sanitizeFolderName(filename);
    
    // If categorical: videos/{collection}/{filename}/chunk_{index}
    // If standalone: videos/{filename}/chunk_{index}
    const folderPath = sanitizedCollection 
      ? `${sanitizedCollection}/${sanitizedFile}`
      : sanitizedFile;

    if (chunkIndex !== undefined) {
      return `${basePath}videos/${folderPath}/chunk_${chunkIndex}`;
    }
    return `${basePath}videos/${folderPath}`;
  } else {
    // Images
    const collection = collectionName || generateDefaultCollectionName();
    const sanitizedCollection = sanitizeFolderName(collection);
    
    // If it's part of a chunked upload, we must use a subdirectory to prevent overwrites
    if (chunkIndex !== undefined) {
      const sanitizedFile = sanitizeFolderName(filename);
      return `${basePath}images/${sanitizedCollection}/${sanitizedFile}/chunk_${chunkIndex}`;
    }
    
    return `${basePath}images/${sanitizedCollection}/${filename}`;
  }
}

/**
 * Get base path for a provider (handles special cases like Blomp)
 */
export function getProviderBasePath(
  providerType: string,
  remoteName: string,
  bucketName?: string
): string {
  if (providerType === 'blomp' && bucketName) {
    return `${remoteName}:${bucketName}`;
  }
  return `${remoteName}:`;
}
