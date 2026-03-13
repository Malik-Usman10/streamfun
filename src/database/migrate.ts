// Database migration runner
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { pool } from './connection.js';
import logger from '../utils/logger.js';

interface Migration {
  id: number;
  name: string;
  filename: string;
  sql: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM migrations ORDER BY id'
  );
  return result.rows.map((row) => row.name);
}

async function loadMigrations(): Promise<Migration[]> {
  const migrationsDir = join(process.cwd(), 'migrations');
  const files = await readdir(migrationsDir);
  
  const migrations: Migration[] = [];
  
  for (const file of files) {
    if (file.endsWith('.sql')) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      
      if (match) {
        migrations.push({
          id: parseInt(match[1], 10),
          name: match[2],
          filename: file,
          sql: await readFile(join(migrationsDir, file), 'utf-8'),
        });
      }
    }
  }
  
  // Sort migrations numerically by ID
  return migrations.sort((a, b) => a.id - b.id);
}

async function runMigration(migration: Migration): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info(`Running migration: ${migration.filename}`);
    await client.query(migration.sql);
    
    await client.query(
      'INSERT INTO migrations (name) VALUES ($1)',
      [migration.name]
    );
    
    await client.query('COMMIT');
    logger.info(`Migration completed: ${migration.filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error, migration: migration.filename }, 'Migration failed');
    throw error;
  } finally {
    client.release();
  }
}

async function migrateUp(): Promise<void> {
  await ensureMigrationsTable();
  
  const executed = await getExecutedMigrations();
  const migrations = await loadMigrations();
  
  const pending = migrations.filter((m) => !executed.includes(m.name));
  
  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }
  
  logger.info(`Running ${pending.length} pending migrations`);
  
  for (const migration of pending) {
    await runMigration(migration);
  }
  
  logger.info('All migrations completed successfully');
}

async function migrateDown(): Promise<void> {
  logger.warn('Migration rollback not implemented yet');
}

async function createMigration(name: string): Promise<void> {
  const timestamp = Date.now();
  const filename = `${timestamp}_${name}.sql`;
  const filepath = join(process.cwd(), 'migrations', filename);
  
  await writeFile(filepath, '-- Add your migration SQL here\n');
  logger.info(`Created migration: ${filename}`);
}

// CLI handler
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'up':
    await migrateUp();
    process.exit(0);
    break;
  case 'down':
    await migrateDown();
    process.exit(0);
    break;
  case 'create':
    if (!arg) {
      logger.error('Migration name required: bun run migrate:create <name>');
      process.exit(1);
    }
    await createMigration(arg);
    process.exit(0);
    break;
  default:
    logger.error('Unknown command. Use: up, down, or create <name>');
    process.exit(1);
}
