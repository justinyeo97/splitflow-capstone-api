import {
  invitationsEnabled,
  restrictConsultant,
} from "../services/invitations.js";
import { companyReportingEnabled } from "../services/company.js";
import { salaryExpenses } from "../services/salary.js";
import {
  autoConvertExpense,
  conversionContext,
} from "../services/automatic-conversion.js";
import { consultantSchema } from "../schemas/consultant.js";
import {
  authCredentials,
  signupSchema,
  companyProfileSchema,
} from "../schemas/auth.js";
import { calculateRoi } from "../services/roi.js";
import { placementSchema } from "../schemas/placement.js";
import { consolidateExpenses } from "../services/consolidated.js";
import { Router } from "express";
import { z } from "zod";
import { authClient } from "../lib/supabase.js";
import { allowedOrigins } from "../config/env.js";
import { authenticate, allowRoles } from "../middleware/auth.js";
import { validate, currency, date, uuid } from "../utils/validation.js";
import { getHistoricalRate } from "../services/fx.js";
import { multiplyAndRound } from "../utils/money.js";

export const api = Router();
const readRoles = ["administrator", "finance", "viewer", "consultant"],
  writeRoles = ["administrator", "finance"];

function requireAuthConfig() {
  if (!authClient) {
    const e = new Error("Authentication is not configured");
    e.status = 503;
    throw e;
  }
}
api.post("/auth/signup", async (req, res) => {
  requireAuthConfig();
  const { company_name, ...credentials } = validate(
    invitationsEnabled
      ? signupSchema.partial({ company_name: true })
      : signupSchema,
    req.body,
  );
  const { data, error } = await authClient.auth.signUp(
    invitationsEnabled
      ? credentials
      : { ...credentials, options: { data: { company_name } } },
  );
  fail(error);
  res
    .status(201)
    .json({
      data: {
        user: data.user,
        session: data.session,
        confirmation_required: !data.session,
      },
    });
});
api.post("/auth/login", async (req, res) => {
  requireAuthConfig();
  const body = validate(
    invitationsEnabled
      ? authCredentials.extend({
          email: z
            .string()
            .trim()
            .max(254)
            .regex(/^[^\s@]+@[^\s@]+$/),
        })
      : authCredentials,
    req.body,
  );
  const { data, error } = await authClient.auth.signInWithPassword(body);
  if (error) {
    const e = new Error("Email or password is incorrect");
    e.status = 401;
    throw e;
  }
  res.json({ data: { user: data.user, session: data.session } });
});
api.get("/auth/google", async (req, res) => {
  requireAuthConfig();
  const redirectTo =
    typeof req.query.redirect_to === "string"
      ? req.query.redirect_to
      : allowedOrigins[0];
  let redirectOrigin;
  try {
    redirectOrigin = new URL(redirectTo).origin;
  } catch {
    redirectOrigin = null;
  }
  if (!redirectOrigin || !allowedOrigins.includes(redirectOrigin)) {
    return res
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "redirect_to must use an allowed application origin",
        },
      });
  }
  const { data, error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) {
    const e = new Error(
      "Google sign-in is not enabled for this Supabase project",
    );
    e.status = 503;
    throw e;
  }
  res.json({ data: { url: data.url } });
});
// Tell the app whether company invitations are turned on. This can be checked before signing in.
api.get("/auth/config", (_req, res) =>
  res.json({ data: { invitations_enabled: invitationsEnabled } }),
);
// For the requests below, check who is signed in and what they are allowed to access.
api.use(authenticate);
api.use(restrictConsultant);
// Ask the database which companies invited this person using their verified email.
api.get("/auth/companies", async (req, res) => {
  if (!invitationsEnabled) {
    const e = new Error("Invitations are not activated");
    e.status = 409;
    throw e;
  }
  const { data, error } = await req.db.rpc("available_companies");
  fail(error);
  res.json({ data });
});
// Check their company choice. The database only lets them join if they have an invitation.
api.post("/auth/join-company", async (req, res) => {
  if (!invitationsEnabled) {
    const e = new Error("Invitations are not activated");
    e.status = 409;
    throw e;
  }
  const body = validate(z.object({ company_id: uuid }).strict(), req.body);
  const { error } = await req.db.rpc("join_invited_company", {
    target_company: body.company_id,
  });
  fail(error);
  res.json({ data: { joined: true } });
});
api.get("/auth/profile", async (req, res) => {
  const { data, error } = await req.db
    .from("profiles")
    .select(
      companyReportingEnabled
        ? "id,email,role,company_name,company_id"
        : "id,email,role,company_name",
    )
    .eq("id", req.user.id)
    .single();
  fail(error);
  res.json({
    data: {
      ...data,
      ...(invitationsEnabled
        ? {
            role: req.user.role,
            consultant_id: req.user.consultant_id || null,
            consultant: req.consultant || null,
            invitations_enabled: true,
          }
        : {}),
      ...(req.company ? { role: req.user.role, company: req.company } : {}),
    },
  });
});
api.patch("/auth/profile", async (req, res) => {
  const body = validate(companyProfileSchema, req.body);
  if (companyReportingEnabled) {
    if (req.user.role !== "administrator") {
      const e = new Error("Only company administrators can rename the company");
      e.status = 403;
      throw e;
    }
    const { data: company, error: ce } = await req.db
      .from("companies")
      .update({ name: body.company_name })
      .eq("id", req.user.company_id)
      .select("id,name,home_currency,reporting_timezone")
      .single();
    fail(ce);
    req.company = company;
  }
  const { data, error } = await req.db
    .from("profiles")
    .update(body)
    .eq("id", req.user.id)
    .select("id,email,role,company_name")
    .single();
  fail(error);
  res.json({
    data: {
      ...data,
      ...(req.company ? { role: req.user.role, company: req.company } : {}),
    },
  });
});
api.patch("/company", allowRoles("administrator"), async (req, res) => {
  if (!companyReportingEnabled) {
    const e = new Error("Company reporting migration has not been activated");
    e.status = 409;
    throw e;
  }
  const body = validate(
    z
      .object({
        name: z.string().trim().min(1).max(200),
        home_currency: currency,
      })
      .strict(),
    req.body,
  );
  const { data, error } = await req.db
    .from("companies")
    .update(body)
    .eq("id", req.user.company_id)
    .select("id,name,home_currency,reporting_timezone")
    .single();
  fail(error);
  res.json({ data });
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const schemas = {
  country: z.object({
    name: z.string().min(1).max(120),
    iso_code: z.string().length(2).toUpperCase(),
    default_reporting_currency: currency,
  }),
  consultant: consultantSchema,
  expense: z.object({
    is_payroll: z.boolean().optional(),
    consultant_id: uuid,
    transaction_date: date,
    original_amount: z.string().regex(/^\d{1,14}(\.\d{1,8})?$/),
    original_currency: currency,
    category: z.string().min(1).max(100),
    vendor: z.string().max(200).optional(),
    source_identifier: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
  }),
};
function fail(error) {
  if (error) {
    const e = new Error(error.message);
    e.status =
      error.code === "23505"
        ? 409
        : error.code === "23503"
          ? 400
          : error.code === "42501"
            ? 403
            : error.code === "PGRST116"
              ? 404
              : 500;
    throw e;
  }
}
async function list(req, res, table, select = "*") {
  const p = validate(pageQuery, req.query);
  const { data, error, count } = await req.db
    .from(table)
    .select(select, { count: "exact" })
    .range(p.offset, p.offset + p.limit - 1);
  fail(error);
  res.json({
    data,
    pagination: { limit: p.limit, offset: p.offset, total: count },
  });
}
api.get("/countries", allowRoles(...readRoles), (req, res) =>
  list(req, res, "countries"),
);
api.post("/countries", allowRoles("administrator"), async (req, res) => {
  const body = validate(schemas.country, req.body);
  const { data, error } = await req.db
    .from("countries")
    .insert(body)
    .select()
    .single();
  fail(error);
  res.status(201).json({ data });
});
api.patch("/countries/:id", allowRoles("administrator"), async (req, res) => {
  validate(uuid, req.params.id);
  const body = validate(schemas.country.partial(), req.body);
  const { data, error } = await req.db
    .from("countries")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();
  fail(error);
  res.json({ data });
});
api.get("/consultants", allowRoles(...readRoles), (req, res) =>
  req.user?.role === "consultant"
    ? res.json({
        data: [req.consultant],
        pagination: { total: 1, limit: 100, offset: 0 },
      })
    : list(
        req,
        res,
        "consultants",
        (invitationsEnabled ? "email," : "") +
          "id,external_id,name,country_id,country_effective_from,active,created_at,updated_at,job_title,annual_salary::text,salary_currency,salary_effective_from," +
          (companyReportingEnabled
            ? "employment_start_date,employment_end_date,"
            : "") +
          "countries(name,iso_code)",
      ),
);
api.get(
  "/consultants/:id/country-history",
  allowRoles(...readRoles),
  async (req, res) => {
    validate(uuid, req.params.id);
    const { data, error } = await req.db
      .from("consultant_country_history")
      .select("*,countries(name,iso_code)")
      .eq("consultant_id", req.params.id)
      .order("effective_from");
    fail(error);
    res.json({ data });
  },
);
// Only an admin can add a consultant email to invite that person to the company.
api.post("/consultants", allowRoles(...writeRoles), async (req, res) => {
  const body = validate(schemas.consultant, req.body);
  if (body.email !== undefined && req.user?.role !== "administrator") {
    const e = new Error("Only administrators can invite consultants");
    e.status = 403;
    throw e;
  }
  const { data, error } = await req.db
    .from("consultants")
    .insert(body)
    .select()
    .single();
  fail(error);
  res.status(201).json({ data });
});
// Only an admin can change or remove the email used for a consultant invitation.
api.patch("/consultants/:id", allowRoles(...writeRoles), async (req, res) => {
  validate(uuid, req.params.id);
  const body = validate(schemas.consultant.partial(), req.body);
  if (body.email !== undefined && req.user?.role !== "administrator") {
    const e = new Error("Only administrators can invite consultants");
    e.status = 403;
    throw e;
  }
  if (body.country_id && !body.country_effective_from) {
    const e = new Error(
      "country_effective_from is required when changing country_id",
    );
    e.status = 400;
    throw e;
  }
  const { data, error } = await req.db
    .from("consultants")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();
  fail(error);
  res.json({ data });
});
api.get("/expenses", allowRoles(...readRoles), async (req, res) => {
  const p = validate(
    pageQuery.extend({
      from: date.optional(),
      to: date.optional(),
      consultant_id: uuid.optional(),
    }),
    req.query,
  );
  let q = req.db
    .from("expenses")
    .select("*,expense_conversions(*)", { count: "exact" })
    .order("transaction_date", { ascending: false })
    .range(p.offset, p.offset + p.limit - 1);
  if (p.from) q = q.gte("transaction_date", p.from);
  if (p.to) q = q.lte("transaction_date", p.to);
  if (p.consultant_id) q = q.eq("consultant_id", p.consultant_id);
  const { data, error, count } = await q;
  fail(error);
  res.json({
    data,
    pagination: { limit: p.limit, offset: p.offset, total: count },
  });
});
api.post("/expenses", allowRoles(...writeRoles), async (req, res) => {
  const body = validate(schemas.expense, req.body);
  const { data: attribution, error: lookupError } = await req.db
    .from("consultant_country_history")
    .select("country_id")
    .eq("consultant_id", body.consultant_id)
    .lte("effective_from", body.transaction_date)
    .or(`effective_to.is.null,effective_to.gte.${body.transaction_date}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(lookupError);
  if (!attribution) {
    const e = new Error(
      "No consultant country assignment exists for the transaction date",
    );
    e.status = 422;
    throw e;
  }
  const { data, error } = await req.db
    .from("expenses")
    .insert({
      ...body,
      attributed_country_id: attribution.country_id,
      created_by: req.user.id,
    })
    .select()
    .single();
  fail(error);
  const conversion = await autoConvertExpense(req.db, data, req.user.id);
  res.status(201).json({ data, conversion });
});
api.get("/expenses/:id", allowRoles(...readRoles), async (req, res) => {
  validate(uuid, req.params.id);
  const { data, error } = await req.db
    .from("expenses")
    .select("*,expense_conversions(*)")
    .eq("id", req.params.id)
    .single();
  fail(error);
  res.json({ data });
});
api.patch("/expenses/:id", allowRoles(...writeRoles), async (req, res) => {
  validate(uuid, req.params.id);
  const body = validate(schemas.expense.partial(), req.body);
  const { data: finalized, error: lookupError } = await req.db
    .from("expense_conversions")
    .select("id")
    .eq("expense_id", req.params.id)
    .not("finalized_at", "is", null)
    .limit(1);
  fail(lookupError);
  const materialChange = [
    "original_amount",
    "original_currency",
    "transaction_date",
    "consultant_id",
  ].some((key) => body[key] !== undefined);
  if (finalized.length && materialChange) {
    const e = new Error(
      "Expenses with finalized conversions cannot change amount, currency, date, or consultant",
    );
    e.status = 409;
    throw e;
  }
  if (materialChange) {
    const { data: old, error: oldError } = await req.db
      .from("expenses")
      .select("consultant_id,transaction_date")
      .eq("id", req.params.id)
      .single();
    fail(oldError);
    const consultantId = body.consultant_id || old.consultant_id;
    const txDate = body.transaction_date || old.transaction_date;
    const { data: attribution, error: historyError } = await req.db
      .from("consultant_country_history")
      .select("country_id")
      .eq("consultant_id", consultantId)
      .lte("effective_from", txDate)
      .or(`effective_to.is.null,effective_to.gte.${txDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    fail(historyError);
    if (!attribution) {
      const e = new Error(
        "No consultant country assignment exists for the transaction date",
      );
      e.status = 422;
      throw e;
    }
    body.attributed_country_id = attribution.country_id;
  }
  const { data, error } = await req.db
    .from("expenses")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();
  fail(error);
  if (materialChange) {
    const { error: resetError } = await req.db
      .from("expense_conversions")
      .update({
        status: "pending",
        applied_rate: null,
        provider: null,
        requested_date: null,
        effective_rate_date: null,
        retrieved_at: null,
        converted_amount: null,
        fallback_used: false,
        error_metadata: {
          reason: "source expense changed; automatic conversion pending",
        },
      })
      .eq("expense_id", req.params.id)
      .is("finalized_at", null);
    fail(resetError);
  }
  const conversion = await autoConvertExpense(req.db, data, req.user.id);
  res.json({ data, conversion });
});
api.post(
  "/expenses/:id/conversions",
  allowRoles(...writeRoles),
  async (req, res) => {
    const id = validate(uuid, req.params.id);
    const body = validate(
      z.object({ target_currency: currency }).strict(),
      req.body,
    );
    const { data: expense, error: e1 } = await req.db
      .from("expenses")
      .select("*")
      .eq("id", id)
      .single();
    fail(e1);
    const { data: existing, error: e2 } = await req.db
      .from("expense_conversions")
      .select("id,status,finalized_at")
      .eq("expense_id", id)
      .eq("target_currency", body.target_currency)
      .maybeSingle();
    fail(e2);
    if (existing?.finalized_at) {
      const e = new Error("Finalized conversions are immutable");
      e.status = 409;
      throw e;
    }
    const result = await getHistoricalRate(
      expense.original_currency,
      body.target_currency,
      expense.transaction_date,
    );
    if (result.status === "pending") {
      const { data, error } = await req.db
        .from("expense_conversions")
        .upsert(
          {
            expense_id: id,
            target_currency: body.target_currency,
            status: "pending",
            error_metadata: result.errors,
          },
          { onConflict: "expense_id,target_currency" },
        )
        .select()
        .single();
      fail(error);
      return res.status(202).json({ data });
    }
    const { error: rateError } = await req.db
      .from("exchange_rates")
      .upsert(
        {
          provider: result.provider,
          base_currency: expense.original_currency,
          quote_currency: body.target_currency,
          rate: result.rate,
          effective_date: result.effectiveDate,
          fallback_used: result.fallback,
        },
        { onConflict: "provider,base_currency,quote_currency,effective_date" },
      );
    fail(rateError);
    const converted = multiplyAndRound(expense.original_amount, result.rate, 2);
    const row = {
      expense_id: id,
      target_currency: body.target_currency,
      applied_rate: result.rate,
      provider: result.provider,
      requested_date: expense.transaction_date,
      effective_rate_date: result.effectiveDate,
      retrieved_at: new Date().toISOString(),
      converted_amount: converted,
      status: "finalized",
      fallback_used: result.fallback,
      error_metadata: result.errors?.length
        ? { providerFailures: result.errors }
        : null,
      finalized_at: new Date().toISOString(),
      finalized_by: req.user.id,
    };
    const { data, error } = await req.db
      .from("expense_conversions")
      .upsert(row, { onConflict: "expense_id,target_currency" })
      .select()
      .single();
    fail(error);
    res.status(201).json({ data });
  },
);
api.get(
  "/conversions/exceptions",
  allowRoles("administrator", "finance"),
  async (req, res) => {
    const { data, error } = await req.db
      .from("expense_conversions")
      .select("*,expenses(*)")
      .eq("status", "pending");
    fail(error);
    res.json({ data });
  },
);
api.post(
  "/conversions/:id/retry",
  allowRoles("administrator", "finance"),
  async (req, res) => {
    validate(uuid, req.params.id);
    const { data: conversion, error } = await req.db
      .from("expense_conversions")
      .select("*,expenses(*)")
      .eq("id", req.params.id)
      .single();
    fail(error);
    if (conversion.finalized_at) {
      const e = new Error("Finalized conversions cannot be retried");
      e.status = 409;
      throw e;
    }
    const expense = conversion.expenses;
    const result = await getHistoricalRate(
      expense.original_currency,
      conversion.target_currency,
      expense.transaction_date,
    );
    if (result.status === "pending") {
      const { data, error: updateError } = await req.db
        .from("expense_conversions")
        .update({ status: "pending", error_metadata: result.errors })
        .eq("id", conversion.id)
        .select()
        .single();
      fail(updateError);
      return res.status(202).json({ data });
    }
    const { error: rateError } = await req.db
      .from("exchange_rates")
      .upsert(
        {
          provider: result.provider,
          base_currency: expense.original_currency,
          quote_currency: conversion.target_currency,
          rate: result.rate,
          effective_date: result.effectiveDate,
          fallback_used: result.fallback,
        },
        { onConflict: "provider,base_currency,quote_currency,effective_date" },
      );
    fail(rateError);
    const now = new Date().toISOString();
    const { data, error: updateError } = await req.db
      .from("expense_conversions")
      .update({
        applied_rate: result.rate,
        provider: result.provider,
        requested_date: expense.transaction_date,
        effective_rate_date: result.effectiveDate,
        retrieved_at: now,
        converted_amount: multiplyAndRound(
          expense.original_amount,
          result.rate,
          2,
        ),
        status: "finalized",
        fallback_used: result.fallback,
        error_metadata: result.errors?.length
          ? { providerFailures: result.errors }
          : null,
        finalized_at: now,
        finalized_by: req.user.id,
      })
      .eq("id", conversion.id)
      .select()
      .single();
    fail(updateError);
    res.json({ data });
  },
);
api.post("/imports/expenses", allowRoles(...writeRoles), async (req, res) => {
  if (!req.is("text/csv") && !req.is("application/json")) {
    const e = new Error("CSV imports require text/csv or application/json");
    e.status = 415;
    throw e;
  }
  const csv = typeof req.body === "string" ? req.body : req.body?.csv;
  if (typeof csv !== "string" || Buffer.byteLength(csv, "utf8") > 5_000_000) {
    const e = new Error("Send CSV as text/csv or {csv}; maximum size is 5 MB");
    e.status = 413;
    throw e;
  }
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length);
  if (lines.length < 2 || lines.length > 5001) {
    const e = new Error("CSV must contain a header and at most 5,000 rows");
    e.status = 400;
    throw e;
  }
  const parse = (line) => {
    const out = [];
    let cell = "",
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"' && quoted) {
        cell += '"';
        i++;
      } else if (c === '"') quoted = !quoted;
      else if (c === "," && !quoted) {
        out.push(cell);
        cell = "";
      } else cell += c;
    }
    if (quoted) throw new Error("Malformed quoted CSV");
    out.push(cell);
    return out;
  };
  const headers = parse(lines[0]).map((h) => h.trim());
  const required = [
    "consultant_external_id",
    "transaction_date",
    "original_amount",
    "original_currency",
    "category",
  ];
  if (required.some((h) => !headers.includes(h))) {
    const e = new Error(`Required headers: ${required.join(", ")}`);
    e.status = 400;
    throw e;
  }
  const { data: batch, error: be } = await req.db
    .from("import_batches")
    .insert({
      filename: req.headers["x-filename"]?.slice(0, 255) || "expenses.csv",
      uploaded_by: req.user.id,
      total_rows: lines.length - 1,
      status: "processing",
    })
    .select()
    .single();
  fail(be);
  const { data: consultants, error: ce } = await req.db
    .from("consultants")
    .select("id,external_id");
  fail(ce);
  const byExternal = new Map(consultants.map((c) => [c.external_id, c]));
  let accepted = 0,
    rejected = 0,
    duplicates = 0;
  const errs = [];
  const autoContext = conversionContext();
  let conversionsFinalized = 0,
    conversionsPending = 0;
  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parse(lines[i]);
      if (values.length !== headers.length)
        throw new Error("Column count does not match header");
      const row = Object.fromEntries(
        headers.map((h, j) => [h, values[j]?.trim()]),
      );
      const c = byExternal.get(row.consultant_external_id);
      if (!c) throw new Error("Unknown consultant_external_id");
      const item = validate(schemas.expense, {
        consultant_id: c.id,
        transaction_date: row.transaction_date,
        original_amount: row.original_amount,
        original_currency: row.original_currency,
        category: row.category,
        vendor: row.vendor,
        source_identifier: row.source_identifier,
        description: row.description,
        ...(companyReportingEnabled && row.is_payroll
          ? {
              is_payroll:
                validate(z.enum(["true", "false"]), row.is_payroll) === "true",
            }
          : {}),
      });
      const { data: attribution, error: ae } = await req.db
        .from("consultant_country_history")
        .select("country_id")
        .eq("consultant_id", c.id)
        .lte("effective_from", item.transaction_date)
        .or(`effective_to.is.null,effective_to.gte.${item.transaction_date}`)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      fail(ae);
      if (!attribution)
        throw new Error("No country assignment exists for transaction date");
      const { data: savedExpense, error } = await req.db
        .from("expenses")
        .insert({
          ...item,
          attributed_country_id: attribution.country_id,
          source_identifier: item.source_identifier || null,
          import_batch_id: batch.id,
          created_by: req.user.id,
        })
        .select()
        .single();
      if (error?.code === "23505") {
        duplicates++;
        continue;
      }
      fail(error);
      accepted++;
      const conversion = await autoConvertExpense(
        req.db,
        savedExpense,
        req.user.id,
        autoContext,
      );
      if (conversion.status === "finalized") conversionsFinalized++;
      else conversionsPending++;
    } catch (error) {
      rejected++;
      const message =
        error.details
          ?.map((detail) => `${detail.path}: ${detail.message}`)
          .join("; ") || error.message;
      errs.push({
        batch_id: batch.id,
        row_number: i + 1,
        source_values: { line: lines[i].slice(0, 2000) },
        error_code: error.code || "INVALID_ROW",
        message: message.slice(0, 500),
      });
    }
  }
  if (errs.length) {
    const { error } = await req.db.from("import_row_errors").insert(errs);
    fail(error);
  }
  const { error: updateError } = await req.db
    .from("import_batches")
    .update({
      accepted_rows: accepted,
      rejected_rows: rejected,
      duplicate_rows: duplicates,
      status: "completed",
    })
    .eq("id", batch.id);
  fail(updateError);
  res
    .status(201)
    .json({
      data: {
        id: batch.id,
        status: "completed",
        accepted,
        rejected,
        duplicates,
        conversions_finalized: conversionsFinalized,
        conversions_pending: conversionsPending,
        skipped: 0,
        strategy: "partial acceptance; each row commits independently",
      },
    });
});
api.get("/imports/:id", allowRoles(...readRoles), async (req, res) => {
  validate(uuid, req.params.id);
  const { data, error } = await req.db
    .from("import_batches")
    .select("*,import_row_errors(*)")
    .eq("id", req.params.id)
    .single();
  fail(error);
  res.json({ data });
});
function sumAmounts(rows) {
  return rows.reduce(
    (sum, row) => sum + BigInt(String(row.converted_amount).replace(".", "")),
    0n,
  );
}
function formatMinor(units) {
  const n = units < 0n ? -units : units;
  return `${units < 0n ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
api.get(
  "/reports/country-costs",
  allowRoles(...readRoles),
  async (req, res) => {
    const { data, error } = await req.db
      .from("expenses")
      .select(
        "id,attributed_country_id,transaction_date,countries(name,iso_code,default_reporting_currency),expense_conversions(target_currency,converted_amount,status)",
      );
    fail(error);
    const groups = new Map();
    for (const expense of data) {
      const currencyCode = expense.countries.default_reporting_currency;
      const conversion = expense.expense_conversions.find(
        (c) => c.target_currency === currencyCode && c.status === "finalized",
      );
      const key = `${expense.attributed_country_id}:${currencyCode}`;
      const group = groups.get(key) || {
        country_id: expense.attributed_country_id,
        country: expense.countries.name,
        currency: currencyCode,
        total: "0.00",
        expense_count: 0,
        unconverted_count: 0,
      };
      if (conversion) {
        group._minor =
          (group._minor || 0n) +
          BigInt(String(conversion.converted_amount).replace(".", ""));
        group.expense_count++;
      } else group.unconverted_count++;
      groups.set(key, group);
    }
    res.json({
      data: [...groups.values()].map(({ _minor, ...g }) => ({
        ...g,
        total: formatMinor(_minor || 0n),
      })),
    });
  },
);
api.get("/reports/consolidated", allowRoles(...readRoles), async (req, res) => {
  const expenses = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await req.db
      .from("expenses")
      .select(
        "id,original_amount,original_currency,transaction_date,expense_conversions(target_currency,converted_amount,status)",
      )
      .order("id")
      .range(offset, offset + pageSize - 1);
    fail(error);
    expenses.push(...data);
    if (data.length < pageSize) break;
  }
  res.json({
    data: await consolidateExpenses(
      expenses,
      undefined,
      req.company?.home_currency || "USD",
    ),
  });
});
api.get(
  "/reports/reconciliation",
  allowRoles("administrator", "finance"),
  async (req, res) => {
    const { data, error } = await req.db
      .from("expense_conversions")
      .select(
        "*,expenses(id,original_amount,original_currency,transaction_date,attributed_country_id)",
      );
    fail(error);
    const exceptions = data
      .filter((c) => c.status !== "finalized")
      .map((c) => ({
        conversion_id: c.id,
        expense_id: c.expense_id,
        status: c.status,
        error: c.error_metadata,
      }));
    res.json({
      data,
      summary: {
        conversion_count: data.length,
        finalized_count: data.filter((c) => c.status === "finalized").length,
        exception_count: exceptions.length,
        exceptions,
      },
    });
  },
);
api.get("/placements", allowRoles(...readRoles), (req, res) =>
  list(
    req,
    res,
    "placements",
    "id,external_id,consultant_id,placement_date,client,country_id,created_by,created_at,revenue_amount::text,revenue_currency,revenue_recognition_date",
  ),
);
api.post("/placements", allowRoles(...writeRoles), async (req, res) => {
  const body = validate(placementSchema, req.body);
  const { data, error } = await req.db
    .from("placements")
    .insert({ ...body, created_by: req.user.id })
    .select()
    .single();
  fail(error);
  res.status(201).json({ data });
});

api.patch("/placements/:id", allowRoles(...writeRoles), async (req, res) => {
  validate(uuid, req.params.id);
  const body = validate(placementSchema, req.body);
  const { data, error } = await req.db
    .from("placements")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();
  fail(error);
  res.json({ data });
});
// Database policies and companyClient keep deletion inside the signed-in company.
for (const [resource, table] of [
  ["expenses", "expenses"],
  ["placements", "placements"],
]) {
  api.delete(
    `/${resource}/:id`,
    allowRoles(...writeRoles),
    async (req, res) => {
      const id = validate(uuid, req.params.id);
      const { data, error } = await req.db
        .from(table)
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
      fail(error);
      if (!data) {
        const missing = new Error(
          `${resource === "expenses" ? "Expense" : "Placement"} not found`,
        );
        missing.status = 404;
        throw missing;
      }
      res.status(204).end();
    },
  );
}
api.get("/reports/roi", allowRoles(...readRoles), async (req, res) => {
  const filters = validate(
    z
      .object({
        group_by: z
          .enum(["country", "consultant", "company"])
          .default("country"),
        period: z.enum(["month", "quarter", "year"]).default("month"),
        consultant_id: uuid.optional(),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        year: z.coerce.number().int().min(1900).max(9998).optional(),
        quarter: z.coerce.number().int().min(1).max(4).optional(),
      })
      .refine((v) => !v.quarter || Boolean(v.year), {
        message: "Year is required with quarter",
      })
      .refine(
        (v) => !v.month || (v.period === "month" && !v.year && !v.quarter),
        {
          message:
            "Month cannot be combined with year, quarter or another period",
        },
      )
      .refine((v) => !v.quarter || v.period === "quarter", {
        message: "Quarter requires quarterly period",
      }),
    req.query,
  );
  const { month, year, quarter, period, group_by, consultant_id } = filters;
  let start = null,
    end = null;
  if (month) {
    start = month + "-01";
    const y = Number(month.slice(0, 4)),
      m = Number(month.slice(5));
    end =
      m === 12
        ? y + 1 + "-01-01"
        : y + "-" + String(m + 1).padStart(2, "0") + "-01";
  } else if (year) {
    const m = quarter ? (quarter - 1) * 3 + 1 : 1;
    const next = quarter ? m + 3 : 13;
    start = year + "-" + String(m).padStart(2, "0") + "-01";
    end =
      next === 13
        ? year + 1 + "-01-01"
        : year + "-" + String(next).padStart(2, "0") + "-01";
  }
  async function allRows(table, select, dateColumn) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      let query = req.db
        .from(table)
        .select(select)
        .order("id")
        .range(offset, offset + 499);
      if (consultant_id)
        query = query.eq(
          table === "consultants" ? "id" : "consultant_id",
          consultant_id,
        );
      if (start && table === "placements")
        query = query.or(
          "and(revenue_recognition_date.gte." +
            start +
            ",revenue_recognition_date.lt." +
            end +
            "),and(revenue_recognition_date.is.null,placement_date.gte." +
            start +
            ",placement_date.lt." +
            end +
            ")",
        );
      else if (start && dateColumn)
        query = query.gte(dateColumn, start).lt(dateColumn, end);
      const { data, error } = await query;
      fail(error);
      rows.push(...data);
      if (data.length < 500) break;
    }
    return rows;
  }
  const [expenses, placements] = await Promise.all([
    allRows(
      "expenses",
      (companyReportingEnabled ? "is_payroll," : "") +
        "id,consultant_id,consultants(name),attributed_country_id,original_amount::text,original_currency,transaction_date,countries(name),expense_conversions(target_currency,converted_amount::text,status)",
      "transaction_date",
    ),
    allRows(
      "placements",
      "id,consultant_id,consultants(name),country_id,placement_date,revenue_amount::text,revenue_currency,revenue_recognition_date,countries(name)",
      "revenue_recognition_date",
    ),
  ]);
  let salary = { rows: [], issues: [] };
  if (companyReportingEnabled) {
    const [people, pay, history] = await Promise.all([
      allRows(
        "consultants",
        "id,name,employment_start_date,employment_end_date",
        null,
      ),
      allRows(
        "compensation_history",
        "id,consultant_id,annual_salary::text,salary_currency,effective_from,effective_to",
        null,
      ),
      allRows(
        "consultant_country_history",
        "id,consultant_id,country_id,effective_from,effective_to,countries(name)",
        null,
      ),
    ]);
    const asOf = new Intl.DateTimeFormat("en-CA", {
      timeZone: req.company.reporting_timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    salary = salaryExpenses(people, pay, history, { start, end, asOf });
  }
  const reportCurrency = req.company?.home_currency || "USD";
  const rows = await calculateRoi(expenses, placements, undefined, {
    groupBy: group_by,
    period,
    currency: reportCurrency,
    salaryRows: salary.rows,
  });
  if (salary.issues.length)
    for (const row of rows) {
      row.complete = false;
      row.profit = null;
      row.roi_percent = null;
      row.cost_per_placement = null;
    }
  res.json({
    data: rows,
    currency: reportCurrency,
    month: month || null,
    group_by,
    period,
    consultant_id: consultant_id || null,
    salary_included: companyReportingEnabled,
    salary_issues: salary.issues,
  });
});
