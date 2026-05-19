// PostgreSQL connection pool
import pg from 'pg';
import { appConfig } from '../config/index.js';
import logger from '../shared/utils/logger.js';

// Force pg to return BIGINT (OID 20) as JavaScript Number instead of string.
// JS Number is safe up to 2^53 (~9 PB), which is fine for file sizes.
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

const { Pool } = pg;

export const pool = new Pool({
  host: appConfig.database.host,
  port: appConfig.database.port,
  database: appConfig.database.name,
  user: appConfig.database.user,
  password: appConfig.database.password,
  min: appConfig.database.poolMin,
  max: appConfig.database.poolMax,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

pool.on('connect', () => {
  logger.info('Database connection established');
});

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection test failed');
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await pool.end();
  logger.info('Database connection pool closed');
}
