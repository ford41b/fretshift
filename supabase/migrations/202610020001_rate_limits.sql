-- Fixed-window rate limits and quotas for Edge Functions (password-signup,
-- vision-import, and future paid-API functions).
--
-- Only the service role can reach the table or the RPC. Edge Functions call
-- consume_rate_limit with SUPABASE_SERVICE_ROLE_KEY; browsers cannot read or
-- reset counters. Bucket keys are opaque (callers hash emails and IPs).

create table if not exists public.rate_limit_counters (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (bucket, window_start)
);
alter table public.rate_limit_counters enable row level security;
-- No policies: RLS denies every non-owner role. Revoke grants as well.
revoke all on public.rate_limit_counters from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_cost integer,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_hits integer;
  v_retry integer;
begin
  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 200 then
    raise exception 'invalid rate limit bucket';
  end if;
  if p_cost is null or p_cost < 1
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_retry := greatest(
    1,
    ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer
  );

  -- A request larger than the whole budget can never succeed in this window.
  if p_cost > p_limit then
    return query select false, p_limit, v_retry;
    return;
  end if;

  -- Atomic consume: the conditional upsert only increments while the new total
  -- stays within the limit, so a denied request consumes nothing and two
  -- concurrent callers cannot both take the last unit.
  insert into public.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, v_window, p_cost)
  on conflict (bucket, window_start)
    do update set hits = c.hits + excluded.hits
    where c.hits + excluded.hits <= p_limit
  returning c.hits into v_hits;

  if v_hits is null then
    select c.hits into v_hits
    from public.rate_limit_counters c
    where c.bucket = p_bucket and c.window_start = v_window;
    return query select false, coalesce(v_hits, p_limit), v_retry;
    return;
  end if;

  -- Opportunistic cleanup keeps the table small without a scheduler.
  if random() < 0.01 then
    delete from public.rate_limit_counters
    where window_start < v_now - interval '2 days';
  end if;

  return query select true, v_hits, 0;
end
$$;

revoke all on function public.consume_rate_limit(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer, integer)
  to service_role;
