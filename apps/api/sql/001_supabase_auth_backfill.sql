-- Backfill missing public.users profiles from Supabase auth.users
-- Run in Supabase SQL Editor.
--
-- IMPORTANT:
-- 1) Update seed_admin_email if your super admin uses a different email.
-- 2) This script does NOT change table design.

create extension if not exists pgcrypto;

do $$
declare
  seed_admin_email text := lower('chandan32005c@gmail.com');
begin
  insert into public.users (
    id,
    email,
    password_hash,
    full_name,
    phone,
    role,
    status,
    employee_id,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    lower(au.email),
    '__supabase_auth_managed__',
    coalesce(
      nullif(au.raw_user_meta_data ->> 'full_name', ''),
      initcap(replace(split_part(lower(au.email), '@', 1), '.', ' '))
    ),
    null,
    case
      when lower(au.email) = seed_admin_email then 'super_admin'::"UserRole"
      else 'executive'::"UserRole"
    end,
    case
      when lower(au.email) = seed_admin_email then 'active'::"UserStatus"
      else 'pending'::"UserStatus"
    end,
    case
      when lower(au.email) = seed_admin_email then 'SA-001'
      else null
    end,
    now(),
    now()
  from auth.users au
  left join public.users u
    on lower(u.email) = lower(au.email)
  where au.email is not null
    and u.id is null;

  update public.users
  set
    role = 'super_admin'::"UserRole",
    status = 'active'::"UserStatus",
    employee_id = coalesce(employee_id, 'SA-001'),
    password_hash = coalesce(nullif(password_hash, ''), '__supabase_auth_managed__'),
    updated_at = now()
  where lower(email) = seed_admin_email;
end
$$;

-- Verification helpers:
-- select id, email, role, status, employee_id from public.users where lower(email) = lower('chandan32005c@gmail.com');
-- select count(*) as auth_users_without_profile
-- from auth.users au
-- left join public.users u on lower(u.email) = lower(au.email)
-- where au.email is not null and u.id is null;
