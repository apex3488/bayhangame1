-- BTC wallet account (bot: btc_balance). A new enum value must be committed
-- before it can be used, so it lives in its own migration.
alter type public.ledger_account add value if not exists 'btc';
