import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

async function run() {
  const res = await pool.query("SELECT id, filename, collection_name, provider_file_id, chunk_size FROM files WHERE id = 'e3ae95d0-4c5a-4777-a53e-e6380a67f241'");
  console.log('--- File Info ---');
  console.log(JSON.stringify(res.rows, null, 2));

  const chunks = await pool.query("SELECT provider_file_id FROM file_chunks WHERE file_id = 'e3ae95d0-4c5a-4777-a53e-e6380a67f241' LIMIT 1");
  console.log('--- Chunk Info ---');
  console.log(JSON.stringify(chunks.rows, null, 2));

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
