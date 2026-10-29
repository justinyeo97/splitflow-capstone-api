import { z } from "zod";
import { currency, date, uuid } from "../utils/validation.js";

export const placementSchema = z.object({
  consultant_id: uuid,
  placement_date: date,
  client: z.string().trim().max(200).nullable().optional(),
  country_id: uuid,
  revenue_amount: z
    .string()
    .regex(
      /^\d{1,14}(\.\d{1,8})?$/,
      "Enter a non-negative revenue amount with up to 8 decimal places",
    ),
  revenue_currency: currency,
  revenue_recognition_date: date,
});
