import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

function stripWrappingQuotes(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const supabaseUrl = stripWrappingQuotes(process.env.SUPABASE_URL ?? "");
const supabaseServiceRoleKey = stripWrappingQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function findSupabaseUserByEmail(email: string) {
  const pageSize = 200;
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: pageSize
    });
    if (error) {
      throw new Error(error.message);
    }
    const users = data.users ?? [];
    const found = users.find((user) => (user.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) {
      return found;
    }
    if (users.length < pageSize) {
      return null;
    }
  }
  return null;
}

async function main() {
  const password = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PASSWORD ?? "");
  if (!password) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD is required");
  }

  const email = stripWrappingQuotes(
    process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@example.com"
  ).toLowerCase();
  const fullName = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin") || "Super Admin";
  const phoneRaw = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PHONE ?? "");
  const phone = phoneRaw.length > 0 ? phoneRaw : null;
  const employeeId = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID ?? "SA-001") || "SA-001";

  const { data: appUser, error: appUserError } = await supabaseAdmin
    .from("users")
    .upsert(
      {
        email,
        full_name: fullName,
        phone,
        employee_id: employeeId,
        role: "super_admin",
        status: "active",
        password_hash: "__supabase_auth_managed__"
      },
      { onConflict: "email" }
    )
    .select("id, email, employee_id, status, role")
    .single();
  if (appUserError || !appUser) {
    throw new Error(appUserError?.message ?? "Unable to upsert app super admin user");
  }

  const metadata = {
    app_user_id: String(appUser.id),
    full_name: fullName
  };

  const existingAuthUser = await findSupabaseUserByEmail(email);
  if (existingAuthUser) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
      email,
      password,
      user_metadata: metadata,
      email_confirm: true
    });
    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata
    });
    if (error || !data.user) {
      throw new Error(error?.message ?? "Unable to create Supabase auth user");
    }
  }

  console.log("SUPER_ADMIN_PASSWORD_RESET_OK");
  console.log(appUser);
}

main()
  .catch((error) => {
    console.error("SUPER_ADMIN_PASSWORD_RESET_FAILED", error);
    process.exit(1);
  });
