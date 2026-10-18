import { z } from "zod";
export const uuid = z.string().uuid();
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const date = z.string().date();
export function validate(schema, value) { const result = schema.safeParse(value); if (!result.success) { const e = new Error("Request validation failed"); e.status = 400; e.code = "VALIDATION_ERROR"; e.details = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })); throw e; } return result.data; }
