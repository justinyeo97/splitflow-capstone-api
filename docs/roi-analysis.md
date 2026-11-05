# Groq ROI analysis

Reports provides **Analyze ROI** for administrators, finance users and viewers. Groq supplies the explanation; the existing backend supplies all financial calculations and supporting figures.

## Free usage setup

1. Create a Groq account and API key at https://console.groq.com/keys. Keep the account on the **Free plan**. Do not upgrade to Developer or enable paid billing if you require zero API charges.
2. Paste the key after `GROQ_API_KEY=` in `splitflow-capstone-api/.env`, using your editor. Never paste it into chat, frontend environment variables or browser storage. The `.env` file is ignored by Git.
3. The pinned model is `GROQ_ROI_MODEL=openai/gpt-oss-20b`, which Groq currently lists for Free-plan usage and strict structured outputs. Requests go exclusively to Groq using the server-side Groq key.
4. Restart the API, refresh Reports, and click **Analyze ROI**. For production, configure the same variables in the **backend host's** environment settings and restart/redeploy that API. No Groq key belongs on the frontend host.

The application cannot verify your Groq billing plan. These controls reduce usage; a Free-plan account is what prevents usage charges. Groq may change model availability and limits. Review your account limits at https://console.groq.com/dashboard/limits.

## Usage controls

- Generation runs only on click. Identical analyses are cached for thirty minutes per company, user, model and aggregate-data fingerprint; concurrent identical requests share one call.
- One generation at a time per API process. Up to five new attempts per minute per company/user, subject to stricter shared token budgets.
- Each process reserves an estimated prompt/schema/framing token count plus the full completion allowance. Requests exceeding seven thousand estimated tokens are rejected before contacting Groq; select a narrower report to proceed.
- Shared process budgets are seven thousand reserved tokens per rolling minute, one hundred twenty thousand per UTC day, and forty generation attempts per UTC day. Failed attempts also consume the local reservation. Completion is capped at eighteen hundred tokens with low reasoning effort.
- Token estimates are heuristic, not an exact tokenizer. Provider limits also cover other applications and all users of the organization. Groq remains authoritative and can return a limit error earlier.
- On a provider limit error, generation pauses for at least a minute and respects longer `Retry-After` values, up to a day. Cached results remain available. There are no automatic retries, paid-provider fallbacks, tools, search calls, plan upgrades or alternate models.
- Budgets and caches are in memory: they reset on restart and are independent across API replicas. Groq's organization-wide Free-plan limits still apply. These are usage controls, not a persistent billing enforcement system.
- The ROI table remains usable when analysis is unavailable or limited.

## Data and correctness

The backend recomputes the authorized report and checks its snapshot before analysis; it never trusts client totals. Explicit time selections include preceding-period data. All-history selections do not invent a previous period. All selected rows contribute to totals, with at most twelve recent period aggregates and twelve entities by revenue included as detailed evidence.

Consultant names and IDs are removed, and salary figures are combined into total costs. No individual salary history, email or raw expense records are sent. An anonymous consultant's aggregate costs can still concern one person. The provider's current data policy applies: https://console.groq.com/docs/your-data.

Responses use Groq Chat Completions with strict JSON schema. The backend checks completion status, schema, evidence references and absence of numerical figures in prose. Exact supporting numbers come from backend calculations. Interpretations still require review.

## Verification

Run `npm test` and `npm run lint` in the API repository, then `npm run build` and `npm test` in the client. Automated provider requests are mocked. A live check requires a Groq key and consumes free quota; use synthetic data first.

References: https://console.groq.com/docs/structured-outputs, https://console.groq.com/docs/rate-limits, and https://console.groq.com/docs/billing-faqs.
