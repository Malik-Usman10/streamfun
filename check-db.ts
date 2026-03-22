import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  const result = await pool.query(`SELECT file_id, file_name, size, chunks FROM chunked_files WHERE file_id = 'f999a100-7742-486b-a294-b59c784c1857'`);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}
run();
