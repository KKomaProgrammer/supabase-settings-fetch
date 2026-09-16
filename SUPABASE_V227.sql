-- Entry Live Studio v2.2.7 account/recommendation schema
-- Run in Supabase Dashboard > SQL Editor once.

create extension if not exists pg_trgm;

create table if not exists public.entry_chat_accounts (
  id uuid primary key,
  nickname text not null check (char_length(nickname) between 1 and 24),
  nickname_normalized text not null unique,
  account_code_hash text not null unique check (account_code_hash ~ '^[0-9a-f]{64}$'),
  avatar_data_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entry_chat_account_devices (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.entry_chat_accounts(id) on delete cascade,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists entry_chat_account_devices_account_id_idx
  on public.entry_chat_account_devices(account_id);

create index if not exists entry_chat_accounts_nickname_trgm_idx
  on public.entry_chat_accounts using gin (nickname gin_trgm_ops);

create table if not exists public.entry_chat_room_recommendations (
  room_code text not null check (room_code ~ '^[0-9]{4}$'),
  target_account_id uuid not null references public.entry_chat_accounts(id) on delete cascade,
  sender_account_id uuid not null references public.entry_chat_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_code, target_account_id)
);

create table if not exists public.entry_chat_room_recommendation_blocks (
  room_code text not null check (room_code ~ '^[0-9]{4}$'),
  account_id uuid not null references public.entry_chat_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_code, account_id)
);

alter table public.entry_chat_accounts enable row level security;
alter table public.entry_chat_account_devices enable row level security;
alter table public.entry_chat_room_recommendations enable row level security;
alter table public.entry_chat_room_recommendation_blocks enable row level security;

-- Browser clients do not receive direct access to these policy tables.
-- Cloudflare Pages uses SUPABASE_SERVICE_ROLE_KEY and service_role bypasses RLS.
revoke all on table public.entry_chat_accounts from anon, authenticated;
revoke all on table public.entry_chat_account_devices from anon, authenticated;
revoke all on table public.entry_chat_room_recommendations from anon, authenticated;
revoke all on table public.entry_chat_room_recommendation_blocks from anon, authenticated;
