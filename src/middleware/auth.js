import { createClient } from "@supabase/supabase-js";
import { authClient } from "../lib/supabase.js";
import { env } from "../config/env.js";

export async function authenticate(req, _res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) { const e = new Error("A valid bearer token is required"); e.status = 401; throw e; }
    if (!authClient) { const e = new Error("Authentication is not configured"); e.status = 503; throw e; }
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) { const e = new Error("Invalid or expired access token"); e.status = 401; throw e; }
    const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    req.db = createClient(env.SUPABASE_URL, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await req.db.from("profiles").select("role,active").eq("id", data.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active) { const e = new Error("User profile is inactive or not provisioned"); e.status = 403; throw e; }
    req.user = { id: data.user.id, role: profile.role };
    next();
  } catch (error) { next(error); }
}
export function allowRoles(...roles) { return (req, _res, next) => { if (!req.user || !roles.includes(req.user.role)) { const e = new Error("Insufficient role"); e.status = 403; return next(e); } next(); }; }
