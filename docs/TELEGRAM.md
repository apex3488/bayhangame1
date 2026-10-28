# BAYHAN GAME в Telegram: бот, Mini App, единый аккаунт

Один игрок — один аккаунт — одна экономика: браузер, Mini App и бот работают с одной базой Supabase и одними SQL-функциями.

## Архитектура

```
Браузер  https://bayhangame1.vercel.app ──────────────┐  сессия Supabase (JWT игрока)
Mini App  тот же сайт, вход через /tg ────────────────┤  → RPC игры (auth.uid())
                       │ initData (подпись Telegram)   │
                       ▼                               ▼
        Edge Function telegram-auth ──────────► Supabase Postgres (единственный источник истины)
Telegram ─webhook─► Edge Function telegram-bot ─► tg_call() → те же RPC от имени привязанного игрока
```

| Часть | Где | Файлы |
|---|---|---|
| Игра и Mini App | Vercel (`main` → автодеплой) | `app/tg/page.tsx`, `components/telegram-bridge.tsx`, `components/telegram-card.tsx`, `lib/telegram.ts` |
| Вход через Telegram | Supabase Edge Function `telegram-auth` | `supabase/functions/telegram-auth/index.ts` |
| Бот | Supabase Edge Function `telegram-bot` (webhook) | `supabase/functions/telegram-bot/index.ts` |
| Общий код функций | — | `supabase/functions/_shared/telegram.ts` |
| База | Supabase | `supabase/migrations/0023_telegram.sql`, `0024_telegram_link_code_fix.sql` |

### Вход в Mini App

1. Telegram открывает `https://bayhangame1.vercel.app/tg` и передаёт подписанный `initData`.
   SDK `telegram-web-app.js` загружается **только** внутри Telegram; обычный браузер его не грузит.
2. `/tg` отправляет `initData` в `telegram-auth`. Функция проверяет подпись по официальному алгоритму
   (HMAC-SHA256, ключ `HMAC_SHA256("WebAppData", bot_token)`, все поля кроме `hash`, отсортированы),
   возраст `auth_date` (не старше 1 часа), формат `user.id`. Токен бота хранится в Supabase Vault и в браузер не попадает.
3. Telegram id привязан → функция выдаёт одноразовый токен (`generateLink`), клиент меняет его на обычную сессию
   Supabase (`verifyOtp`). Дальше Mini App — это обычная игра с обычной сессией: все проверки делают те же RPC.
4. Не привязан → экран выбора: «Я новый игрок» (имя → аккаунт) или «У меня уже есть аккаунт»
   (вход логином и паролем → привязка). Привязка требует доказать **обе** стороны: подпись Telegram и сессию игрока.

Если в Mini App сохранилась сессия другого игрока, она заменяется аккаунтом этого Telegram-пользователя.

### Привязка браузерного аккаунта

- Из браузера: Профиль → Telegram → «Привязать Telegram» → кнопка открывает `t.me/BayhanGame2_bot?start=link_<код>`.
  Код из 10 символов (~50 бит), одноразовый, живёт 10 минут, не больше 10 в час.
- Из Mini App: «У меня уже есть аккаунт» → логин и пароль.
- Автоматического слияния по имени или username **нет**. Один Telegram — максимум один аккаунт и наоборот (уникальные ключи).
- Аккаунт, созданный в Telegram, получает логин `tg<telegram_id>`. Пароль для браузера задаётся в Профиле.

### Бот

Кнопки: 🎮 Играть (Mini App), 👤 Профиль, 💰 Баланс, 🎁 Ежедневная награда, 🏆 Рейтинг, 📋 Задания, 👥 Пригласить друга, ℹ️ Помощь.
Команды: `/start /play /profile /balance /daily /top /tasks /invite /help`, скрытая `/admin` (только у ролей из `admin_roles`;
остальным отвечает как на неизвестную команду). Кнопка меню чата открывает Mini App.

- `/start` для нового человека **не** создаёт аккаунт молча: предлагает «Создать аккаунт» или «У меня уже есть аккаунт».
  `/start ref_<код>` передаёт реферальный код в регистрацию, `/start link_<код>` привязывает браузерный аккаунт.
- Повторный `/start`, двойное нажатие «Создать», перезапуск функции — дубликатов нет: логин `tg<id>` уникален в базе.
- Защита webhook: секретный заголовок `X-Telegram-Bot-Api-Secret-Token` (из Vault), повторно доставленный `update_id`
  обрабатывается один раз, лимит 30 действий в минуту на пользователя, только личные чаты.

### Синхронизация

Сервер — единственный источник истины, клиенты ничего не хранят у себя.

| Действие | Как другие интерфейсы видят изменение |
|---|---|
| Любая операция в браузере или Mini App | RPC пишет в базу в одной транзакции; бот читает ту же базу при следующем сообщении |
| Действие в боте (ежедневная награда) | та же `claim_daily`; игра перечитывает состояние при открытии и при каждом возврате в окно (`visibilitychange`/`focus`) |
| Одновременная игра в двух местах | функции игры блокируют строку игрока (`for update`), проверяют средства и пишут журнал атомарно; ключи идемпотентности не дают повторить начисление |

WebSocket не добавлен: перечитывания при возврате достаточно, лишняя инфраструктура не нужна.

### Безопасность

- Служебные функции `tg_*` доступны только `service_role` (Edge Functions). Игрок не может вызвать `tg_call` от чужого имени,
  прочитать токен (`tg_config`) или привязать чужой аккаунт — это проверяют тесты.
- Клиент не передаёт ни user id, ни баланс, ни цену: личность берётся из подписи Telegram или из JWT Supabase, цены — из базы.
- Лимиты: вход через Telegram — 20 запросов в минуту на пользователя, бот — 30.
- В логи не пишутся токены, `initData` и тела запросов.

## Переменные и секреты

| Где | Имя | Значение |
|---|---|---|
| `.env.local` / Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | как раньше |
| `.env.local` / Vercel (необязательно) | `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | по умолчанию `BayhanGame2_bot` |
| `.env.local` (только для скриптов) | `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` | миграции, тесты, `telegram:setup` |
| Supabase Vault | `telegram_bot_token`, `telegram_webhook_secret` | читают только Edge Functions |
| Edge Functions (необязательно) | `BAYHAN_SITE_URL`, `TELEGRAM_BOT_USERNAME` | по умолчанию production-адрес и `BayhanGame2_bot` |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase передаёт функциям сам. Реальные значения в git не попадают (`.env*` в `.gitignore`).

## Запуск и деплой

```bash
npm install
```
```bash
npm run dev
```
Игра — http://localhost:3000. Mini App локально: откройте `/tg` с тестовым `#tgWebAppData=…`
(`node scripts/tg-initdata.mjs <id>` печатает подписанные данные; функция `telegram-auth` разрешает CORS для `localhost:3000`).
Для теста в настоящем Telegram нужен HTTPS-адрес: используйте production или превью Vercel, туннели — только для разработки.

**Миграции** (сначала копия):
```bash
npm run db:backup
```
```bash
npm run db:migrate
```

**Edge Functions** — из панели Supabase или CLI (`verify_jwt` выключен: функции проверяют initData и секрет webhook сами):
```bash
npx supabase functions deploy telegram-auth --no-verify-jwt --project-ref byjhzqpchxvzssipjfnh
```
```bash
npx supabase functions deploy telegram-bot --no-verify-jwt --project-ref byjhzqpchxvzssipjfnh
```

**Бот** (webhook, команды, кнопка меню, описание; можно запускать повторно):
```bash
npm run telegram:setup
```

**Игра и Mini App**: `git push` в `main` → Vercel собирает и публикует. Mini App обновляется вместе с сайтом.

**Проверка backend**: `POST https://byjhzqpchxvzssipjfnh.supabase.co/functions/v1/telegram-auth` с пустым телом → `401 invalid_init_data`
(функция жива); `getWebhookInfo` бота → без `last_error_message`; логи — Supabase → Edge Functions → Logs.

**Смена токена бота**: BotFather → /revoke, затем
`select vault.update_secret((select id from vault.secrets where name = 'telegram_bot_token'), '<новый токен>');`
в SQL Editor, новый токен в `.env.local`, `npm run telegram:setup`.

### BotFather (вручную, по желанию)

- `/mybots → BayhanGame2_bot → Bot Settings → Configure Mini App → Enable Mini App` и URL `https://bayhangame1.vercel.app/tg` —
  включает кнопку «Открыть» в профиле бота и ссылку `t.me/BayhanGame2_bot?startapp`.
- Кнопка меню, команды, описание уже выставлены через Bot API скриптом.
- Аватар бота: `/setuserpic` (через API его поставить нельзя).

## Резервная копия и восстановление

`npm run db:backup` сохраняет все таблицы `public` и нужные поля `auth.users` в `backups/<время>/*.json` (папка в `.gitignore`:
там хэши паролей). Копия перед миграцией 0023 — `backups/2026-10-28T08-57-26-016Z`.

Восстановление строк из копии — через `psql`/скрипт `insert … on conflict do nothing` по таблицам в порядке зависимостей
(`auth.users` → `profiles` → `wallets` → остальные), при отключённом триггере `ledger_entries_immutable` и только после
согласования. Откат миграции 0023 описан в её шапке (удаляет лишь новые таблицы и функции, игровые данные не трогает).
Полноценные ежедневные бэкапы с восстановлением на момент времени даёт тариф Supabase Pro.

## Тесты

| Набор | Команда | Результат 2026-10-28 |
|---|---|---|
| Telegram: initData, регистрация, привязка, гонки, награда, права, бот | `npm run test:tg` | **44/44** (реальные Edge Functions и база; тестовые игроки удаляются) |
| Экономика игры | `npm run test:db` | 146/146 (первый запуск оборвался на сетевом соединении, повтор — все прошли) |
| Админка и профиль | `npm run test:db:admin` | 76/76 |
| Crash и роскошь | `npm run test:db:crash` | 31/31 |
| Социальное | `npm run test:db:social` | 47/47 |
| Типы, сборка | `npm run typecheck`, `npm run build` | без ошибок |

Сценарии задания 1–16: новый игрок в боте (кнопка «Создать») и в Mini App; существующий игрок получает свой аккаунт;
проверенный initData; подделанные/просроченные/чужим токеном — 401; браузер и Mini App на одном аккаунте;
действие в браузере видно в боте и Mini App; награду нельзя взять дважды (в том числе параллельно и через разные интерфейсы);
5 параллельных регистраций → 1 аккаунт; чужие данные недоступны; баланс нельзя подменить; повторный /start и повтор update —
без дубликатов; `/admin` недоступен обычному игроку. Mini App на экране 375 px проверен в браузере (без горизонтальной прокрутки).
Не проверено автоматически: открытие внутри настоящих клиентов Telegram (Android/iOS/Desktop) — это делаете вы (ниже).

## Что осталось сделать вам

1. Открыть @BayhanGame2_bot в Telegram на телефоне: `/start` → «Играть», проверить вход, полноэкранный режим и кнопку «Назад».
2. Проверка одного аккаунта: в браузере Профиль → Telegram → «Привязать» → бот → в боте «💰 Баланс» = баланс в игре;
   заберите награду в боте → в браузере вернитесь на вкладку — баланс обновится, повторно забрать нельзя.
3. По желанию: BotFather → Configure Mini App (см. выше) и аватар бота.
4. Токен бота был отправлен в чат: если этот чат могли видеть другие, перевыпустите токен (раздел «Смена токена»).
