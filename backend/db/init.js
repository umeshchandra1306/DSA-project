/** Applies schema.sql to the database in DATABASE_URL:  npm run db:init */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL, e.g. postgres://user:pass@localhost:5432/traffic');
  process.exit(1);
}
const sql = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log('Schema applied.');
} finally {
  await pool.end();
}
