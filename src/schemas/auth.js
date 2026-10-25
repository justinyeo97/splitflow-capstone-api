import { z } from 'zod';
export const companyProfileSchema = z.object({ company_name: z.string().trim().min(1, 'Enter your company name').max(200) }).strict();
export const authCredentials = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) }).strict();
export const signupSchema = authCredentials.extend({company_name: companyProfileSchema.shape.company_name});
