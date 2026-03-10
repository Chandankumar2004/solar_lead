import { Request } from "express";
import { getSupabaseAdminClient } from "../lib/supabase.js";

export async function createAuditLog(input: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detailsJson?: unknown;
  ipAddress?: string | null;
}) {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  const details =
    input.detailsJson === undefined
      ? null
      : (JSON.parse(JSON.stringify(input.detailsJson)) as Record<string, unknown> | null);

  try {
    const { data, error } = await adminClient
      .from("audit_logs")
      .insert({
        actor_user_id: input.actorUserId ?? null,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        details_json: details,
        ip_address: input.ipAddress ?? null
      })
      .select("id")
      .single();

    if (error) {
      console.error("audit_log_write_failed", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("audit_log_write_failed", error);
    return null;
  }
}

export function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}
