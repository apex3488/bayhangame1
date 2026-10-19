-- Admin functions were executable by anon through PostgreSQL's default PUBLIC grant.
-- They already refused (not_authenticated / forbidden), but anonymous callers must not reach them at all.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname <> 'registration_check'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
