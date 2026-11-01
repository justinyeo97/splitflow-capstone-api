import test from "node:test";
import assert from "node:assert/strict";
process.env.COMPANY_REPORTING_ENABLED = "true";
process.env.CONSULTANT_INVITATIONS_ENABLED = "true";
const { api } = await import("../src/routes/api.js");
const route = (path, method = "get") =>
  api.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  ).route;
const handler = (path, method) => route(path, method).stack.at(-1).handle;

test("company creation accepts name/currency only and does not accept another owner", async () => {
  const calls = [];
  const req = {
    user: { role: "unassigned" },
    body: { name: " Mentor company ", home_currency: "MYR" },
    db: {
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: "company-id" };
      },
    },
  };
  await handler("/auth/create-company", "post")(req, {
    status(code) {
      assert.equal(code, 201);
      return this;
    },
    json(value) {
      assert.equal(value.data.company_id, "company-id");
    },
  });
  assert.deepEqual(calls, [
    [
      "create_own_company",
      { company_name: "Mentor company", home_currency: "MYR" },
    ],
  ]);
  await assert.rejects(
    () =>
      handler("/auth/create-company", "post")(
        {
          ...req,
          body: { ...req.body, user_id: "other", role: "administrator" },
        },
        {},
      ),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () =>
      handler("/auth/create-company", "post")(
        { ...req, user: { role: "administrator" } },
        {},
      ),
    (error) => error.status === 403,
  );
});

test("unassigned users can create a company but consultants cannot", async () => {
  const { restrictConsultant } = await import("../src/services/invitations.js");
  for (const role of ["unassigned", "consultant"]) {
    let error;
    restrictConsultant(
      { user: { role }, path: "/auth/create-company", method: "POST" },
      {},
      (value) => {
        error = value;
      },
    );
    assert.equal(error?.status, role === "unassigned" ? undefined : 403);
  }
});

test("audit log requires finance/admin and applies database pagination", async () => {
  for (const role of ["administrator", "finance", "viewer", "consultant"]) {
    let error;
    route("/audit-log").stack[0].handle({ user: { role } }, {}, (value) => {
      error = value;
    });
    assert.equal(
      error?.status,
      ["administrator", "finance"].includes(role) ? undefined : 403,
    );
  }
  let range;
  const query = {
    select() {
      return this;
    },
    order() {
      return this;
    },
    range(from, to) {
      range = [from, to];
      return Promise.resolve({ data: [], count: 75 });
    },
  };
  await handler("/audit-log")(
    { query: { limit: "25", offset: "50" }, db: { from: () => query } },
    {
      json(value) {
        assert.equal(value.pagination.total, 75);
      },
    },
  );
  assert.deepEqual(range, [50, 74]);
});

test("reconciliation reads beyond one database page for complete exports", async () => {
  let offset = 0;
  const ranges = [];
  const query = {
    select() {
      return this;
    },
    order() {
      return this;
    },
    range(start) {
      offset = start;
      ranges.push(start);
      return this;
    },
    then(resolve) {
      resolve({
        data:
          offset === 0
            ? Array.from({ length: 500 }, () => ({ status: "finalized" }))
            : [{ status: "pending" }],
      });
    },
  };
  await handler("/reports/reconciliation")(
    { db: { from: () => query } },
    {
      json(value) {
        assert.equal(value.data.length, 501);
        assert.equal(value.summary.conversion_count, 501);
        assert.equal(value.summary.exception_count, 1);
      },
    },
  );
  assert.deepEqual(ranges, [0, 500]);
});
