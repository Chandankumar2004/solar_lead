import { z } from "zod";

const phoneRegex = /^[0-9+\-()\s]{8,20}$/;

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

const optionalPositiveNumber = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  z
    .number({ invalid_type_error: "Monthly bill must be a valid number" })
    .positive("Monthly bill must be greater than 0")
    .max(1_000_000, "Monthly bill is too large")
    .optional()
);

export const publicLeadFormSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  phone: z
    .string()
    .trim()
    .min(8, "Phone must be at least 8 characters")
    .max(20, "Phone must be at most 20 characters")
    .regex(phoneRegex, "Enter a valid phone number"),
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional(),
  monthly_bill: optionalPositiveNumber,
  district_id: z.string().uuid("Please select a district"),
  state: z.string().trim().min(2, "State is required"),
  installation_type: z.string().trim().min(2, "Please select installation type").max(100),
  message: z.union([z.string().trim().max(1000), z.literal("")]).optional(),
  consent_given: z
    .boolean()
    .refine((value) => value, "Consent is required before submitting this form")
});

export type PublicLeadFormValues = z.infer<typeof publicLeadFormSchema>;

export const INSTALLATION_TYPES = [
  "Residential Rooftop",
  "Commercial Rooftop",
  "Industrial",
  "Ground Mounted",
  "Other"
] as const;
