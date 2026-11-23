
-- MELIKA single-student app: Supabase PostgreSQL schema
-- Run this file in Supabase SQL Editor before creating accounts.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'student' check (role in ('admin','student')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_state (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  visible_to_student boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin') $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch before update on public.app_state
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.app_state enable row level security;
alter table public.admin_notes enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users can read their own profile; admins can inspect both accounts.
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin());
-- Students may discover the admin account ID to address a private chat message.
drop policy if exists profiles_read_admin_contact on public.profiles;
create policy profiles_read_admin_contact on public.profiles for select to authenticated
using (role='admin');
-- No client-side role changes. Provision/edit roles only through SQL dashboard.

drop policy if exists app_state_read_student_or_admin on public.app_state;
create policy app_state_read_student_or_admin on public.app_state for select to authenticated
using (student_id=auth.uid() or public.is_admin());
drop policy if exists app_state_insert_student_or_admin on public.app_state;
create policy app_state_insert_student_or_admin on public.app_state for insert to authenticated
with check (student_id=auth.uid() or public.is_admin());
drop policy if exists app_state_update_student_or_admin on public.app_state;
create policy app_state_update_student_or_admin on public.app_state for update to authenticated
using (student_id=auth.uid() or public.is_admin())
with check (student_id=auth.uid() or public.is_admin());

drop policy if exists notes_read_admin_or_visible_student on public.admin_notes;
create policy notes_read_admin_or_visible_student on public.admin_notes for select to authenticated
using (public.is_admin() or (student_id=auth.uid() and visible_to_student=true));
drop policy if exists notes_insert_admin_only on public.admin_notes;
create policy notes_insert_admin_only on public.admin_notes for insert to authenticated
with check (public.is_admin() and author_id=auth.uid());

drop policy if exists messages_read_participants on public.messages;
create policy messages_read_participants on public.messages for select to authenticated
using (sender_id=auth.uid() or receiver_id=auth.uid() or public.is_admin());
drop policy if exists messages_insert_sender on public.messages;
create policy messages_insert_sender on public.messages for insert to authenticated
with check (sender_id=auth.uid() and sender_id<>receiver_id);
drop policy if exists messages_update_read_status on public.messages;
create policy messages_update_read_status on public.messages for update to authenticated
using (receiver_id=auth.uid() or public.is_admin())
with check (receiver_id=auth.uid() or public.is_admin());

drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select to authenticated
using (public.is_admin());
drop policy if exists audit_insert_admin on public.audit_logs;
create policy audit_insert_admin on public.audit_logs for insert to authenticated
with check (actor_id=auth.uid() and public.is_admin());

-- Enable realtime publication for chat and admin changes.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.admin_notes;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.app_state;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

-- Create auth users from Supabase Dashboard > Authentication > Users.
-- Then insert/update profile rows below, replacing UUIDs with actual auth.users IDs.
-- Example:
-- insert into public.profiles(id,display_name,role)
-- values ('ADMIN_AUTH_USER_UUID','مدیر','admin'),
--        ('STUDENT_AUTH_USER_UUID','ملیکا','student')
-- on conflict (id) do update set display_name=excluded.display_name, role=excluded.role;
