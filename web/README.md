# Star Printer Hub — Web

Next.js application: admin UI + CloudPRNT endpoints + Zoho webhook receiver

## Quick Start (Day 1)

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Fill in ADMIN_PASSWORD freely. For ADMIN_COOKIE_SECRET / ZOHO_API_KEY / CRON_SECRET:
#   openssl rand -hex 32

# 3. (Once) Provision Vercel project + Postgres
vercel link
vercel env pull           # writes POSTGRES_URL etc. into .env.local

# 4. Push schema to Postgres
pnpm db:push

# 5. Run dev server
pnpm dev
```

เปิด http://localhost:3000 — จะ redirect ไป `/login` กรอก `ADMIN_PASSWORD` แล้วเข้า dashboard ได้

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm db:generate` | Generate SQL migration from schema diff |
| `pnpm db:push` | Push schema to DB (dev — skips migration files) |
| `pnpm db:studio` | Open Drizzle Studio (web UI for DB) |

## Project layout (so far)

```
web/
├── app/
│   ├── (admin)/
│   │   ├── layout.tsx          # auth-gated shell
│   │   └── page.tsx            # dashboard (placeholder)
│   ├── login/
│   │   ├── actions.ts          # login + logout server actions
│   │   └── page.tsx            # login form
│   ├── globals.css
│   └── layout.tsx              # root layout
├── lib/
│   └── db/
│       ├── index.ts            # drizzle client
│       └── schema.ts           # printers + print_jobs tables
├── middleware.ts               # admin cookie gate
├── drizzle.config.ts
└── …
```

API routes (`/api/zoho/orders`, `/api/cloudprnt`, `/api/cron/expire-stuck`) จะมาใน Day 2

Admin UI (jobs list, job detail, printer status) จะมาใน Day 3

E2E test กับ printer + Zoho จริง + production deploy จะมาใน Day 4
