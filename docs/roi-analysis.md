# ROI analysis setup

The Reports page has an **Analyze ROI** button for administrators, finance users and viewers. It runs separately from the table and does not change the financial calculations.

## Configure your OpenAI key

1. Create an API key in your OpenAI project: https://platform.openai.com/api-keys. API billing and model access must be enabled for that project.
2. Open `splitflow-capstone-api/.env` in your editor and paste the key after `OPENAI_API_KEY=`. Keep the key out of chat, source control, frontend environment variables and browser storage.
3. Optionally set `OPENAI_ROI_MODEL=gpt-5.4-mini`. The configured model must support the Responses API, structured outputs, and low reasoning effort.
4. Restart the API. Open Reports, load ROI, and click **Analyze ROI**.
5. For production, set the same variables in your **API host's** environment settings and redeploy/restart the backend. Frontend hosting needs no OpenAI key. The existing frontend API URL must point to the updated backend.

The `.env` file is already ignored by Git. The example file contains empty placeholders only. No API key entry form is exposed on the website: one server-managed key funds analysis for the authorized roles above.

## Behavior and safeguards

- The backend reuses the authenticated ROI query. Client-supplied financial totals and arbitrary prompts are not accepted.
- A snapshot fingerprint detects stale tables; refresh ROI if analysis reports that the data has changed.
- Explicit month, quarter or year selections include the preceding comparable period. All-history selections show available period aggregates; they do not invent a previous period.
- Original financial calculations remain authoritative. Aggregated ratios are calculated from summed amounts using integer cents, not averaged percentages.
- Consultants are anonymized, identifiers omitted, and salary figures combined into total costs. No individual salary histories, names, email addresses or raw expense records are sent. A consultant-level total can still represent one person's costs.
- All selected rows contribute to totals. The model receives at most the latest twelve period aggregates and twelve entities ranked by revenue; the response explicitly reports this sampling.
- AI prose is checked for schema validity, known evidence references and absence of numeric figures. The UI renders exact supporting numbers directly from verified facts. Interpretation still requires review.
- OpenAI requests use `store: false`, a forty-five-second timeout and bounded output. This disables response storage; it does not guarantee zero retention by the provider.
- Successful analyses are cached for five minutes per user, company, model and aggregate-data fingerprint. Concurrent identical calls share a request. There is a limit of five new analyses per minute per user/company and four concurrent generations per API process. Multiple API replicas have independent caches and limits.
- No generation runs until a user clicks. Errors leave the table usable. Provider responses and keys are not returned or logged.

## Verification

Run `npm test` and `npm run lint` in the API repository, and `npm run build` / `npm test` in the client. Provider calls in automated tests are mocked. A live check requires a configured key and a signed-in account with report access; it sends the selected aggregates to OpenAI and consumes API credits.

References: https://developers.openai.com/api/docs/guides/structured-outputs and https://developers.openai.com/api/docs/guides/your-data.
