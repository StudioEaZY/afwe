-- AFWE Supabase Production Schema
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/phtyjpwhtvmtqkzidxjp/sql

-- 1. Real Seat Pool Telemetry
create table if not exists public.seat_pool (
  id integer primary key default 1,
  total_seats integer not null default 1000,
  claimed_seats integer not null default 5,
  max_cap integer not null default 5000,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Seed real initial seat data (1,000 initial seats, 5 claimed, 995 open)
insert into public.seat_pool (id, total_seats, claimed_seats, max_cap)
values (1, 1000, 5, 5000)
on conflict (id) do update set
  total_seats = excluded.total_seats,
  claimed_seats = excluded.claimed_seats,
  max_cap = excluded.max_cap;

-- 2. Roadmap Proposals
create table if not exists public.roadmap_proposals (
  id text primary key,
  title text not null,
  category text not null,
  phase text not null,
  votes_count integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Seed initial proposals
insert into public.roadmap_proposals (id, title, category, phase, votes_count) values
  ('editor-support', 'Better editor support', 'Ecosystem', 'Phase 5', 1240),
  ('team-collab', 'Team collaboration', 'Ecosystem', 'Phase 5', 892),
  ('advanced-analytics', 'Advanced analytics', 'Beyond', 'Phase 5+', 437),
  ('sustainer-gate', 'Sustainer Gate (v1)', 'Community', 'Phase 4', 612),
  ('points-system', 'Monthly Points System', 'Community', 'Phase 4', 538),
  ('expanded-integrations', 'Expanded Integrations', 'Beyond', 'Phase 5', 310)
on conflict (id) do nothing;

-- 3. Anonymous & Claimed Voter Sessions (2-Tier Guard)
create table if not exists public.roadmap_votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id text references public.roadmap_proposals(id) on delete cascade not null,
  voter_id text not null,
  is_verified boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (proposal_id, voter_id)
);

-- 4. Enable Row Level Security (RLS)
alter table public.seat_pool enable row level security;
alter table public.roadmap_proposals enable row level security;
alter table public.roadmap_votes enable row level security;

-- Policies
create policy "Allow public read seat_pool" on public.seat_pool for select using (true);
create policy "Allow public read roadmap_proposals" on public.roadmap_proposals for select using (true);
create policy "Allow public insert roadmap_votes" on public.roadmap_votes for insert with check (true);
create policy "Allow public select roadmap_votes" on public.roadmap_votes for select using (true);

-- Atomic upvote function
create or replace function public.upvote_proposal(p_proposal_id text, p_voter_id text, p_is_verified boolean default false)
returns json
language plpgsql
security definer
as $$
declare
  v_new_votes integer;
begin
  -- Check if already voted
  if exists (select 1 from public.roadmap_votes where proposal_id = p_proposal_id and voter_id = p_voter_id) then
    select votes_count into v_new_votes from public.roadmap_proposals where id = p_proposal_id;
    return json_build_object('success', false, 'message', 'Already upvoted', 'votes', v_new_votes);
  end if;

  -- Record vote
  insert into public.roadmap_votes (proposal_id, voter_id, is_verified)
  values (p_proposal_id, p_voter_id, p_is_verified);

  -- Increment counter
  update public.roadmap_proposals
  set votes_count = votes_count + 1
  where id = p_proposal_id
  returning votes_count into v_new_votes;

  return json_build_object('success', true, 'votes', v_new_votes);
end;
$$;
