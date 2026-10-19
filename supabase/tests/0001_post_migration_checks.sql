-- Run in the Supabase SQL Editor AFTER migrations/0001_core_economy.sql.
-- Every row must show ok = true. Read-only: it changes no data.

-- 1. RLS is enabled on every application table.
select 'rls_enabled' as check_name,
       bool_and(c.relrowsecurity) as ok,
       string_agg(c.relname, ', ') filter (where not c.relrowsecurity) as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';

-- 2. Helper functions are NOT executable by anon or authenticated.
select 'helpers_not_public' as check_name,
       not exists (
         select 1
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname like '\_%'
            and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
       ) as ok;

-- 3. Clients cannot write financial tables directly.
select 'no_client_writes' as check_name,
       not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public'
            and grantee in ('anon', 'authenticated')
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       ) as ok;

-- 4. Starting capital setting is exactly 50000.00.
select 'starting_capital_50000' as check_name,
       (select value from public.economy_settings where key = 'starting_capital') = 50000.00 as ok;

-- 5. Every profile has exactly one wallet and one signup_bonus ledger entry.
select 'signup_bonus_once_per_player' as check_name,
       not exists (
         select 1 from public.profiles p
          where (select count(*) from public.ledger_entries l
                  where l.user_id = p.id and l.op_type = 'signup_bonus') <> 1
       ) as ok;

-- 6. Wallet balances equal the sum of their journal entries.
select 'wallets_match_journal' as check_name,
       not exists (
         select 1 from public.wallets w
          where w.bank <> coalesce((
                  select sum(case when l.direction = 'credit' then l.amount else -l.amount end)
                    from public.ledger_entries l
                   where l.user_id = w.user_id and l.account = 'bank'), 0)
             or w.cash <> coalesce((
                  select sum(case when l.direction = 'credit' then l.amount else -l.amount end)
                    from public.ledger_entries l
                   where l.user_id = w.user_id and l.account = 'cash'), 0)
       ) as ok;
