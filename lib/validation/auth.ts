import { z } from "zod";
import { usernameProblem } from "@/lib/usernames";

/** Shared by the API routes (server) and the forms (client). */

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

/** The username rules (lib/usernames.ts); the refinement's message is the problem code the forms translate. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** Log in with a username, or the email of an older account (one field). */
export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});

/** At least 8 characters with a letter and a number. */
export const newPasswordSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/[A-Za-z]/)
  .regex(/\d/);

