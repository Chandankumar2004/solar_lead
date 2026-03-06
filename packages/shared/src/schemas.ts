import { z } from "zod";

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

