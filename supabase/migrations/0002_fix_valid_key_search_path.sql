-- Supabase security advisor 0011 (function_search_path_mutable):
-- pin search_path on the only function created without one.
alter function public._valid_key(text) set search_path = public;
