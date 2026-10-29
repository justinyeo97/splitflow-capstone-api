# Splitflow API

Splitflow manages consultants, expenses, placement revenue, currency conversions, and reports comparing revenue with operating and salary costs. This backend uses Express, Supabase Auth/Postgres, and Zod.

## Quick start

1. Start the API or choose a deployed base URL.
2. Sign in through `POST /auth/login`.
3. Copy `data.session.access_token` and send it as `Authorization: Bearer <access_token>`.
4. Read `GET /auth/profile` to check your role and company.
5. Use the endpoint reference below. Invited users may need to join their company before accessing expenses.

| Environment | Base URL |
| --- | --- |
| Local | `http://localhost:3000/api/v1` |
| Railway | `https://splitflow-api-production.up.railway.app/api/v1` |

All paths below are relative to the base URL. For example, `/expenses` locally means `http://localhost:3000/api/v1/expenses`. This reference describes the current source; deployments may run an earlier version or have different features enabled.

### Run locally

Use Node.js 20 or newer. From the project root:

```powershell
npm install
Copy-Item .env.example .env
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`, then run:

```powershell
npm run dev
```

Use `npm start` to run without automatic restarts. The entry point is `src/server.js`. Keep `.env` out of Git. This API uses a Supabase publishable key and the caller's token; it does not require a service-role key.

The database must already contain the required schema, triggers, functions, and access policies. Local migration files were removed after application, so this repository is not a complete fresh-database bootstrap. Do not expect `supabase db push` alone to recreate it. See [Architecture](docs/ARCHITECTURE.md) and [Consultant access](docs/CONSULTANT_ACCESS.md) for schema context.

### Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Listening port; default `3000`. |
| `NODE_ENV` | `development`, `test`, or `production`. Production hides internal error messages. |
| `SUPABASE_URL` | Supabase project's API URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key. Legacy `SUPABASE_ANON_KEY` is also accepted. |
| `FRONTEND_URL` / `ALLOWED_ORIGINS` | Allowed browser origins. `ALLOWED_ORIGINS` is comma-separated; default `http://localhost:5173`. |
| `COMPANY_REPORTING_ENABLED` | Enable only after company schema and isolation checks pass. Adds company scoping, membership roles, salary-inclusive ROI, and home-currency reporting. Default disabled. |
| `CONSULTANT_INVITATIONS_ENABLED` | Enable only after invitation schema/access checks pass, with company reporting enabled. Adds invited-company onboarding and restricted consultant accounts. Default disabled. |
| `FRANKFURTER_BASE_URL` | Primary historical rate service; default `https://api.frankfurter.dev/v1`. |
| `FX_FALLBACK_URLS` | Additional providers as a JSON array of `{ "name", "baseUrl" }` objects implementing the Frankfurter v1 historical response shape. Default `[]`. |

## API conventions and permissions

Send JSON with `Content-Type: application/json`, except for raw CSV uploads. Protected endpoints also need:

```http
Authorization: Bearer <access_token>
```

Use the Supabase **access token**, not the publishable key, as the bearer token. Refresh sessions through Supabase; this API has no refresh-token or logout endpoint.

| Access label | Meaning |
| --- | --- |
| Public | No token required. |
| Signed in | Active authenticated profile, including users completing company onboarding. |
| Staff | `administrator`, `finance`, or `viewer`. |
| Editors | `administrator` or `finance`. |
| Administrator | `administrator` only. |
| Consultant | Invited consultant with access limited to their own expenses and basic lookup data. |

With company reporting enabled, staff access is limited to their company. Consultant accounts require invitation support. Unassigned users can access profile/company onboarding but cannot use business-data routes. Database row-level security also applies.

### IDs, dates, and amounts

- `:id`, `consultant_id`, `country_id`, and `company_id` mean database **UUIDs**. Replace placeholders such as `<consultant_uuid>` with actual IDs returned by the API.
- Human-readable `external_id` references such as `C-00000001` are used in CSV imports, not resource URLs.
- Dates use `YYYY-MM-DD`; report months use `YYYY-MM`.
- Currencies use three uppercase letters, such as `MYR` or `USD`.
- Send non-negative amounts as decimal **strings**, such as `"125.50"`. Expense/revenue inputs allow up to 14 integer digits and eight decimal places; salaries allow 14 integer digits and two decimal places.
- Server/database-generated fields include IDs, company ownership, conversion details, and audit fields.

### Responses and pagination

Unless noted otherwise, successful reads/updates return **200**, and creates return **201**. A single record is usually wrapped in `{ "data": { ... } }`; a list uses `{ "data": [ ... ] }`.

Countries, consultants, expenses, and placements support `?limit=50&offset=0`. Increase `offset` to fetch the next page. `limit` is 1–100 (default 50); `offset` defaults to 0:

```json
{
  "data": [],
  "pagination": { "limit": 50, "offset": 0, "total": 0 }
}
```

The consultant's own identity lookup is a special one-record response. Histories, import details, exceptions, and reports do not use this pagination envelope. ROI and consolidated reports fetch source rows in internal pages; country-cost, reconciliation, and exception queries can be subject to Supabase's response row limit.

## Health

| Endpoint | Access | Result |
| --- | --- | --- |
| `GET /health` | Public | Process health: `200` with `{ "status": "ok" }`. |
| `GET /ready` | Public | Database configuration/reachability: `200` if ready, `503` if unconfigured/unavailable. |

Readiness can return:

```json
{ "status": "ready", "checks": { "database": "reachable_auth_required" } }
```

`reachable_auth_required` means the database responded and requires authentication. It does not verify every table or a particular user's permissions.

## Authentication and company onboarding

### `GET /auth/config` — discover invitation support

**Access:** Public. No body or query parameters.

Returns `{ "data": { "invitations_enabled": true } }` when invitations are enabled. Check this before choosing the signup/onboarding flow.

### `POST /auth/signup` — register an account

**Access:** Public. Required: `email`, `password` (8–128 characters). With invitations disabled, `company_name` is also required (trimmed, 1–200 characters).

```json
{
  "email": "person@example.com",
  "password": "<your_password>",
  "company_name": "Example Agency"
}
```

Returns `201` with `data.user`, `data.session`, and `data.confirmation_required`. If confirmation is required, `session` is `null` until email confirmation is completed.

With invitations enabled, omit `company_name`: signup does not create a company or grant membership. After verifying their email, the user selects an invited company. Typing a company name never grants access.

### `POST /auth/login` — sign in

**Access:** Public.

```json
{ "email": "person@example.com", "password": "<your_password>" }
```

Returns `data.user` and `data.session`. Copy `data.session.access_token` for protected requests. Incorrect credentials return `401`.

PowerShell example:

```powershell
$baseUrl = 'http://localhost:3000/api/v1'
$credentials = @{ email = 'person@example.com'; password = '<your_password>' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/login" -ContentType 'application/json' -Body $credentials
$headers = @{ Authorization = "Bearer $($login.data.session.access_token)" }
Invoke-RestMethod -Uri "$baseUrl/auth/profile" -Headers $headers
```

### `GET /auth/google` — obtain a Google sign-in URL

**Access:** Public. Optional query: `redirect_to`, a frontend callback URL. Defaults to the first configured allowed origin.

Example: `/auth/google?redirect_to=http://localhost:5173/auth/callback`.

Returns `{ "data": { "url": "..." } }`. Navigate the browser to that URL, then let the frontend process the Supabase session callback. The API returns a URL rather than redirecting directly.

The callback origin must be allowed by this API, and the callback URL must be configured in Supabase. Disallowed origins return `400`; provider setup errors return `503`. Google sign-in requires a configured Google OAuth client and enabled Supabase Google provider.

### `GET /auth/companies` — list companies you can join

**Access:** Signed in; invitations must be enabled.

Returns an array in `data` containing `company_id`, `name`, and `consultant_id`. Choices come from existing staff memberships or active invitations matching the user's verified email. No arbitrary email lookup is supported. Returns `409` if invitations are disabled.

### `POST /auth/join-company` — accept an invitation

**Access:** Signed in; invitations must be enabled.

```json
{ "company_id": "<company_uuid>" }
```

The database checks verified email and invitation eligibility. Success returns `{ "data": { "joined": true } }`. Fetch your profile again afterward. Users cannot grant themselves staff roles or join arbitrary companies. Returns `409` if invitations are disabled.

Typical invited-user flow: **signup → verify email → login → list companies → join company → fetch profile → read own expenses**. Administrators create invitations by setting a consultant's email; this does not send an invitation email.

### `GET /auth/profile` — read your account

**Access:** Signed in.

Returns profile fields such as `id`, `email`, `role`, and `company_name`. With company reporting enabled, includes `company_id` and the assigned `company` (`id`, `name`, `home_currency`, `reporting_timezone`) when available. Invitation mode also returns `invitations_enabled`, `consultant_id`, and basic `consultant` details.

`role: "unassigned"` means company onboarding is needed. Linked consultants receive `role: "consultant"`, even though their database membership is a restricted viewer role.

### `PATCH /auth/profile` — update your company name

**Access:** Administrator when company reporting is enabled. With company reporting disabled, access depends on profile database policies. Consultant and unassigned users should use the read-only profile/onboarding flow.

```json
{ "company_name": "Example Agency" }
```

Accepts only `company_name`. With company reporting enabled, also renames the company. Returns the updated profile and company where available. Does not edit email, passwords, roles, or membership.

### `PATCH /company` — change company reporting settings

**Access:** Administrator; company reporting must be enabled.

Both fields are required, even though this is PATCH:

```json
{ "name": "Example Agency", "home_currency": "MYR" }
```

Returns `id`, `name`, `home_currency`, and `reporting_timezone`. Home-currency changes affect subsequent report valuations. Timezone is returned but cannot be edited here. Returns `409` if company reporting is disabled.

## Countries

Countries define the regional currency used for expense allocation.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /countries` | Staff; consultants have limited lookup access | Paginated country list; database policies restrict consultant visibility. |
| `POST /countries` | Administrator | Create a country; returns the saved record (`201`). |
| `PATCH /countries/:id` | Administrator | Update any subset of create fields; returns the updated record. |

Create body; all fields are required:

```json
{ "name": "Malaysia", "iso_code": "MY", "default_reporting_currency": "MYR" }
```

`name` is 1–120 characters. `iso_code` is two characters and is uppercased by validation. Save the returned country UUID for consultant assignments and placements.

## Consultants

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /consultants` | Staff; consultant sees only own basic identity | Paginated directory with title, salary, and country; employment/email fields depend on enabled features. Consultant lookup excludes salary. |
| `POST /consultants` | Editors; administrator required if `email` supplied | Create a consultant; returns the saved record (`201`). |
| `PATCH /consultants/:id` | Editors; administrator required if `email` supplied | Update a subset of create fields; returns the updated record. |
| `GET /consultants/:id/country-history` | Staff | Dated country assignments and country details, ordered by `effective_from`. No pagination. |

Create example:

```json
{
  "name": "Example Consultant",
  "country_id": "<country_uuid>",
  "country_effective_from": "2026-01-01",
  "job_title": "Recruitment Consultant",
  "annual_salary": "60000.00",
  "salary_currency": "MYR",
  "salary_effective_from": "2026-01-01",
  "employment_start_date": "2026-01-01",
  "active": true
}
```

Required: `name` (1–200 characters), `country_id`, `job_title` (1–200), `annual_salary`, `salary_currency`, and `salary_effective_from`.

Optional: `country_effective_from`, `employment_start_date`, `employment_end_date` (date or `null`), `active` (defaults to `true` on create), and `email` (email or `null`, administrator only). Employment fields require the company schema; email requires the invitation schema.

Set country effective dates explicitly so historical expenses can find an assignment. Changing `country_id` requires `country_effective_from` in the same request; use a later effective date. With company reporting enabled, salary changes preserve history and require a later salary effective date. Employment dates determine historical salary accrual.

New external references use `C-` plus at least eight digits; older references remain valid for CSV compatibility. Do not send `external_id` on create/update. Staff directory salary values are returned as text to preserve precision.

An administrator can invite a consultant with `"email": "consultant@example.com"`; emails are trimmed/lowercased. Under the invitation schema, changing/removing the email revokes prior linked membership, and inactive consultants lose access. Finance must omit the email field, including `email: null`.

## Expenses

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /expenses` | Staff; consultants see only own expenses | Paginated list, newest transaction first, including nested `expense_conversions`. |
| `GET /expenses/:id` | Staff; consultant can read only own expense | One expense with conversions. Unavailable/not-visible records can return `404`. |
| `POST /expenses` | Editors | Save an expense and attempt regional conversion. Returns `201` with `data` and a separate `conversion` summary. |
| `PATCH /expenses/:id` | Editors | Update a subset of create fields and attempt conversion. Returns `data` and `conversion`. |
| `DELETE /expenses/:id` | Editors | Permanently delete an expense and its conversions, including finalized conversions. Returns `204` with no body; missing or inaccessible records return `404`. |

Create example:

```json
{
  "consultant_id": "<consultant_uuid>",
  "transaction_date": "2026-10-01",
  "original_amount": "125.50",
  "original_currency": "MYR",
  "category": "Travel",
  "vendor": "Example Vendor",
  "source_identifier": "receipt-2026-001",
  "description": "Travel to client meeting",
  "is_payroll": false
}
```

Required: `consultant_id`, `transaction_date`, `original_amount`, `original_currency`, and `category` (1–100 characters).

Optional: `vendor` (up to 200 characters), `source_identifier` (1–200 after trimming), `description` (up to 1,000), and `is_payroll` (boolean; requires the company schema).

The API sets `attributed_country_id` from the consultant's assignment on the transaction date. Missing assignment returns `422`. A stable `source_identifier` helps detect duplicate imports.

List filters can be combined:

| Query | Meaning |
| --- | --- |
| `from=2026-10-01` | Transactions on or after this date. |
| `to=2026-10-31` | Transactions on or before this date. |
| `consultant_id=<consultant_uuid>` | Filter by consultant; cannot override the signed-in consultant's own scope. |
| `limit=50&offset=0` | Pagination. |

Example: `/expenses?from=2026-10-01&to=2026-10-31&limit=50&offset=0`.

### Automatic conversion and editing

Saving an expense attempts conversion into the attributed country's reporting currency. The separate summary includes `status` (`finalized` or `pending`), `target_currency`, and sometimes a retry message. A pending conversion does not mean the expense was rejected.

Once any conversion is finalized, PATCH cannot supply `original_amount`, `original_currency`, `transaction_date`, or `consultant_id` (even unchanged); this returns `409`. Metadata such as description remains editable. Before finalization, changing source fields resets pending conversions and recalculates attribution.

Mark actual payroll expense entries with `is_payroll: true` when salary history also feeds ROI, to avoid counting payroll twice. Recorded-expense reports still include those entries.

## Currency conversions

| Endpoint | Access | Request and result |
| --- | --- | --- |
| `POST /expenses/:id/conversions` | Editors | Expense UUID; body `{ "target_currency": "USD" }`. Returns `201` with the finalized record or `202` with a pending record if no acceptable rate is available. |
| `GET /conversions/exceptions` | Editors | List pending conversions with expense details/error metadata. No pagination parameters. |
| `POST /conversions/:id/retry` | Editors | Use a **conversion UUID**, not an expense UUID. No body required. Returns `200` if finalized or `202` if still pending. |

Finalized conversions cannot be overwritten/retried (`409`). Records include status, target currency, and available rate/provider/date/amount/finalization details.

Rates use the expense transaction date, with provider effective dates on or before it; weekends/holidays may use an earlier date. The provider chain tries Frankfurter, The Rates API, ECB, fxapi.app, then configured custom providers. Unavailable rates stay pending. Converted values round half away from zero to two decimals.

Automatic conversion runs during writes/imports. There is no scheduled retry worker; use the retry endpoint.

## CSV imports

### `POST /imports/expenses` — import expenses in bulk

**Access:** Editors. Send raw CSV with `Content-Type: text/csv` or JSON `{ "csv": "..." }`. Optional `X-Filename` header labels the batch; default `expenses.csv`.

Required columns: `consultant_external_id`, `transaction_date`, `original_amount`, `original_currency`, `category`.

Optional columns: `vendor`, `source_identifier`, `description`, and `is_payroll` (`true` or `false`, used when company reporting is enabled).

```csv
consultant_external_id,transaction_date,original_amount,original_currency,category,source_identifier
C-00000001,2026-10-01,125.50,MYR,Travel,receipt-2026-001
```

Use actual external references from the consultant directory, rather than UUIDs. Quoted commas/escaped quotes are supported; multiline quoted fields are not.

PowerShell upload, using the login example's variables:

```powershell
Invoke-RestMethod -Method Post -Uri "$baseUrl/imports/expenses" -Headers $headers -ContentType 'text/csv' -InFile './expenses.csv'
```

Maximum 5,000 data rows. Raw CSV is limited to 5,000,000 bytes by the handler; JSON also has the application's smaller 1 MB JSON-body limit. Accepted rows commit independently and attempt conversion. Invalid rows are rejected individually; duplicates are counted separately.

Example `201` response:

```json
{
  "data": {
    "id": "<batch_uuid>",
    "status": "completed",
    "accepted": 1,
    "rejected": 0,
    "duplicates": 0,
    "conversions_finalized": 1,
    "conversions_pending": 0,
    "skipped": 0,
    "strategy": "partial acceptance; each row commits independently"
  }
}
```

### `GET /imports/:id` — inspect an import

**Access:** Staff. Use the batch UUID from the upload response. Returns the batch and nested `import_row_errors` with row numbers, source values, and messages. No pagination parameters. Consultants cannot import or view batches.

## Placements and revenue

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /placements` | Staff | Paginated list, including revenue amount as text, currency, and recognition date. |
| `POST /placements` | Editors | Create a placement; returns the saved record (`201`). |
| `PATCH /placements/:id` | Editors | Update using the **full required create body**, not a partial body; returns the updated record. |
| `DELETE /placements/:id` | Editors | Permanently delete a placement and remove its revenue from subsequent reports. Returns `204` with no body; missing or inaccessible records return `404`. |

Create/update example:

```json
{
  "consultant_id": "<consultant_uuid>",
  "placement_date": "2026-10-01",
  "client": "Example Client",
  "country_id": "<country_uuid>",
  "revenue_amount": "10000.00",
  "revenue_currency": "MYR",
  "revenue_recognition_date": "2026-10-15"
}
```

All fields except `client` are required. Client is optional, nullable, and at most 200 characters. IDs/external references are server/database-generated.

`placement_date` records the activity; `revenue_recognition_date` determines its revenue reporting period. Explicit zero revenue is valid. Older placements lacking revenue details make affected ROI rows incomplete until edited.

## Reports

### `GET /reports/country-costs` — recorded expenses by country

**Access:** Staff. No supported date or pagination filters.

Returns country/currency rows with `country_id`, `country`, `currency`, `total`, `expense_count`, and `unconverted_count`. Only finalized conversions in the country's reporting currency contribute to the total; `expense_count` counts those converted records. Missing conversions increase `unconverted_count`. Does not accrue salary or fetch missing rates.

### `GET /reports/consolidated` — recorded expenses in one currency

**Access:** Staff. No supported date or pagination filters.

Returns `data.currency`, `total`, `expense_count`, `total_expense_count`, `unconverted_count`, `unconverted_expense_ids`, and `complete`. Uses company home currency when company reporting is enabled, otherwise USD.

Reuses matching finalized conversions, includes same-currency expenses, and resolves historical rates for other records. `expense_count` counts successfully valued records. `complete: false` means the total is partial. This read-only valuation includes recorded payroll expenses but does not add salary accrual or create conversion records.

### `GET /reports/reconciliation` — review conversions

**Access:** Editors. No supported query filters.

Returns conversions with linked expenses in `data`, plus `summary.conversion_count`, `finalized_count`, `exception_count`, and an `exceptions` array. Use the conversion IDs to investigate and retry pending records.

### `GET /reports/roi` — compare revenue and costs

**Access:** Staff. Consultants cannot view reports.

| Query | Options / default |
| --- | --- |
| `group_by` | `country` (default), `consultant`, or `company`. |
| `period` | `month` (default), `quarter`, or `year`. |
| `consultant_id` | Optional UUID; filters expense, revenue, and enabled salary inputs. |
| `month` | Optional `YYYY-MM`; monthly period only, cannot combine with year/quarter. |
| `year` | Optional integer, 1900–9998. |
| `quarter` | Optional 1–4; requires year and `period=quarter`. |

Examples:

```text
/reports/roi?group_by=country&month=2026-10
/reports/roi?group_by=consultant&period=quarter&year=2026&quarter=4
/reports/roi?group_by=company&period=year&year=2026
/reports/roi?consultant_id=<consultant_uuid>&month=2026-10
```

Without date filters, includes available history; salary accrual stops at today's date in the company reporting timezone. Company grouping still returns an array of period totals.

The response includes `data` plus `currency`, `month`, `group_by`, `period`, `consultant_id`, `salary_included`, and `salary_issues`. Rows include identity, period, currency, and:

| Field | Meaning |
| --- | --- |
| `operating_costs` | Valued operating expenses, excluding marked payroll. |
| `salary_costs` | Accrued base salary when company reporting is enabled. |
| `costs` | Operating costs plus salary costs. |
| `revenue` | Placement revenue valued on recognition dates. |
| `profit` | Revenue minus costs; null if required inputs are incomplete. |
| `roi_percent` | Profit / costs × 100; null if incomplete or costs are zero. |
| `cost_per_placement` | Costs / placement count; requires complete cost inputs and at least one placement. |
| `placement_count`, `expense_count` | Included placement and operating-expense counts. |
| `complete` | Whether required ownership, salary, revenue, and rate inputs are available. |
| `missing_salary_count`, `missing_revenue_count` | Missing salary segments or incomplete revenue records. |
| `missing_cost_rate_count`, `missing_revenue_rate_count` | Inputs missing acceptable valuation rates. |

Company reporting adds salary history and uses home currency. Salary is annual / 12, prorated by employed calendar days per month, split across historical compensation/country assignments, and bounded by employment/report dates. Without company reporting, salary accrual is excluded and report currency is USD.

Period ratios are computed from totals, not averages of monthly percentages. Check `complete` and `salary_issues`: totals can be partial. Report-level salary issues suppress profit, ROI, and cost per placement. Reports are calculated on request, not locked accounting snapshots.

## Errors and troubleshooting

Most errors use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "original_amount", "message": "..." }],
    "requestId": "<request_uuid>"
  }
}
```

`details` is optional. Responses also include `x-request-id` for tracing errors. Google's direct callback-validation error omits the body request ID; the header is still available.

| Status | Common cause / next step |
| --- | --- |
| `400` | Invalid fields, UUID, dates, filters, or callback origin; check validation details. |
| `401` | Missing/expired token or incorrect credentials; sign in or refresh the Supabase session. |
| `403` | Insufficient role, inactive/unassigned profile, denied company access, or blocked browser origin. |
| `404` | Unknown route or record unavailable to the caller. |
| `409` | Duplicate data, finalized immutable records/source fields, or disabled feature. |
| `413` | CSV/JSON body exceeds the applicable limit. |
| `415` | Import content type is neither CSV nor JSON. |
| `422` | No country assignment covers the expense date. |
| `500` | Internal/database failure; use the request ID to inspect server logs. |
| `503` | Authentication not configured, OAuth setup failure, or failed readiness check. |

Expense and placement deletion is restricted to administrators and Finance within their own company. Viewers and consultants cannot delete records. Deletion cannot be undone; the frontend asks for confirmation. Subsequent reports reflect deleted records. Finalized conversion source fields remain locked against edits, but deleting the parent expense also deletes its conversions atomically.

There are no role-management endpoints or invitation-email sending endpoints.

## Development and deployment

Run the existing backend suite with `npm test` (or `npm.cmd test` if PowerShell blocks the npm wrapper). Tests cover authentication/access boundaries, invitations, company scoping, conversions, imports, expense/placement deletion, exact money calculations, salary accrual, and reporting.

[railway.json](railway.json) starts the API with `npm start` and checks `/api/v1/health`. Configure credentials/feature flags through Railway variables and allow the frontend origin through CORS. Uploading source does not apply database SQL or enable flags automatically.

Deletion requires the policies and conversion cascade defined in [Expense and placement deletion SQL](database/expense-placement-deletion.sql), already applied to the current Supabase database.

Further details:

- [Architecture and reporting rules](docs/ARCHITECTURE.md)
- [Consultant access and invitation rollout](docs/CONSULTANT_ACCESS.md)
- [Company/salary schema SQL](docs/database-proposals/company-salary-reporting.sql)
- [Company isolation verification](docs/database-proposals/verify-company-isolation.sql)
- [Invitation schema SQL](docs/database-proposals/consultant-invitations.sql)
- [Invitation verification](docs/database-proposals/verify-consultant-invitations.sql)

Review prerequisites before applying SQL to another database. These files do not replace the removed full migration history.
