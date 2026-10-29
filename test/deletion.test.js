import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/routes/api.js";
import { companyClient } from "../src/services/company.js";

const id = "12345678-1234-4234-8234-123456789abc";
for (const table of ["expenses", "placements"]) {
  const route = api.stack.find(
    (layer) =>
      layer.route?.path === `/${table}/:id` && layer.route.methods.delete,
  ).route;
  const handler = route.stack.at(-1).handle;
  test(`${table}: delete returns 204 and filters the requested record`, async () => {
    const calls = [];
    const db = {
      from(name) {
        assert.equal(name, table);
        return {
          delete() {
            return this;
          },
          eq(key, value) {
            calls.push([key, value]);
            return this;
          },
          select() {
            return this;
          },
          async maybeSingle() {
            return { data: { id }, error: null };
          },
        };
      },
    };
    await handler(
      { params: { id }, db: companyClient(db, "own-company") },
      {
        status(code) {
          assert.equal(code, 204);
          return this;
        },
        end() {},
      },
    );
    assert.deepEqual(calls, [
      ["company_id", "own-company"],
      ["id", id],
    ]);
  });
  test(`${table}: invalid IDs never reach the database`, async () => {
    await assert.rejects(
      () => handler({ params: { id: "bad" } }, {}),
      (error) => error.status === 400,
    );
  });
  test(`${table}: missing or inaccessible records return 404`, async () => {
    const query = {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      select() {
        return this;
      },
      async maybeSingle() {
        return { data: null, error: null };
      },
    };
    await assert.rejects(
      () => handler({ params: { id }, db: { from: () => query } }, {}),
      (error) => error.status === 404,
    );
  });
  test(`${table}: database failures are not reported as success`, async () => {
    const query = {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      select() {
        return this;
      },
      async maybeSingle() {
        return { data: null, error: { code: "42501", message: "Denied" } };
      },
    };
    await assert.rejects(
      () => handler({ params: { id }, db: { from: () => query } }, {}),
      (error) => error.status === 403,
    );
  });
  test(`${table}: only administrators and finance may delete`, () => {
    for (const role of ["administrator", "finance", "consultant", "viewer"]) {
      let result;
      route.stack[0].handle({ user: { role } }, {}, (error) => {
        result = error;
      });
      assert.equal(
        result?.status,
        ["administrator", "finance"].includes(role) ? undefined : 403,
      );
    }
  });
}
