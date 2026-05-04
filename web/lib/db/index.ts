import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

// Custom env name to avoid clash with Vercel marketplace storage integrations
// that auto-inject `POSTGRES_URL` at runtime.
const url = process.env.STARPRINTER_DB_URL ?? process.env.POSTGRES_URL;
if (!url) {
  throw new Error('STARPRINTER_DB_URL (or POSTGRES_URL) not set');
}

const sql = neon(url);
export const db = drizzle(sql, { schema });
