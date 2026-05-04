import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const printers = pgTable('printers', {
  id: uuid('id').defaultRandom().primaryKey(),
  macAddress: text('mac_address').notNull().unique(),
  name: text('name').notNull(),
  branchCode: text('branch_code'),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at'),
  lastStatusCode: text('last_status_code'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const printJobs = pgTable(
  'print_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    printerId: uuid('printer_id')
      .notNull()
      .references(() => printers.id),
    referenceId: text('reference_id'),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    printedAt: timestamp('printed_at'),
  },
  (table) => [
    index('print_jobs_printer_status_created_idx').on(
      table.printerId,
      table.status,
      table.createdAt,
    ),
  ],
);

export type Printer = typeof printers.$inferSelect;
export type NewPrinter = typeof printers.$inferInsert;
export type PrintJob = typeof printJobs.$inferSelect;
export type NewPrintJob = typeof printJobs.$inferInsert;
