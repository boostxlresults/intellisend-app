-- =====================================================================
-- IntelliSend audience layer on the ServiceTitan mirror (idesign-prod)
-- =====================================================================
-- Purpose: one row per ServiceTitan customer with the best reachable
-- phone, consent tier, lifecycle segment, and overlay flags. IntelliSend
-- reads this hourly and turns it into system-owned tags.
--
-- Safety:
--   * Additive only. Creates schema `audience`; touches nothing in raw/sync.
--   * Reads raw.st_objects; never writes to it.
--   * IntelliSend gets a login that can SELECT these views and run the
--     refresh function. It cannot see raw.*, archive.*, or anything else.
--
-- Apply manually after review. Set the role password out of band:
--   ALTER ROLE intellisend_reader WITH PASSWORD '<generated>';
-- =====================================================================

create schema if not exists audience;

-- The JSON filters below make Postgres badly underestimate row counts
-- (it expects ~3 rows where there are ~65k) and pick nested-loop joins
-- that never finish. Hash joins build the whole layer in about 70s.
set enable_nestloop = off;

-- ---------------------------------------------------------------------
-- Every phone we know per customer, ranked. Lower rank = better.
--   1 customer MobilePhone   2 customer Phone
--   3 location MobilePhone   4 location Phone
--   5 most recent inbound call caller ID (no contact record exists)
-- ---------------------------------------------------------------------
drop materialized view if exists audience.customer_profile;
drop view if exists audience.do_not_text_phones;
drop materialized view if exists audience.customer_phones;
create materialized view audience.customer_phones as
with loc as (
  select st_id as location_id, (payload->>'customerId')::bigint as customer_id
  from raw.st_objects
  where domain = 'locations' and not coalesce(is_tombstone, false)
),
contact_phones as (
  select (o.payload->>'customerId')::bigint as customer_id,
         right(regexp_replace(o.payload->>'value', '\D', '', 'g'), 10) as phone,
         case when o.payload->>'type' = 'MobilePhone' then 1 else 2 end as rank,
         coalesce((o.payload->'phoneSettings'->>'doNotText')::boolean, false) as do_not_text,
         'st_customer_contact'::text as source
  from raw.st_objects o
  where o.domain = 'customer-contacts' and not coalesce(o.is_tombstone, false)
    and o.payload->>'type' in ('MobilePhone', 'Phone')
  union all
  select l.customer_id,
         right(regexp_replace(o.payload->>'value', '\D', '', 'g'), 10),
         case when o.payload->>'type' = 'MobilePhone' then 3 else 4 end,
         coalesce((o.payload->'phoneSettings'->>'doNotText')::boolean, false),
         'st_location_contact'
  from raw.st_objects o
  join loc l on l.location_id = (o.payload->>'locationId')::bigint
  where o.domain = 'location-contacts' and not coalesce(o.is_tombstone, false)
    and o.payload->>'type' in ('MobilePhone', 'Phone')
),
call_phones as (
  select distinct on (customer_id, phone)
         customer_id, phone, 5 as rank, false as do_not_text, 'st_call_history'::text as source
  from (
    select (payload->'customer'->>'id')::bigint as customer_id,
           right(regexp_replace(payload->>'from', '\D', '', 'g'), 10) as phone,
           (payload->>'createdOn')::timestamptz as called_at
    from raw.st_objects
    where domain = 'calls' and not coalesce(is_tombstone, false)
      and payload->>'direction' = 'Inbound'
      and payload->'customer'->>'id' is not null
  ) c
  where length(phone) = 10
  order by customer_id, phone, called_at desc
)
select customer_id, phone, rank, do_not_text, source
from contact_phones
where length(phone) = 10
union all
select customer_id, phone, rank, do_not_text, source from call_phones;

create index if not exists customer_phones_customer_idx on audience.customer_phones (customer_id);
create index if not exists customer_phones_phone_idx on audience.customer_phones (phone);
analyze audience.customer_phones;

comment on materialized view audience.customer_phones is
  'All known phones per ServiceTitan customer, ranked 1 (best) to 5. do_not_text comes from ServiceTitan phoneSettings.';

-- ---------------------------------------------------------------------
-- Phones flagged doNotText anywhere in ServiceTitan. IntelliSend loads
-- these into its suppression list so they are never texted, even if
-- the same number shows up on another record.
-- ---------------------------------------------------------------------
create or replace view audience.do_not_text_phones as
select distinct phone
from audience.customer_phones
where do_not_text;

-- ---------------------------------------------------------------------
-- One row per active ServiceTitan customer. Materialized because it
-- aggregates ~500k job/invoice/estimate rows; refreshed hourly via
-- audience.refresh().
-- ---------------------------------------------------------------------
create materialized view audience.customer_profile as
with
cust as (
  select st_id as customer_id, payload as p
  from raw.st_objects
  where domain = 'customers'
    and not coalesce(is_tombstone, false)
    and coalesce((payload->>'active')::boolean, false)
    and payload->>'mergedToId' is null
),
jobs as (
  select (payload->>'customerId')::bigint as customer_id,
         (payload->>'completedOn')::timestamptz as completed_on,
         (payload->>'businessUnitId')::bigint as bu
  from raw.st_objects
  where domain = 'jobs' and not coalesce(is_tombstone, false)
    and payload->>'jobStatus' = 'Completed'
),
jagg as (
  select customer_id,
         max(completed_on) as last_completed_job_at,
         count(*) as completed_jobs,
         -- Business units: 38050 HVAC Sales, 38177 HVAC Install, 38298 HVAC Service Repair,
         -- 100004 HVAC Scheduled Service, 38296 Plumbing, 63273843 Electrical,
         -- 63273971 PV Solar, 70034293 Roofing. 38297 G&A is ignored.
         bool_or(bu in (38050, 38177, 38298, 100004)) as did_hvac,
         bool_or(bu = 38296) as did_plumbing,
         bool_or(bu = 63273843) as did_electrical,
         bool_or(bu = 63273971) as did_solar,
         bool_or(bu = 70034293) as did_roofing,
         max(completed_on) filter (where bu = 38177) as last_hvac_install_at
  from jobs
  group by customer_id
),
inv as (
  select (payload->'customer'->>'id')::bigint as customer_id,
         sum((payload->>'total')::numeric) as lifetime_value
  from raw.st_objects
  where domain = 'invoices' and not coalesce(is_tombstone, false)
    and coalesce((payload->>'active')::boolean, false)
  group by 1
),
mem as (
  select (payload->>'customerId')::bigint as customer_id,
         bool_or(payload->>'status' = 'Active') as has_active_membership
  from raw.st_objects
  where domain = 'memberships' and not coalesce(is_tombstone, false)
  group by 1
),
est as (
  select (payload->>'customerId')::bigint as customer_id,
         sum((payload->>'subtotal')::numeric) as open_estimate_total,
         max((payload->>'createdOn')::timestamptz) as last_open_estimate_at
  from raw.st_objects
  where domain = 'estimates' and not coalesce(is_tombstone, false)
    and coalesce((payload->>'active')::boolean, false)
    and payload->'status'->>'name' = 'Open'
    and (payload->>'createdOn')::timestamptz > now() - interval '18 months'
  group by 1
),
best_phone as (
  select distinct on (customer_id) customer_id, phone, source, rank
  from audience.customer_phones
  where not do_not_text
  order by customer_id, rank, phone
),
phone_flags as (
  select customer_id,
         bool_or(do_not_text) as any_do_not_text,
         bool_and(do_not_text) filter (where rank <= 4) as all_st_numbers_do_not_text
  from audience.customer_phones
  group by 1
),
emails as (
  select distinct on (customer_id) customer_id, email
  from (
    select (payload->>'customerId')::bigint as customer_id, lower(trim(payload->>'value')) as email, 1 as rank
    from raw.st_objects
    where domain = 'customer-contacts' and not coalesce(is_tombstone, false) and payload->>'type' = 'Email'
    union all
    select (l.payload->>'customerId')::bigint, lower(trim(o.payload->>'value')), 2
    from raw.st_objects o
    join raw.st_objects l on l.domain = 'locations' and l.st_id = (o.payload->>'locationId')::bigint
    where o.domain = 'location-contacts' and not coalesce(o.is_tombstone, false) and o.payload->>'type' = 'Email'
  ) e
  where email like '%@%.%'
  order by customer_id, rank
),
base as (
  select
    c.customer_id,
    c.p->>'name' as customer_name,
    c.p->>'type' as customer_type,
    coalesce((c.p->>'doNotService')::boolean, false) as do_not_service,
    coalesce((c.p->>'doNotMail')::boolean, false) as do_not_mail,
    (c.p->>'createdOn')::timestamptz as customer_created_at,
    c.p->'address'->>'street' as street,
    c.p->'address'->>'unit' as unit,
    c.p->'address'->>'city' as city,
    c.p->'address'->>'state' as state,
    left(c.p->'address'->>'zip', 5) as zip,
    bp.phone as best_phone,
    bp.source as best_phone_source,
    coalesce(pf.any_do_not_text, false) as any_do_not_text,
    coalesce(pf.all_st_numbers_do_not_text, false) as all_st_numbers_do_not_text,
    em.email,
    j.last_completed_job_at,
    coalesce(j.completed_jobs, 0) as completed_jobs,
    coalesce(j.did_hvac, false) as did_hvac,
    coalesce(j.did_plumbing, false) as did_plumbing,
    coalesce(j.did_electrical, false) as did_electrical,
    coalesce(j.did_solar, false) as did_solar,
    coalesce(j.did_roofing, false) as did_roofing,
    j.last_hvac_install_at,
    coalesce(i.lifetime_value, 0) as lifetime_value,
    coalesce(m.has_active_membership, false) as has_active_membership,
    (m.customer_id is not null) as has_any_membership,
    e.open_estimate_total,
    e.last_open_estimate_at
  from cust c
  left join jagg j on j.customer_id = c.customer_id
  left join inv i on i.customer_id = c.customer_id
  left join mem m on m.customer_id = c.customer_id
  left join est e on e.customer_id = c.customer_id
  left join best_phone bp on bp.customer_id = c.customer_id
  left join phone_flags pf on pf.customer_id = c.customer_id
  left join emails em on em.customer_id = c.customer_id
)
select
  b.*,
  -- Name split for SMS personalization. ServiceTitan stores one name string;
  -- a few legacy records use "Last, First".
  case
    when b.customer_type = 'Commercial' then b.customer_name
    when b.customer_name like '%,%' then trim(split_part(b.customer_name, ',', 2))
    else split_part(trim(b.customer_name), ' ', 1)
  end as first_name,
  case
    when b.customer_type = 'Commercial' then ''
    when b.customer_name like '%,%' then trim(split_part(b.customer_name, ',', 1))
    else trim(substr(trim(b.customer_name), length(split_part(trim(b.customer_name), ' ', 1)) + 1))
  end as last_name,
  -- SMS tier: A = number recorded in ServiceTitan and not doNotText,
  -- B = only known from inbound call caller ID, X = every ST number is doNotText,
  -- Z = no phone anywhere.
  case
    when b.best_phone_source in ('st_customer_contact', 'st_location_contact') then 'A'
    when b.all_st_numbers_do_not_text then 'X'
    when b.best_phone_source = 'st_call_history' then 'B'
    else 'Z'
  end as sms_tier,
  -- Lifecycle segment: mutually exclusive, first match wins.
  case
    when b.has_active_membership then '1_active_member'
    when b.has_any_membership then '2_lapsed_member'
    when b.open_estimate_total is not null then '3_open_estimate'
    when b.last_completed_job_at > now() - interval '12 months' then '4_recent'
    when b.last_completed_job_at > now() - interval '36 months' then '5_warm'
    when b.last_completed_job_at is not null then '6_dormant'
    when b.customer_created_at > now() - interval '36 months' then '7a_never_converted'
    when b.customer_created_at < timestamptz '2015-01-01' then '7b_legacy'
    else '7c_never_serviced'
  end as lifecycle_segment,
  -- Overlay flags
  (b.lifetime_value >= 12000) as is_high_value,
  (b.did_hvac and not b.did_plumbing) as is_hvac_only,
  (b.did_plumbing and not b.did_hvac) as is_plumbing_only,
  (b.last_hvac_install_at < now() - interval '8 years') as has_aging_install,
  now() as refreshed_at
from base b;

create unique index if not exists customer_profile_pk on audience.customer_profile (customer_id);
create index if not exists customer_profile_segment_idx on audience.customer_profile (lifecycle_segment);
create index if not exists customer_profile_phone_idx on audience.customer_profile (best_phone);

-- ---------------------------------------------------------------------
-- Refresh. SECURITY DEFINER so the read-only IntelliSend login can
-- trigger it without owning the view or reading raw.*.
-- ---------------------------------------------------------------------
create or replace function audience.refresh()
returns timestamptz
language plpgsql
security definer
set search_path = audience, pg_temp
set enable_nestloop = off
as $$
begin
  -- Phones first (plain refresh: no unique key, brief lock is fine),
  -- then the profile without blocking readers.
  refresh materialized view audience.customer_phones;
  analyze audience.customer_phones;
  refresh materialized view concurrently audience.customer_profile;
  return now();
end;
$$;

revoke all on function audience.refresh() from public;

-- ---------------------------------------------------------------------
-- Read-only login for IntelliSend.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'intellisend_reader') then
    create role intellisend_reader login;
  end if;
end;
$$;

grant usage on schema audience to intellisend_reader;
grant select on audience.customer_profile, audience.do_not_text_phones to intellisend_reader;
grant execute on function audience.refresh() to intellisend_reader;
-- customer_phones is intentionally NOT granted: IntelliSend only needs the best phone.
-- The refresh takes ~70s today; leave headroom as the base grows.
alter role intellisend_reader set statement_timeout = '10min';

reset enable_nestloop;
