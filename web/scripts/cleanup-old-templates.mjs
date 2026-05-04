// Run with: node --env-file=.env.local scripts/cleanup-old-templates.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.STARPRINTER_DB_URL);

const deleted = await sql`
  DELETE FROM print_jobs
  WHERE template IN ('order', 'text')
  RETURNING id, source_job_id, template
`;
console.log(`Deleted ${deleted.length} old jobs`);

await sql`ALTER TABLE print_jobs ALTER COLUMN template SET DEFAULT 'markup'`;
console.log('Default template now: markup');

const remaining = await sql`SELECT COUNT(*) AS n, template FROM print_jobs GROUP BY template`;
console.log('Remaining jobs by template:', remaining);
