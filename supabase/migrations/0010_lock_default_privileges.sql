-- Defence in depth: clients never write tables directly (RLS already denies it).
-- Remove the write grants Supabase adds to new tables, and stop granting them
-- (and EXECUTE on new functions) by default. Every RPC is granted explicitly.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
