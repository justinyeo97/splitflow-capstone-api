import {
  invitationsEnabled,
  consultantClient,
} from "../services/invitations.js";
import { companyReportingEnabled, companyClient } from "../services/company.js";
import { createClient } from "@supabase/supabase-js";
import { authClient } from "../lib/supabase.js";
import { env } from "../config/env.js";
// Check who is signed in before letting them use company data.
export async function authenticate(req, _res, next) {
  try {
    // 1. Check with Supabase that this person is really signed in.
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      const e = new Error("A valid bearer token is required");
      e.status = 401;
      throw e;
    }
    if (!authClient) {
      const e = new Error("Authentication is not configured");
      e.status = 503;
      throw e;
    }
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) {
      const e = new Error("Invalid or expired access token");
      e.status = 401;
      throw e;
    }
    const publishableKey =
      env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    req.db = createClient(env.SUPABASE_URL, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // 2. Check that their account is active and find their chosen company.
    const { data: profile, error: profileError } = await req.db
      .from("profiles")
      .select(
        companyReportingEnabled ? "role,active,company_id" : "role,active",
      )
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active) {
      const e = new Error("User profile is inactive or not provisioned");
      e.status = 403;
      throw e;
    }
    req.user = { id: data.user.id, role: profile.role };
    if (invitationsEnabled && !profile.company_id) {
      req.user.role = "unassigned";
      return next();
    }
    if (companyReportingEnabled) {
      // 3. Check that they belong to this company and find out what they are allowed to do.
      const { data: membership, error: me } = await req.db
        .from("company_memberships")
        .select(invitationsEnabled ? "role,consultant_id" : "role")
        .eq("company_id", profile.company_id)
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (me) throw me;
      if (invitationsEnabled && !membership) {
        req.user.role = "unassigned";
        return next();
      }
      if (!membership) {
        const e = new Error("Company membership is required");
        e.status = 403;
        throw e;
      }
      const { data: company, error: ce } = await req.db
        .from("companies")
        .select("id,name,home_currency,reporting_timezone")
        .eq("id", profile.company_id)
        .single();
      if (ce) throw ce;
      req.company = company;
      req.user = { ...req.user, role: membership.role, company_id: company.id };
      // 4. Keep their data requests inside their own company.
      req.db = companyClient(req.db, company.id);
      // 5. If they are a consultant, find their record and show only their own expenses.
      if (invitationsEnabled && membership.consultant_id) {
        const { data: people, error: pe } = await req.db.rpc("my_consultant");
        if (pe) throw pe;
        const person = people?.[0];
        if (!person?.active) {
          req.user.role = "unassigned";
          req.company = undefined;
          return next();
        }
        req.user = {
          ...req.user,
          role: "consultant",
          consultant_id: person.id,
        };
        req.consultant = person;
        req.db = consultantClient(req.db, person.id);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
// Stop the request if this person does not have permission to do this.
export function allowRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      const e = new Error("Insufficient role");
      e.status = 403;
      return next(e);
    }
    next();
  };
}
