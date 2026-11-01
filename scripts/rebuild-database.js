import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// libpq reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD and PGSSLMODE.
// No connection password is placed on the command line or printed.
const result = spawnSync(
  "psql",
  [
    "--no-psqlrc",
    "--no-password",
    "--set",
    "ON_ERROR_STOP=1",
    "--file",
    fileURLToPath(new URL("../database/rebuild.sql", import.meta.url)),
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error)
  console.error(
    "Database setup requires PostgreSQL psql on PATH and configured PG* connection variables.",
  );
process.exitCode = result.error ? 1 : (result.status ?? 1);
