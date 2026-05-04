// Verify schema + seed a test printer.
// Run with: node --env-file=.env.local scripts/verify-and-seed.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL);

console.log('Tables in public schema:');
const tables = await sql`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema='public'
  ORDER BY table_name
`;
for (const t of tables) console.log('  -', t.table_name);

console.log('\nSeeding test printer (00:11:62:00:00:01 / BKK01)...');
const seeded = await sql`
  INSERT INTO printers (mac_address, name, branch_code)
  VALUES ('00:11:62:00:00:01', 'Test Printer', 'BKK01')
  ON CONFLICT (mac_address) DO NOTHING
  RETURNING id, name, branch_code, mac_address
`;
if (seeded.length) {
  console.log('  ✓ inserted:', seeded[0]);
} else {
  const existing = await sql`SELECT id, name, branch_code FROM printers WHERE mac_address='00:11:62:00:00:01'`;
  console.log('  • already exists:', existing[0]);
}

console.log('\nAll printers:');
const all = await sql`SELECT mac_address, name, branch_code, is_active FROM printers ORDER BY name`;
for (const p of all) console.log('  -', p.mac_address, p.name, '/', p.branch_code, p.is_active ? '' : '(inactive)');
