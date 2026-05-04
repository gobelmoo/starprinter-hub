import { config } from 'dotenv';
import type { Config } from 'drizzle-kit';

config({ path: '.env.local' });

const url =
  process.env.STARPRINTER_DB_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL;

if (!url) {
  throw new Error(
    'POSTGRES_URL not found. Provision Postgres on Vercel (Storage tab) and run `vercel env pull`, or set POSTGRES_URL in .env.local manually.',
  );
}

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config;
