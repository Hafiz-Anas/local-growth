import { z } from "zod";

/** Shared by the API routes (server) and the forms (client). */

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

/** At least 8 characters with a letter and a number. */
export const newPasswordSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/[A-Za-z]/)
  .regex(/\d/);

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
