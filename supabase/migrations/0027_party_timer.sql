-- 0027: timer for the chat party games. pg_cron calls the telegram-bot Edge Function every 10 s
-- with {"tick": true}, but only when some game's phase deadline has passed, so an idle bot makes
-- no calls at all. The request carries the webhook secret from Vault (same check as Telegram's).
-- Rollback: select cron.unschedule('telegram-bot-tick');
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.tg_party_tick()
returns void language plpgsql security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.tg_party_games where finished_at is null and deadline < now()) then return; end if;
  perform net.http_post(
    url := 'https://byjhzqpchxvzssipjfnh.supabase.co/functions/v1/telegram-bot',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-telegram-bot-api-secret-token', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_webhook_secret')),
    body := '{"tick": true}'::jsonb,
    timeout_milliseconds := 20000);
end $$;
revoke all on function public.tg_party_tick() from public, anon, authenticated;

select cron.unschedule('telegram-bot-tick') where exists (select 1 from cron.job where jobname = 'telegram-bot-tick');
select cron.schedule('telegram-bot-tick', '10 seconds', 'select public.tg_party_tick()');
