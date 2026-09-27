-- Tickertape schema. Every analysis of a filing is a run; every agent step
-- in a run is a trace event; every graded figure is an eval score.

create table if not exists filings (
  accession_number text primary key,
  ticker text not null,
  cik int not null,
  company_name text not null,
  form text not null default '10-K',
  period_end date not null,
  filing_date date not null,
  url text not null,
  -- 'golden_set' for the eval's filings, 'live' for anything analyzed
  -- from the dashboard.
  source text not null default 'live' check (source in ('golden_set', 'live')),
  created_at timestamptz not null default now()
);
create index if not exists filings_ticker_idx on filings(ticker);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  accession_number text not null references filings(accession_number),
  model text not null,
  prompt_version text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  -- The figures the pipeline settled on, with provenance, as one document
  -- so the dashboard can render a run without replaying its trace.
  result jsonb,
  checks_passed int,
  checks_total int,
  retry_count int not null default 0,
  total_cost_usd numeric not null default 0,
  total_latency_ms int not null default 0,
  error text
);
create index if not exists runs_accession_idx on runs(accession_number, started_at desc);

create table if not exists trace_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  agent_name text not null,
  step_index int not null,
  parent_step_index int,
  input jsonb,
  output jsonb,
  tool_calls jsonb,
  tokens_in int default 0,
  tokens_out int default 0,
  cost_usd numeric default 0,
  latency_ms int default 0,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists trace_events_run_idx on trace_events(run_id, step_index);

create table if not exists eval_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  accession_number text not null references filings(accession_number),
  field text not null,
  expected numeric,
  actual numeric,
  -- 'correct', 'wrong_value', 'wrong_sign', 'missing', 'not_scored'
  outcome text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eval_scores_run_idx on eval_scores(run_id);
