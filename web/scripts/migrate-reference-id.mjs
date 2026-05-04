// One-shot migration: source_job_id → reference_id, drop unique + NOT NULL,
// drop template column.
// Run with: node --env-file=.env.local scripts/migrate-reference-id.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.STARPRINTER_DB_URL);

async function exec(label, query) {
  try {
    await query();
    console.log(`✓ ${label}`);
  } catch (err) {
    console.log(`• ${label}: skipped (${err.message.split('\n')[0]})`);
  }
}

await exec('Drop unique on source_job_id', () =>
  sql`ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_source_job_id_unique`,
);
await exec('Rename source_job_id → reference_id', () =>
  sql`ALTER TABLE print_jobs RENAME COLUMN source_job_id TO reference_id`,
);
await exec('Allow NULL on reference_id', () =>
  sql`ALTER TABLE print_jobs ALTER COLUMN reference_id DROP NOT NULL`,
);
await exec('Drop template column', () =>
  sql`ALTER TABLE print_jobs DROP COLUMN IF EXISTS template`,
);

console.log('\nFinal columns on print_jobs:');
const cols = await sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'print_jobs'
  ORDER BY ordinal_position
`;
console.table(cols);
