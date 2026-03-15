import { z } from "zod";

export const PASSWORD_POLICY_MESSAGE =
  "Password must include uppercase, lowercase, number, and special character";

export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[a-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[0-9]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY_MESSAGE);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const createLeadSchema = z.object({
  districtId: z.string().uuid(),
  source: z.string().min(2).max(100),
  customer: z.object({
    fullName: z.string().min(2).max(120),
    phone: z.string().min(8).max(20),
    email: z.string().email().optional(),
    address: z.string().min(5).max(400)
  })
});

export const transitionLeadSchema = z.object({
  nextStatusId: z.string().uuid(),
  notes: z.string().max(500).optional()
});
