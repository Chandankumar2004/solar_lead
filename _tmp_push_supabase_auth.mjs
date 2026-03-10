import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: "apps/api/.env" });

const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/^"|"$/g, "");
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
  .trim()
  .replace(/^"|"$/g, "");
const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = (process.env.SEED_SUPER_ADMIN_PASSWORD ?? "").trim();
const fullName = (process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin").trim();

if (!supabaseUrl || !serviceRoleKey || !email || !password) {
  console.error("AUTH_PUSH_CONFIG_MISSING", {
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    hasEmail: Boolean(email),
    hasPassword: Boolean(password)
  });
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function findUserByEmail(targetEmail) {
  const perPage = 200;
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }
    const users = data?.users ?? [];
    const found = users.find(
      (u) => (u.email ?? "").trim().toLowerCase() === targetEmail
    );
    if (found) {
      return found;
    }
    if (users.length < perPage) {
      return null;
    }
  }
  return null;
}

async function run() {
  const existing = await findUserByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: fullName
      }
    });
    if (error) {
      console.error("AUTH_PUSH_UPDATE_FAILED", { message: error.message });
      process.exit(1);
    }
    console.log("AUTH_PUSH_UPDATED", { email, supabaseUserId: existing.id });
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName
    }
  });

  if (error || !data.user) {
    console.error("AUTH_PUSH_CREATE_FAILED", { message: error?.message ?? null });
    process.exit(1);
  }

  console.log("AUTH_PUSH_CREATED", { email, supabaseUserId: data.user.id });
}

run().catch((error) => {
  console.error("AUTH_PUSH_FATAL", {
    message: error?.message ?? String(error)
  });
  process.exit(1);
});
