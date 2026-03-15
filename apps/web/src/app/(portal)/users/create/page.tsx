"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import useSWR from "swr";
import { z } from "zod";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "EXECUTIVE";

type District = {
  id: string;
  name: string;
  state: string;
  isActive?: boolean;
  _count?: {
    leads: number;
    assignments: number;
  };
};

const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.union([z.string().trim().min(8).max(20), z.literal("")]).optional(),
  employeeId: z.union([z.string().trim().min(2).max(50), z.literal("")]).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "EXECUTIVE"]),
  districtIds: z.array(z.string()).default([])
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;

const fetcher = (url: string) => api.get(url).then((response) => response.data);

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "District Manager" },
  { value: "EXECUTIVE", label: "Field Executive" }
];

function isDistrictRole(role: Role) {
  return role === "MANAGER" || role === "EXECUTIVE";
}

function extractApiMessage(error: unknown) {
  const maybe = error as { response?: { data?: { message?: string } } };
  return maybe.response?.data?.message ?? "Could not create user";
}

export default function CreateUserPage() {
  const router = useRouter();
  const authUser = useAuthStore((state) => state.user);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);

  const { data: districtsData } = useSWR("/api/districts", fetcher);
  const districts = useMemo(
    () =>
      ((districtsData as { data?: District[] } | undefined)?.data ?? ([] as District[])).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [districtsData]
  );

  const {
    register,
    control,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      employeeId: "",
      role: "EXECUTIVE",
      districtIds: []
    }
  });

  const role = watch("role");
  const canAssignDistricts = isDistrictRole(role);
  const availableRoleOptions =
    authUser?.role === "ADMIN"
      ? ROLE_OPTIONS.filter((item) => item.value === "MANAGER" || item.value === "EXECUTIVE")
      : ROLE_OPTIONS;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    setSubmitWarnings([]);
    try {
      const response = await api.post("/api/users", {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone?.trim() ? values.phone.trim() : null,
        employeeId: values.employeeId?.trim() ? values.employeeId.trim() : null,
        role: values.role,
        districtIds: canAssignDistricts ? values.districtIds : []
      });

      const warnings = (response.data?.data?.warnings ?? []) as string[];
      setSubmitWarnings(warnings);
      const userId = response.data?.data?.user?.id as string | undefined;
      if (userId) {
        router.push(`/users/${userId}`);
        return;
      }
      router.push("/users");
    } catch (error) {
      setSubmitError(extractApiMessage(error));
    }
  });

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Create User</h2>
        <Link href="/users" className="text-sm text-brand-700 hover:underline">
          Back to Users
        </Link>
      </div>

      <form onSubmit={onSubmit} className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Full Name</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("fullName")}
            />
            {errors.fullName && (
              <p className="mt-1 text-xs text-rose-600">{errors.fullName.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Phone</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("phone")}
            />
            {errors.phone && <p className="mt-1 text-xs text-rose-600">{errors.phone.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Employee ID</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("employeeId")}
            />
            {errors.employeeId && (
              <p className="mt-1 text-xs text-rose-600">{errors.employeeId.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Role</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register("role")}
            >
              {availableRoleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-rose-600">{errors.role.message}</p>}
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">
              District Assignments {canAssignDistricts ? "" : "(Disabled for selected role)"}
            </label>
            <Controller
              name="districtIds"
              control={control}
              render={({ field }) => {
                const selectedIds = Array.isArray(field.value) ? field.value : [];
                return (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-slate-300 p-2 disabled:bg-slate-100">
                    {districts.length === 0 ? (
                      <p className="px-1 py-1 text-xs text-slate-500">
                        No districts found. Create districts in Districts module first.
                      </p>
                    ) : (
                      districts.map((district) => {
                        const checked = selectedIds.includes(district.id);
                        return (
                          <label
                            key={district.id}
                            className={`mb-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                              checked ? "bg-emerald-50" : "hover:bg-slate-50"
                            } ${!canAssignDistricts ? "cursor-not-allowed opacity-60" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={checked}
                              disabled={!canAssignDistricts}
                              onChange={() => {
                                const next = checked
                                  ? selectedIds.filter((id) => id !== district.id)
                                  : [...selectedIds, district.id];
                                field.onChange(next);
                              }}
                            />
                            <span>
                              {district.name} ({district.state})
                              {district.isActive === false ? " [Inactive]" : ""}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                );
              }}
            />
            <p className="mt-1 text-xs text-slate-500">
              Click checkboxes to assign multiple districts.
            </p>
          </div>
        </div>

        {submitError ? (
          <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        {submitWarnings.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Warnings</p>
            <ul className="mt-1 list-disc pl-5">
              {submitWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? "Creating..." : "Create User"}
          </button>
          <Link
            href="/users"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          A one-time setup password email will be sent to the user after creation.
        </p>
      </form>
    </div>
  );
}
