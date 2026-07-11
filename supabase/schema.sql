-- KantoForge HQ — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

-- ---------------------------------------------------------------------------
-- Team profiles (one row per auth user, created automatically on signup)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  badges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- The very first person to sign up becomes the admin (that's you).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    case when not exists (select 1 from public.profiles) then 'admin' else 'member' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- security definer so RLS policies can check admin-ness without recursing
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Business data. The app keeps full objects in jsonb `data`; the extra
-- columns exist for ordering and future SQL reporting.
-- ---------------------------------------------------------------------------
create table public.orders (
  id text primary key,
  platform text,
  order_date timestamptz,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.product_costs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.fixed_costs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.monthly_figures (
  id text primary key, -- "YYYY-MM"
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.commissions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.competitions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.raffle_entries (
  id text primary key,
  competition_id text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index raffle_entries_comp on public.raffle_entries (competition_id);

insert into public.app_settings (id, data) values (1, '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- Row Level Security: this is a single-team app — any signed-in teammate can
-- read and write business data. Only admins can change other people's role.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.product_costs enable row level security;
alter table public.fixed_costs enable row level security;
alter table public.tasks enable row level security;
alter table public.app_settings enable row level security;
alter table public.monthly_figures enable row level security;
alter table public.commissions enable row level security;
alter table public.competitions enable row level security;
alter table public.raffle_entries enable row level security;

create policy "team can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admins update any profile" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "team full access" on public.orders
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.product_costs
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.fixed_costs
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.tasks
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.app_settings
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.monthly_figures
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.commissions
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.competitions
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.raffle_entries
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: lets everyone's dashboard update live when a teammate changes data
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.orders,
  public.product_costs,
  public.fixed_costs,
  public.tasks,
  public.app_settings,
  public.monthly_figures,
  public.commissions,
  public.competitions,
  public.raffle_entries,
  public.profiles;
