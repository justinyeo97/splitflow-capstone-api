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

The local automated suite covers health/readiness behavior and exact decimal conversion/rounding. Run it with `node --test` (or `npm.cmd test` in PowerShell). Supabase migration history and the empty schema were verified; security advisors returned no findings after hardening. Authenticated end-to-end flows, real-provider fallback, CSV integration, and report reconciliation have not been run. Direct API probes from this environment are blocked by network access, so verify `GET /api/v1/ready` from your local machine after restarting the server. Railway deployment remains outstanding. Configure fallback providers in `FX_FALLBACK_URLS` as an ordered JSON array of `{ "name", "baseUrl" }`; each must implement the Frankfurter v1 historical response shape. The default has no fallback provider, so unavailable rates stay pending.

Frankfurter's v1 documentation marks v1 deprecated but says it will continue to work. Its historical endpoint accepts a specific date and reports the returned effective date; validate that date before use. See [Frankfurter v1 documentation](https://frankfurter.dev/v1/).
