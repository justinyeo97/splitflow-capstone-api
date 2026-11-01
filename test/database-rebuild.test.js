import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

function sqlFile(path) {
  return readFileSync(path, "utf8")
    .replace(/^\\set .*$/gm, "")
    .replace(/^\\ir\s+(.+)$/gm, (_, relative) =>
      sqlFile(resolve(dirname(path), relative.trim())),
    );
}
const root = fileURLToPath(new URL("../", import.meta.url));
test(
  "empty database rebuild and authenticated onboarding checks",
  { timeout: 60000 },
  async () => {
    const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
    try {
      await db.exec(sqlFile(resolve(root, "database/test-bootstrap.sql")));
      await db.exec(sqlFile(resolve(root, "database/rebuild.sql")));
      for (const name of [
        "expenses",
        "placements",
        "expense_conversions",
        "companies",
        "audit_logs",
      ]) {
        assert.equal(
          (
            await db.query("select to_regclass($1) as table_name", [
              `public.${name}`,
            ])
          ).rows[0].table_name,
          name,
        );
      }
      await db.exec(sqlFile(resolve(root, "database/test-schema.sql")));
      await db.exec(sqlFile(resolve(root, "database/test-operations.sql")));
      await assert.rejects(
        () => db.exec(sqlFile(resolve(root, "database/rebuild.sql"))),
        /not empty/,
      );
      await db.exec("ROLLBACK");
    } finally {
      await db.close();
    }
  },
);
