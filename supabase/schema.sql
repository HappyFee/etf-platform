create table if not exists public.strategy_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  strategies jsonb not null,
  active_strategy_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.strategy_workspaces enable row level security;

drop policy if exists "Users can read own workspace"
on public.strategy_workspaces;

create policy "Users can read own workspace"
on public.strategy_workspaces
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own workspace"
on public.strategy_workspaces;

create policy "Users can insert own workspace"
on public.strategy_workspaces
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own workspace"
on public.strategy_workspaces;

create policy "Users can update own workspace"
on public.strategy_workspaces
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.touch_strategy_workspace_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strategy_workspaces_touch_updated_at
on public.strategy_workspaces;

create trigger strategy_workspaces_touch_updated_at
before update on public.strategy_workspaces
for each row
execute function public.touch_strategy_workspace_updated_at();
