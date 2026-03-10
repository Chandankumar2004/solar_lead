import { getSupabaseAdminClient, isSupabaseAuthConfigured } from "./supabase.js";

export async function runStartupHealthChecks() {
  if (!isSupabaseAuthConfigured()) {
    console.error("STARTUP_HEALTH_ERROR", {
      reason: "SUPABASE_AUTH_NOT_CONFIGURED"
    });
    return;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    console.error("STARTUP_HEALTH_ERROR", {
      reason: "SUPABASE_ADMIN_CLIENT_UNAVAILABLE"
    });
    return;
  }

  try {
    // Lightweight HTTP-level probe through Supabase PostgREST.
    const { error } = await adminClient
      .from("users")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) {
      console.error("STARTUP_HEALTH_ERROR", {
        reason: "SUPABASE_DB_PROBE_FAILED",
        message: error.message
      });
      return;
    }
    console.info("STARTUP_HEALTH_OK", {
      reason: "SUPABASE_DB_PROBE_OK"
    });
  } catch (error) {
    console.error("STARTUP_HEALTH_ERROR", {
      reason: "SUPABASE_DB_PROBE_EXCEPTION",
      error
    });
  }
}
