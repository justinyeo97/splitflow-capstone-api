# Splitflow API

JavaScript ES module API using Express, Supabase Auth/Postgres, and Zod. Supabase is the only application database. The API uses the publishable key plus the caller's JWT for database queries so PostgreSQL RLS remains active. It does not need a service-role key.

## Local setup

1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Legacy `SUPABASE_ANON_KEY` is also accepted.
3. Initialize the Supabase CLI directory and apply the SQL migration as described below.
4. Run `npm install`, `npm run dev`, or `npm start`.

`GET /api/v1/health` checks the process. `GET /api/v1/ready` checks whether Supabase is configured and the schema can be queried. Set `FRONTEND_URL` or comma-separated `ALLOWED_ORIGINS` to the exact browser origins allowed by CORS.

## Database setup and first administrator

The API is connected to the new Supabase project `llyquvlqpqoebaplgszt` in Singapore. Its URL and publishable key are in the ignored local `.env`; the publishable key is also the value to configure in Railway. No service-role key is required by this API. The new project was empty before setup. The schema and hardening migrations are applied and recorded in Supabase. The local migration version prefixes match Supabase's recorded versions:

```sh
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

The `db push --dry-run` command previews pending migrations. Review the linked project ref carefully before running `db push`. The migrations are already applied to `splitflow`; no further push is needed for this setup.

Supabase Auth creates each profile as an active `viewer`. Bootstrap the first administrator from the Supabase SQL editor after identifying the Auth user's UUID:

```sql
update public.profiles set role = 'administrator' where id = 'AUTH_USER_UUID';
```

Administrators are bootstrapped and role changes are currently performed through a controlled SQL operation; there is no role-management endpoint. Do not put the service-role key in a browser app.

## Auth and roles

Send `Authorization: Bearer <Supabase access token>` to all resource routes. The server verifies the token through Supabase Auth, reads the caller's profile, then passes the same JWT to Supabase PostgREST. Roles are `administrator`, `finance`, and `viewer`. Viewers can read; finance can manage consultants, expenses, imports, conversions, and placements; only administrators can manage countries. RLS independently enforces these permissions.

### Login

- `POST /api/v1/auth/signup` accepts `{ "email", "password" }`. Supabase may require email confirmation, in which case `session` is `null` until the user confirms.
- `POST /api/v1/auth/login` accepts the same shape and returns the Supabase session, including the access token required by protected API routes.
- `GET /api/v1/auth/google?redirect_to=http://localhost:5173/auth/callback` returns `{ "data": { "url" } }`. Navigate the browser to that URL; the frontend callback must process the Supabase Auth redirect/session. The redirect origin must be listed in `ALLOWED_ORIGINS` (or `FRONTEND_URL`).

Password signup/login use Supabase Auth now. Google OAuth still requires a Google Cloud OAuth Web client and enabling Google in **Supabase Dashboard → Authentication → Providers → Google**. In Google Cloud, add the Supabase project's Auth callback URL shown on that provider page as an authorized redirect URI. Add the app's local and production callback URLs to Supabase's Auth URL Configuration allow list, and configure the same app origins in this API's `ALLOWED_ORIGINS`. The current project does not have those Google credentials, so Google sign-in will return 503 until provider setup is completed. After callback, send the returned Supabase access token as a bearer token to protected API routes.

## API behavior

- API base path: `/api/v1`. Lists use `limit` (1–100, default 50) and `offset`.
- Errors use `{ "error": { "code", "message", "requestId", "details?" } }`.
- Expense amounts and currency are supplied explicitly. The database retains `NUMERIC(22,8)` original values.
- Consultant country assignments are date-effective. Set `country_effective_from` when creating a consultant; changing country requires a later effective date. Expenses snapshot the country assigned on their transaction date.
- Conversion policy: query the requested transaction date, accept only valid rates whose provider effective date is on or before that date, and use the first valid configured provider. For Frankfurter, the returned `date` is stored as effective date; the selected date can precede the transaction date on weekends/holidays. No rate means pending conversion. Rates are never averaged or replaced by a current rate.
- Conversion output is rounded half away from zero to two decimal places using integer arithmetic. Source amounts retain up to eight decimal places; rates retain up to twelve.
- Finalized conversions are immutable in both the API and a database trigger. Changing a source expense with pending conversions resets them to pending; finalized expense source fields cannot be changed.
- Expense CSV imports accept `text/csv` (up to 5 MB) or a JSON `{ "csv": "..." }` payload (subject to the JSON parser's 1 MB limit). Required headers: `consultant_external_id,transaction_date,original_amount,original_currency,category`; optional headers: `vendor,source_identifier,description`. Maximum 5,000 data rows. Imports use partial acceptance; invalid rows and duplicate stable `source_identifier` values are recorded separately.
- Country-cost reports include finalized conversions in each country's configured reporting currency and count expenses missing that conversion. Consolidated reports total finalized USD conversions. These endpoints currently return complete result sets and do not yet support date filters.

## Routes implemented

Health/readiness; country list/create/update; consultant list/create/update/history via effective assignments; expense list/create/get/update; CSV expense import/status; historical conversions, pending exceptions and retry; country costs, consolidated USD and reconciliation; placement list/create.

## Verification and remaining work

The local automated suite covers health/readiness behavior and exact decimal conversion/rounding. Run it with `node --test` (or `npm.cmd test` in PowerShell). Supabase migration history and the empty schema were verified; security advisors returned no findings after hardening. Authenticated end-to-end flows, real-provider fallback, CSV integration, and report reconciliation have not been run. Direct API probes from this environment are blocked by network access, so verify `GET /api/v1/ready` from your local machine after restarting the server. Railway deployment remains outstanding. Backup providers activate only when their credential environment variables are set; without keys, unavailable rates remain pending.

Frankfurter is the primary provider. Its v1 API is deprecated in favor of v2 but remains available indefinitely. No-key historical backups run in this order: The Rates API (ECB data, 30 currencies, dates from 1999), direct ECB Data Portal (EUR-based daily reference rates, 30 currencies), then fxapi.app (broader pair coverage; only an exact requested-date result is accepted). The Rates API returns the previous working day for weekends and holidays; the effective date from its response is stored. The ECB adapter uses the newest shared observation no more than 14 days before the transaction date. If no provider returns an acceptable rate, the conversion stays pending. Custom providers in `FX_FALLBACK_URLS` run after these and must implement Frankfurter v1's historical response shape.

The Rates API and the direct ECB endpoint both rely on ECB reference data, so they provide separate service availability but not independent market observations. ECB reference rates cover about 30 currencies and are published on working days. fxapi.app documents historical ranges and broad pair coverage, but its public docs do not specify a service-level agreement or fixed rate limit. The fallback chain therefore validates every returned date and leaves unsupported or unavailable pairs pending. References: [The Rates API](https://theratesapi.com/), [ECB Data Portal API examples](https://data.ecb.europa.eu/help/api/data-examples), [ECB exchange-rate methodology](https://data.ecb.europa.eu/methodology/exchange-rates), and [fxapi.app endpoints](https://fxapi.app/).

Frankfurter's v1 documentation marks v1 deprecated but says it will continue to work. Its historical endpoint accepts a specific date and reports the returned effective date; validate that date before use. See [Frankfurter v1 documentation](https://frankfurter.dev/v1/).

## Monthly country ROI

Placements now require revenue_amount (non-negative decimal string, up to 8 decimal places), revenue_currency (3-letter uppercase code), revenue_recognition_date (YYYY-MM-DD), and country_id. PATCH /api/v1/placements/:id accepts the same full editable fields as POST; IDs remain server-generated. Existing placements retain null revenue until edited.

GET /api/v1/reports/roi optionally accepts ?month=YYYY-MM and returns all country/month groups (source rows are paginated internally). Revenue uses its recognition date; expenses use their transaction date and attributed country. All recorded country/month costs are allocated to recognized revenue for the same country/month. Placement counts and cost per placement follow recognition month. No individual-placement or shared-country allocation is inferred.

USD costs reuse finalized USD conversions or resolve historical rates. Revenue uses historical recognition-date rates. Missing revenue/rates or unassigned countries mark rows incomplete and suppress profit and ROI. Costs and revenue then show partial converted totals. Zero costs give null ROI; zero placements give null cost_per_placement. Monthly ROI is (revenue - costs) / costs * 100; cost_per_placement is costs / recognized placement count. These are based on recorded expenses, not necessarily every business cost.

## Company profiles

POST /api/v1/auth/signup requires company_name (trimmed, 1-200 characters), email and password. Company is passed through Supabase signup metadata and copied into public.profiles by the auth insert trigger. GET /api/v1/auth/profile returns the authenticated user profile. PATCH /api/v1/auth/profile accepts only company_name and scopes the update to the caller; existing profile RLS remains authoritative (current temporary administrator default allows onboarding updates). Company name is descriptive only: it is not a tenant boundary and is never used for authorization. Google users and older accounts without a company complete company setup before entering the frontend workspace.

## Consultant compensation

Consultant create/update supports job_title, annual_salary (non-negative decimal string with up to 2 decimal places), salary_currency (uppercase 3-letter code), and salary_effective_from (YYYY-MM-DD). These fields are required when creating a consultant. Directory reads return salary as text to preserve decimal precision. Salary is annual base pay only; monthly equivalents are annual / 12 and quarterly equivalents annual / 4 before rounding. The effective date establishes when the current rate starts; salary changes currently replace that rate and do not preserve salary history. Historical payroll, proration, employment dates, FX policy and salary integration into ROI remain future work. Seeded salaries and titles are illustrative sample data, not verified compensation.

Consultant IDs are now generated by a bigint sequence, using C- plus at least eight digits. Existing IDs remain unchanged for CSV compatibility. POST and PATCH ignore external_id input. The sequence begins above existing numeric consultant IDs and grows beyond eight digits when needed.

## Automatic expense conversion

Expense POST, PATCH and accepted CSV import rows automatically attempt the attributed country reporting currency conversion before returning. Imports cache rates by currency pair and transaction date. A pending conversion is persisted before provider lookup. Lookup or rate-storage failures leave the expense accepted and a pending exception for manual retry; imports expose conversions_finalized and conversions_pending counts. Successful conversions finalize immediately under the existing immutable-source rules. Metadata-only edits remain supported; finalized amount/currency/date/consultant fields remain locked. Older unconverted expenses can use Retry conversion. This is request-time conversion, not a scheduled retry worker; ROI USD valuation remains separate.

ROI supports group_by=country|consultant and period=month|quarter|year, with optional consultant_id, month=YYYY-MM, year=YYYY and quarter=1..4. Quarter requires year and quarterly period; month cannot combine with other date filters. Consultant filters apply to both expense and revenue source rows before aggregation. Ratios are recomputed from period totals. Consultant ROI includes the person across countries; country ROI uses expense attribution and placement country. Salaries remain excluded.

## Prepared company reporting rollout

See docs/ARCHITECTURE.md and docs/database-proposals/company-salary-reporting.sql. Company reporting is disabled by default until the database migration is explicitly approved, applied and verified. Keep COMPANY_REPORTING_ENABLED=false on the existing database. After activation, membership roles and company RLS isolate records, salary history feeds ROI, and company home currency replaces fixed USD reporting. The architecture document supersedes older salary/tenant limitation notes above.

Company reporting was activated locally after approval: migrations 20261025172908 and 20261025172936 are applied. Rollback-only tenant isolation and authenticated database checks passed. The local API uses COMPANY_REPORTING_ENABLED=true; new environments must migrate and verify before enabling. See the architecture document for verification scope.

## Prepared consultant invitations

See docs/CONSULTANT_ACCESS.md for verified-email company selection, consultant-only expense access, and rollout prerequisites. Keep CONSULTANT_INVITATIONS_ENABLED=false until the proposed database change is approved, applied, and verified. The frontend capability probe activates the new flow only when this setting is enabled on the deployed API.
