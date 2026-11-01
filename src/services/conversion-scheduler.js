import { createClient } from "@supabase/supabase-js";
import { runConversionRetries } from "./retry-conversion.js";

export function workerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Scheduled retries require SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function startConversionScheduler() {
  if (process.env.CONVERSION_RETRY_ENABLED !== "true") return () => {};
  const db = workerClient();
  const interval = Number(process.env.CONVERSION_RETRY_INTERVAL_MS || 900_000);
  if (!Number.isInteger(interval) || interval < 60_000)
    throw new Error("CONVERSION_RETRY_INTERVAL_MS must be at least 60000");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      console.log(
        JSON.stringify({
          event: "conversion_retries",
          ...(await runConversionRetries(db)),
        }),
      );
    } catch {
      console.error(JSON.stringify({ event: "conversion_retries_failed" }));
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, 1000);
  const timer = setInterval(tick, interval);
  startup.unref();
  timer.unref();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}
