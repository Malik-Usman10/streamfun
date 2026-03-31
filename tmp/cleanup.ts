import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the project root .env file
dotenv.config({ path: path.join(process.cwd(), '.env') });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

async function runCleanup() {
  const client = await pool.connect();
  try {
    console.log('Starting cleanup of failed uploads...');

    // 1. Find jobs with explicit error messages
    const failedQuery = `
      SELECT id, file_id, error_message, filename
      FROM scan_jobs
      WHERE error_message ILIKE '%Too Large Object%'
         OR error_message ILIKE '%scan_jobs_file_id_fkey%'
         OR error_message ILIKE '%violates foreign key constraint%'
    `;
    const failedResult = await client.query(failedQuery);
    console.log(`Found ${failedResult.rows.length} jobs with known explicit errors.`);

    // 2. We should also look for anything currently marked "completed" but where the chunks don't match the file size,
    // or maybe they don't even have an error message because it crashed mid-way but status was set?
    // Actually, the user says "I am seeing these in completed section" but they *do* have the error displayed in the UI, 
    // which implies error_message IS NOT NULL, but status = 'completed'.
    // Or maybe just status = 'failed'? The user says "still seeing these in completed section".
    
    // So let's delete files and scan_jobs for all found jobs.
    let count = 0;
    for (const row of failedResult.rows) {
      console.log(`Processing Job ID: ${row.id} | File ID: ${row.file_id || 'NULL'} | File: ${row.filename}`);
      
      await client.query('BEGIN');
      
      // Delete the file if it exists (this cascades to file_chunks)
      if (row.file_id) {
        // Delete all chunks first to free space context immediately (though CASCADE does this, doing it explicitly is fine)
        await client.query('DELETE FROM file_chunks WHERE file_id = $1', [row.file_id]);
        
        // Delete the file record
        await client.query('DELETE FROM files WHERE id = $1', [row.file_id]);
        console.log(`  -> Deleted file_id ${row.file_id} and its associated chunks from DB`);
      }

      // Delete the scan_job
      await client.query('DELETE FROM scan_jobs WHERE id = $1', [row.id]);
      console.log(`  -> Deleted scan_job ${row.id}`);

      await client.query('COMMIT');
      count++;
    }

    console.log(`Successfully cleaned up ${count} jobs from the database.`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('An error occurred during cleanup:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runCleanup();
