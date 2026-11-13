import { z } from "zod";
import { emailRequired, mobileOptional, requiredText } from "./common";

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use at most 72 characters")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Use at least one letter and one number");

export const signInSchema = z.object({
  email: emailRequired,
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export const signUpSchema = z.object({
  full_name: requiredText("Your name", 100),
  email: emailRequired,
  phone: mobileOptional,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailRequired });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
  full_name: requiredText("Your name", 100),
  password: passwordSchema,
});

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
