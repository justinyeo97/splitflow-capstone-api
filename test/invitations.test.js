import test from "node:test";
import assert from "node:assert/strict";
process.env.CONSULTANT_INVITATIONS_ENABLED = "true";
const { restrictConsultant, consultantClient } =
  await import("../src/services/invitations.js");
const { api } = await import("../src/routes/api.js");
const { consultantSchema } = await import("../src/schemas/consultant.js");
const route = (path, method) =>
  api.stack
    .find((l) => l.route?.path === path && l.route.methods[method])
    .route.stack.at(-1).handle;

test("consultant API access is read-only and limited to expenses and own lookup data", () => {
  for (const path of [
    "/expenses",
    "/expenses/12345678-1234-4234-8234-123456789abc",
    "/countries",
    "/consultants",
    "/auth/profile",
  ]) {
    let error;
    restrictConsultant(
      { user: { role: "consultant" }, method: "GET", path },
      null,
      (e) => {
        error = e;
      },
    );
    assert.equal(error, undefined);
  }
  for (const [method, path] of [
    ["POST", "/expenses"],
    ["PATCH", "/expenses/123"],
    ["GET", "/reports/roi"],
    ["GET", "/placements"],
    ["GET", "/consultants/123/country-history"],
    ["POST", "/imports/expenses"],
    ["GET", "/conversions/exceptions"],
  ]) {
    let error;
    restrictConsultant(
      { user: { role: "consultant" }, method, path },
      null,
      (e) => {
        error = e;
      },
    );
    assert.equal(error.status, 403);
  }
});
test("users without company membership can only access onboarding", () => {
  let error;
  restrictConsultant(
    { user: { role: "unassigned" }, method: "GET", path: "/expenses" },
    null,
    (e) => {
      error = e;
    },
  );
  assert.equal(error.status, 403);
  restrictConsultant(
    {
      user: { role: "unassigned" },
      method: "POST",
      path: "/auth/join-company",
    },
    null,
    (e) => {
      assert.equal(e, undefined);
    },
  );
});
test("consultant query scope cannot be replaced by a supplied consultant filter", () => {
  const filters = [];
  const db = consultantClient(
    {
      from() {
        return {
          select() {
            return this;
          },
          eq(k, v) {
            filters.push([k, v]);
            return this;
          },
        };
      },
    },
    "own-consultant",
  );
  db.from("expenses").select("*").eq("consultant_id", "other-consultant");
  assert.deepEqual(filters, [
    ["consultant_id", "own-consultant"],
    ["consultant_id", "other-consultant"],
  ]);
});
test("company choices are obtained without accepting an arbitrary email parameter", async () => {
  let called;
  await route("/auth/companies", "get")(
    {
      db: {
        async rpc(name) {
          called = name;
          return { data: [{ company_id: "invited" }], error: null };
        },
      },
    },
    {
      json(value) {
        assert.equal(value.data[0].company_id, "invited");
      },
    },
  );
  assert.equal(called, "available_companies");
});
test("joining accepts only a company ID and delegates verified email checks to the database", async () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  let called;
  const db = {
    async rpc(name, args) {
      called = { name, args };
      return { error: null };
    },
  };
  await route("/auth/join-company", "post")(
    { body: { company_id: id }, db },
    {
      json(value) {
        assert.equal(value.data.joined, true);
      },
    },
  );
  assert.deepEqual(called, {
    name: "join_invited_company",
    args: { target_company: id },
  });
  await assert.rejects(
    () =>
      route("/auth/join-company", "post")(
        {
          body: {
            company_id: id,
            email: "someone-else@example.com",
            role: "administrator",
          },
          db,
        },
        {},
      ),
    (e) => e.code === "VALIDATION_ERROR",
  );
});
test("finance users cannot issue invitations through consultant create or update", async () => {
  const body = {
    name: "Test",
    country_id: "12345678-1234-4234-8234-123456789abc",
    job_title: "Consultant",
    annual_salary: "1000",
    salary_currency: "USD",
    salary_effective_from: "2026-01-01",
    email: "test1@mail",
  };
  for (const method of ["post", "patch"])
    await assert.rejects(
      () =>
        route(method === "post" ? "/consultants" : "/consultants/:id", method)(
          { body, params: { id: body.country_id }, user: { role: "finance" } },
          {},
        ),
      (e) => e.status === 403,
    );
  assert.equal(
    consultantSchema.parse({ ...body, email: " Test1@Mail " }).email,
    "test1@mail",
  );
});
