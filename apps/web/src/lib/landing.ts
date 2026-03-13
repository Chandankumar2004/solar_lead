import { z } from "zod";

const nameRegex = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const indianMobileRegex = /^[6-9]\d{9}$/;
const DEFAULT_MIN_MONTHLY_BILL_INR = 500;

export const MIN_MONTHLY_BILL_INR = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_MIN_MONTHLY_BILL_INR ?? "");
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return DEFAULT_MIN_MONTHLY_BILL_INR;
})();

export const districtOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  state: z.string().min(1)
});

export const districtMappingSchema = z.object({
  generatedAt: z.string().datetime().nullable().optional(),
  states: z.array(z.string()),
  mapping: z.record(z.array(z.object({ id: z.string().uuid(), name: z.string().min(1) }))),
  districts: z.array(districtOptionSchema)
});

export type DistrictMappingPayload = z.infer<typeof districtMappingSchema>;
export type DistrictOption = z.infer<typeof districtOptionSchema>;

export const emptyDistrictMapping: DistrictMappingPayload = {
  generatedAt: null,
  states: [],
  mapping: {},
  districts: []
};

const requiredMonthlyBill = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  z
    .number({ invalid_type_error: "Monthly bill must be a valid number" })
    .int("Monthly bill must be a whole number")
    .min(MIN_MONTHLY_BILL_INR, `Monthly bill must be at least INR ${MIN_MONTHLY_BILL_INR}`)
    .max(1_000_000, "Monthly bill is too large")
);

export const INSTALLATION_TYPES = [
  "Residential",
  "Industrial",
  "Agricultural",
  "Other"
] as const;

export const publicLeadFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120)
    .regex(nameRegex, "Name must contain alphabets and spaces only"),
  phone: z
    .string()
    .trim()
    .regex(indianMobileRegex, "Enter a valid 10-digit Indian mobile number"),
  email: z.string().trim().email("Enter a valid email"),
  monthly_bill: requiredMonthlyBill,
  district_id: z.string().uuid("Please select a district"),
  state: z.string().trim().min(2, "State is required"),
  installation_type: z.enum(INSTALLATION_TYPES),
  message: z.union([z.string().trim().max(500, "Message must be 500 characters or less"), z.literal("")]).optional(),
  consent_given: z
    .boolean()
    .refine((value) => value, "Consent is required before submitting this form")
});

export type PublicLeadFormValues = z.infer<typeof publicLeadFormSchema>;
