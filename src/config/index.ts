// Configuration management
import { config } from 'dotenv';

config();

export interface Config {
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    poolMin: number;
    poolMax: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  encryption: {
    masterKey: string;
    fileMasterKey: string;
  };
  server: {
    port: number;
    env: string;
    apiBaseUrl: string;
    internalSecret: string;
  };
  auth: {
    jwtSecret: string;
    apiKeySalt: string;
  };
  logging: {
    level: string;
    pretty: boolean;
  };
  workers: {
    enabled: boolean;
    tokenRefreshInterval: number;
    healthCheckInterval: number;
    quotaMonitorInterval: number;
  };
  upload: {
    maxFileSize: number;
    chunkSize: number;
    maxParallelChunks: number;
    autoScan: boolean;
    uploadConcurrency: number;
    integrityConcurrency: number;
    priorityConcurrency: number;
    maxParallelDownloads: number;
    prefetchCount: number;
  };
  rateLimit: {
    window: number;
    maxRequests: number;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  if (value === undefined || value === '') return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

export const appConfig: Config = {
  database: {
    host: getEnvVar('DATABASE_HOST', 'localhost'),
    port: getEnvNumber('DATABASE_PORT', 5432),
    name: getEnvVar('DATABASE_NAME', 'streamfun'),
    user: getEnvVar('DATABASE_USER', 'postgres'),
    password: getEnvVar('DATABASE_PASSWORD'),
    poolMin: getEnvNumber('DATABASE_POOL_MIN', 2),
    poolMax: getEnvNumber('DATABASE_POOL_MAX', 10),
  },
  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: getEnvNumber('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD,
    db: getEnvNumber('REDIS_DB', 0),
  },
  encryption: {
    masterKey: getEnvVar('MASTER_ENCRYPTION_KEY'),
    fileMasterKey: getEnvVar('FILE_ENCRYPTION_MASTER_KEY'),
  },
  server: {
    port: getEnvNumber('PORT', 3000),
    env: getEnvVar('NODE_ENV', 'development'),
    apiBaseUrl: getEnvVar('API_BASE_URL', 'http://localhost:3000'),
    internalSecret: getEnvVar('INTERNAL_SECRET', 'dev-secret-do-not-use-in-prod'),
  },
  auth: {
    jwtSecret: getEnvVar('JWT_SECRET'),
    apiKeySalt: getEnvVar('API_KEY_SALT'),
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', 'info'),
    pretty: getEnvBoolean('LOG_PRETTY', true),
  },
  workers: {
    enabled: getEnvBoolean('ENABLE_WORKERS', true),
    tokenRefreshInterval: getEnvNumber('TOKEN_REFRESH_INTERVAL', 15),
    healthCheckInterval: getEnvNumber('HEALTH_CHECK_INTERVAL', 10),
    quotaMonitorInterval: getEnvNumber('QUOTA_MONITOR_INTERVAL', 30),
  },
  upload: {
    maxFileSize: getEnvNumber('MAX_FILE_SIZE', 10737418240), // 10 GB
    chunkSize: getEnvNumber('CHUNK_SIZE', 10485760), // 10 MB
    maxParallelChunks: getEnvNumber('MAX_PARALLEL_CHUNKS', 3),
    autoScan: getEnvBoolean('ENABLE_AUTO_SCAN', true),
    uploadConcurrency: getEnvNumber('UPLOAD_CONCURRENCY', 2),
    integrityConcurrency: getEnvNumber('INTEGRITY_CONCURRENCY', 5),
    priorityConcurrency: getEnvNumber('PRIORITY_CONCURRENCY', 2),
    maxParallelDownloads: getEnvNumber('MAX_PARALLEL_DOWNLOADS', 8),
    prefetchCount: getEnvNumber('PREFETCH_COUNT', 3),
  },
  rateLimit: {
    window: getEnvNumber('RATE_LIMIT_WINDOW', 60),
    maxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },
};
