import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

type SupabaseRuntimeConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

const supabaseUrl = (env.SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
const supabaseServiceRoleKey = (
  env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ""
).trim();

const missingSupabaseEnvKeys = [
  ...(supabaseUrl ? [] : ["SUPABASE_URL"]),
  ...(supabaseAnonKey ? [] : ["SUPABASE_ANON_KEY"]),
  ...(supabaseServiceRoleKey ? [] : ["SUPABASE_SERVICE_ROLE_KEY"])
];

function runtimeConfig(): SupabaseRuntimeConfig | null {
  if (missingSupabaseEnvKeys.length > 0) {
    return null;
  }
  return {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: supabaseServiceRoleKey
  };
}

const baseClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
};

const config = runtimeConfig();

const supabaseAnonClient: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey, baseClientOptions)
  : null;

const supabaseAdminClient: SupabaseClient | null = config
  ? createClient(config.url, config.serviceRoleKey, baseClientOptions)
  : null;

export function isSupabaseAuthConfigured() {
  return missingSupabaseEnvKeys.length === 0;
}

export function getMissingSupabaseEnvKeys() {
  return [...missingSupabaseEnvKeys];
}

export function getSupabaseAnonClient() {
  return supabaseAnonClient;
}

export function getSupabaseAdminClient() {
  return supabaseAdminClient;
}
