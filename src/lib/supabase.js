import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
export const supabaseReady = Boolean(env.SUPABASE_URL && publishableKey);
export const authClient = supabaseReady ? createClient(env.SUPABASE_URL, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
