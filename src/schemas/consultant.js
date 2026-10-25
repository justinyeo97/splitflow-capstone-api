import { z } from 'zod';
import { currency, date, uuid } from '../utils/validation.js';
export const consultantSchema = z.object({
 email:z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+$/, 'Enter an email address').nullable().optional(),
 name:z.string().trim().min(1).max(200),
 employment_start_date:date.optional(),employment_end_date:date.nullable().optional(),
 country_id:uuid,country_effective_from:date.optional(),active:z.boolean().default(true),
 job_title:z.string().trim().min(1).max(200),
 annual_salary:z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, 'Enter a non-negative annual salary with up to 2 decimal places'),
 salary_currency:currency,salary_effective_from:date,
});
