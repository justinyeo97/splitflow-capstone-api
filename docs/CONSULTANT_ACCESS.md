# Invited consultant access

## Prepared behavior

An administrator enters a consultant's email in the Consultants form. The directory displays that email. Finance users can manage ordinary consultant details but cannot add or change login invitations. No invitation email is sent; this is a database allowlist for a verified account.

New users register with email/password or Google, verify their email, and select a company. The list is authenticated and contains only companies whose active consultant records match that verified email, plus existing staff memberships. Company names cannot be searched by arbitrary email, and matching a typed company name never grants access.

Acceptance links the user to the invited consultant with read-only access. The application role is Consultant; the database membership is Viewer with a consultant ID. Existing administrators retain their roles. Justin Yeo's administrator membership is not changed.

Consultants see My expenses and My account. They cannot create/edit/import expenses, view another consultant's expenses, open company reports, inspect placements, browse consultant salaries or manage invitations. A narrow identity lookup supplies only their own name and reference details. API checks and database row-level security both enforce this, including direct database access. Removing/changing an invitation revokes prior linked membership; making a consultant inactive also removes access.

The approved data assigns `test1@mail` to Juice (C-1002) and `test2@mail` to SigmaSch (C-1003). Both requested test accounts were explicitly provisioned as verified users and linked to their consultants. Password sign-in and own-expense restrictions passed against Supabase and the local API. These test addresses cannot receive ordinary verification or reset messages; use deliverable addresses for normal signup. Test passwords are supplied separately and are not stored in this repository.

## Activation status

The frontend build and 53 backend tests pass. After explicit approval, the database change was applied as 20261025184809_consultant_email_invitations_and_own_expenses. Rollback-only invitation and isolation checks passed. The local backend has CONSULTANT_INVITATIONS_ENABLED=true. Authenticated local HTTP checks passed for both test users: their own expenses are readable, while report access and expense writes return 403. Railway still requires the updated backend deployment and invitation setting.

The applied SQL is recorded in `database-proposals/consultant-invitations.sql`. The verification script is `database-proposals/verify-consultant-invitations.sql`; its synthetic users and assertions are rolled back. Checks cover invited acceptance, uninvited denial, read/write restrictions and access revocation.

Deploy the companion backend with `COMPANY_REPORTING_ENABLED=true` and `CONSULTANT_INVITATIONS_ENABLED=true` only after the database checks pass. The frontend discovers invitation support through `/auth/config` and otherwise retains the existing signup workflow. The optional capability probe never signs users out when an older backend lacks the endpoint.

Verify the deployed Railway API and a signed-in browser session after rollout. Existing company founders are preserved; public signup no longer creates new company owners once this invitation-only workflow is activated. Provisioning additional company owners is an administrative operation, not self-service joining.
