import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  SUPABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),
  SUPABASE_PUBLISHABLE_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  SUPABASE_ANON_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  FRANKFURTER_BASE_URL: z
    .string()
    .url()
    .default("https://api.frankfurter.dev/v1"),
  FX_FALLBACK_URLS: z.string().default("[]"),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success)
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
  );
export const env = parsed.data;
export const allowedOrigins = [
  ...new Set(
    [env.FRONTEND_URL, ...env.ALLOWED_ORIGINS.split(",")].filter(Boolean),
  ),
];
export const fxFallbacks = (() => {
  try {
    const value = JSON.parse(env.FX_FALLBACK_URLS);
    if (
      !Array.isArray(value) ||
      value.some(
        (x) => typeof x?.baseUrl !== "string" || typeof x?.name !== "string",
      )
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      "FX_FALLBACK_URLS must be a JSON array of {name, baseUrl} objects",
    );
  }
})();
export const fxFallbackProviders = [
  { name: "theratesapi" },
  { name: "ecb" },
  { name: "fxapi" },
  ...fxFallbacks,
];
