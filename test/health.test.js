import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "";
process.env.SUPABASE_PUBLISHABLE_KEY = "";
const { default: app } = await import("../src/app.js");

test("health is public and reports process health", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("readiness fails closed without configured Supabase", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/ready`);
  assert.equal(response.status, 503);
});

test("resource routes require a bearer token", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/countries`);
  assert.equal(response.status, 401);
});
