// Direct connection to PostgreSQL as app_server, for sign-in only. Everything else goes through
// PostgREST so the row level security rules apply. Server code only: never import from a page.
import { Pool } from "pg";

const globalForPool = globalThis as unknown as { appServerPool?: Pool };

export const pool =
  globalForPool.appServerPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

// Keep one pool across hot reloads in development.
if (process.env.NODE_ENV !== "production") globalForPool.appServerPool = pool;
