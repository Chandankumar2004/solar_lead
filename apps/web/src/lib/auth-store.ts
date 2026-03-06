"use client";

import { create } from "zustand";

export type AdminRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DISTRICT_MANAGER"
  | "FIELD_EXECUTIVE";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: AdminRole;
  roleLabel: string;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
};

type AuthState = {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user })
}));
