// Database-level end-to-end and abuse tests against the real Supabase schema.
// Everything runs inside ONE transaction that is rolled back at the end, so no
// test users, money or audit rows remain. Players are simulated by switching to
// the `authenticated` role with a JWT `sub` claim, exactly like PostgREST does.
import { connect } from "./db-env.mjs";

const c = await connect();
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const failed = (r, code) => typeof r.error === "string" && r.error.includes(code);
const okStatus = (r, status) => r.rows?.[0]?.r?.status === status;

async function makeUser(login, gameName) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $1, 'x', $2, now(), now())
     returning id`,
    [`${login}@players.bayhan.app`, { login, game_name: gameName }],
  );
  return rows[0].id;
}

/** Runs SQL as a logged-in player. Errors are returned, not thrown. */
async function asPlayer(uid, sql, params = []) {
  await c.query("savepoint p");
  try {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const { rows } = await c.query(sql, params);
    await c.query("reset role");
    await c.query("release savepoint p");
    return { rows };
  } catch (e) {
    await c.query("rollback to savepoint p");
    await c.query("reset role");
    return { error: e.message };
  }
}

/** Runs SQL as the database owner, returning the error message instead of throwing. */
async function asOwner(sql, params = []) {
  await c.query("savepoint o");
  try {
    const { rows } = await c.query(sql, params);
    await c.query("release savepoint o");
    return { rows };
  } catch (e) {
    await c.query("rollback to savepoint o");
    return { error: e.message };
  }
}

const snapshot = async (uid) => (await asPlayer(uid, "select get_my_snapshot() s")).rows[0].s;

await c.query("begin");
try {
  // --- Registration and starting capital ---------------------------------
  const alice = await makeUser("e2e_alice", "E2E Alice");
  const bob = await makeUser("e2e_bob", "E2E Bob");
  let s = await snapshot(alice);
  check("signup gives exactly $50,000 in the wallet", Number(s.cash) === 50000 && Number(s.bank) === 0, JSON.stringify(s));
  check("total capital = cash + bank + assets - debts", Number(s.total_capital) === 50000);

  const dupLogin = await asOwner(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'x2@players.bayhan.app', '{"login":"e2e_alice","game_name":"Someone"}')`,
  );
  check("re-registration with same login rejected", dupLogin.error, dupLogin.error);
  const dupName = await asOwner(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'x3@players.bayhan.app', '{"login":"e2e_other","game_name":"e2e alice"}')`,
  );
  check("game name unique case-insensitively", dupName.error, dupName.error);
  const badLogin = await asOwner(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'x4@players.bayhan.app', '{"login":"<script>","game_name":"Valid"}')`,
  );
  check("invalid login rejected", failed(badLogin, "invalid_login"), badLogin.error);

  // --- Work shifts ---------------------------------------------------------
  const w1 = await asPlayer(alice, "select work_shift('courier', 'shift-key-0001') r");
  const pay = Number(w1.rows?.[0]?.r?.salary);
  check("courier shift pays within bot range $20,000–$50,000", okStatus(w1, "ok") && pay >= 20000 && pay <= 50000, JSON.stringify(w1));
  const w2 = await asPlayer(alice, "select work_shift('courier', 'shift-key-0001') r");
  check("replayed shift request is not paid twice", okStatus(w2, "duplicate") && Number(w2.rows[0].r.salary) === pay, JSON.stringify(w2));
  const w3 = await asPlayer(alice, "select work_shift('courier', 'shift-key-0002') r");
  check("cooldown enforced by server", failed(w3, "cooldown_active"), w3.error);
  const w4 = await asPlayer(alice, "select work_shift('mechanic', 'shift-key-0003') r");
  check("job capital requirement enforced ($500k for mechanic)", failed(w4, "need_capital"), w4.error);
  const w4b = await asPlayer(alice, "select work_shift('taxi', 'shift-key-0005') r");
  check("taxi requires a car", failed(w4b, "need_car"), w4b.error);
  const w5 = await asPlayer(alice, "select work_shift('waiter', 'shift-key-0004') r");
  check("retired job rejected", failed(w5, "job_not_found"), w5.error);
  const w6 = await asPlayer(alice, "select work_shift('courier', 'short') r");
  check("too-short idempotency key rejected", failed(w6, "invalid_idempotency_key"), w6.error);
  s = await snapshot(alice);
  check("balance after one shift = 50,000 + pay", Number(s.cash) === Math.round((50000 + pay) * 100) / 100, `${s.cash} vs ${pay}`);
  check("XP awarded once", Number(s.xp) === 10, s.xp);
  const jobs = await asPlayer(alice, "select key, eligible, blocker, next_available_at from my_jobs()");
  check("my_jobs lists 8 bot jobs with blockers", jobs.rows?.length === 8 && jobs.rows.find((j) => j.key === "taxi").blocker === "need_car"
    && jobs.rows.find((j) => j.key === "courier").next_available_at !== null, JSON.stringify(jobs.rows));

  // --- Daily reward --------------------------------------------------------
  const carol = await makeUser("e2e_carol", "E2E Carol");
  const d1 = await asPlayer(carol, "select claim_daily('daily-key-0001') r");
  check("daily reward pays base × streak 1 = $100,000", okStatus(d1, "ok") && Number(d1.rows[0].r.reward) === 100000, JSON.stringify(d1));
  const d2 = await asPlayer(carol, "select claim_daily('daily-key-0001') r");
  check("daily replay not paid twice", okStatus(d2, "duplicate"), JSON.stringify(d2));
  const d3 = await asPlayer(carol, "select claim_daily('daily-key-0002') r");
  check("daily blocked for 24h", failed(d3, "daily_already_claimed"), d3.error);
  await c.query("update profiles set last_daily_at = now() - interval '30 hours' where id = $1", [carol]);
  const d4 = await asPlayer(carol, "select claim_daily('daily-key-0003') r");
  check("streak grows within 48h (day 2 = $200,000)", Number(d4.rows?.[0]?.r?.reward) === 200000, JSON.stringify(d4));
  await c.query("update profiles set last_daily_at = now() - interval '50 hours' where id = $1", [carol]);
  const d5 = await asPlayer(carol, "select daily_status() s");
  check("streak resets after 48h", d5.rows?.[0]?.s?.streak === 1 && d5.rows[0].s.can_claim === true, JSON.stringify(d5));
  check("carol balance = 50,000 + 100,000 + 200,000", Number((await snapshot(carol)).cash) === 350000);

  // --- Registration check (anon) --------------------------------------------
  await c.query("savepoint rc");
  await c.query("set local role anon");
  const rc = (await c.query("select registration_check('E2E_ALICE', 'e2e bob') r")).rows[0].r;
  await c.query("reset role");
  await c.query("release savepoint rc");
  check("registration_check reports taken login and name (anon)", rc.login_taken === true && rc.name_taken === true, JSON.stringify(rc));

  // --- Betting games -------------------------------------------------------
  const games = [
    ["casino", "{}"], ["spin", "{}"], ["slots", "{}"], ["dice", '{"pick":3}'], ["updown", '{"direction":"up"}'],
    ["trade", '{"direction":"down"}'], ["basketball", "{}"], ["darts", "{}"], ["bowling", "{}"],
  ];
  let before = Number((await snapshot(carol)).cash);
  let expected = before;
  for (const [g, choice] of games) {
    for (let i = 0; i < 6; i++) {
      const r = await asPlayer(carol, "select play_game($1, 1000, $2::jsonb, $3) r", [g, choice, `game-${g}-${i}-key`]);
      const res = r.rows?.[0]?.r;
      if (!res || res.status !== "ok" || Number(res.payout) !== Math.round(1000 * Number(res.multiplier) * 100) / 100) {
        check(`${g} round settles with payout = bet × multiplier`, false, JSON.stringify(r));
        break;
      }
      expected += Number(res.payout) - 1000;
      if (i === 5) check(`${g}: 6 rounds settle, payout = bet × multiplier`, true);
    }
  }
  check("balance after 54 rounds = start − bets + payouts", Math.abs(Number((await snapshot(carol)).cash) - expected) < 0.001,
    `${(await snapshot(carol)).cash} vs ${expected}`);
  const dupG = await asPlayer(carol, "select play_game('dice', 1000, '{\"pick\":3}', 'game-dice-0-key') r");
  check("replayed game round is not charged or paid twice", okStatus(dupG, "duplicate"), JSON.stringify(dupG));
  const lowBet = await asPlayer(carol, "select play_game('dice', 99, '{\"pick\":3}', 'game-low-bet-01') r");
  check("bet below $100 minimum rejected", failed(lowBet, "invalid_bet"), lowBet.error);
  const highBet = await asPlayer(carol, "select play_game('slots', 500001, '{}', 'game-high-bet-01') r");
  check("bet above game maximum rejected", failed(highBet, "invalid_bet"), highBet.error);
  const badPick = await asPlayer(carol, "select play_game('dice', 100, '{\"pick\":7}', 'game-bad-pick-01') r");
  check("invalid dice pick rejected", failed(badPick, "invalid_choice"), badPick.error);
  const broke = await asPlayer(alice, "select play_game('casino', 1000000, '{}', 'game-broke-0001') r");
  check("bet larger than balance rejected", failed(broke, "insufficient_funds"), broke.error);
  const values = (await c.query("select game, min((result->>'value')::int) lo, max((result->>'value')::int) hi from game_rounds where user_id = $1 and game in ('dice','basketball','darts','bowling') group by game", [carol])).rows;
  check("dice/sport values stay in bot ranges", values.every((v) => v.lo >= 1 && v.hi <= (v.game === "basketball" ? 5 : 6)), JSON.stringify(values));
  await c.query("update game_settings set enabled = false where game = 'darts'");
  const off = await asPlayer(carol, "select play_game('darts', 100, '{}', 'game-disabled-01') r");
  check("disabled game rejected", failed(off, "game_disabled"), off.error);
  await c.query("update game_settings set enabled = true where game = 'darts'");

  // --- Mines ---------------------------------------------------------------
  const m1 = (await asPlayer(carol, "select mines_start(1000, 3, 'mines-key-0001') r")).rows?.[0]?.r;
  check("mines round starts with hidden mines", m1?.status === "active" && m1.mine_positions === null, JSON.stringify(m1));
  const secretPeek = await asPlayer(carol, "select * from game_round_secrets");
  check("player cannot read mine positions table", failed(secretPeek, "permission denied") || secretPeek.rows?.length === 0, JSON.stringify(secretPeek));
  const second = await asPlayer(carol, "select mines_start(1000, 3, 'mines-key-0002') r");
  check("only one active mines round per player", failed(second, "round_already_active"), second.error);
  const mines = (await c.query("select secret->'mines' m from game_round_secrets where round_id = $1", [m1.round_id])).rows[0].m;
  const safe = [...Array(25).keys()].filter((x) => !mines.includes(x));
  await asPlayer(carol, "select mines_open($1, $2) r", [m1.round_id, safe[0]]);
  const m3 = (await asPlayer(carol, "select mines_open($1, $2) r", [m1.round_id, safe[1]])).rows[0].r;
  check("two safe cells → multiplier 1.28 (bot table for 3 mines)", Number(m3.current_multiplier) === 1.28, JSON.stringify(m3));
  const balBefore = Number((await snapshot(carol)).cash);
  const co1 = (await asPlayer(carol, "select mines_cashout($1) r", [m1.round_id])).rows[0].r;
  const co2 = (await asPlayer(carol, "select mines_cashout($1) r", [m1.round_id])).rows[0].r;
  const balAfter = Number((await snapshot(carol)).cash);
  check("cashout pays bet × 1.28 = $1,280 exactly once", co1.payout && Number(co1.payout) === 1280 && co2.status === "settled" && Math.abs(balAfter - balBefore - 1280) < 0.001,
    `${balBefore} -> ${balAfter}`);
  check("mine positions revealed after the round", Array.isArray(co1.mine_positions) && co1.mine_positions.length === 3);
  const m4 = (await asPlayer(carol, "select mines_start(1000, 5, 'mines-key-0003') r")).rows[0].r;
  const mines4 = (await c.query("select secret->'mines' m from game_round_secrets where round_id = $1", [m4.round_id])).rows[0].m;
  const boom = (await asPlayer(carol, "select mines_open($1, $2) r", [m4.round_id, mines4[0]])).rows[0].r;
  check("hitting a mine loses the bet", boom.status === "settled" && boom.outcome === "lost" && Number(boom.payout) === 0, JSON.stringify(boom));
  const lateCash = (await asPlayer(carol, "select mines_cashout($1) r", [m4.round_id])).rows?.[0]?.r;
  check("cannot cash out a lost round", lateCash?.outcome === "lost" && Number(lateCash.payout) === 0, JSON.stringify(lateCash));
  const foreign = await asPlayer(alice, "select mines_cashout($1) r", [m1.round_id]);
  check("cannot touch another player's round", failed(foreign, "round_not_found"), foreign.error);

  // --- Transfers -----------------------------------------------------------
  const t1 = await asPlayer(alice, "select transfer_funds('e2e bob', 1000, 'transfer-key-01') r");
  check("transfer succeeds (name case-insensitive)", okStatus(t1, "ok"), JSON.stringify(t1));
  const t2 = await asPlayer(alice, "select transfer_funds('E2E Bob', 1000, 'transfer-key-01') r");
  check("replayed transfer is not executed twice", okStatus(t2, "duplicate"), JSON.stringify(t2));
  check("recipient received exactly $1,000", Number((await snapshot(bob)).cash) === 51000);
  check("sender debited exactly $1,000", Number((await snapshot(alice)).cash) === Math.round((49000 + pay) * 100) / 100);
  const t3 = await asPlayer(alice, "select transfer_funds('E2E Bob', 100000, 'transfer-key-02') r");
  check("overdraft rejected", failed(t3, "insufficient_funds"), t3.error);
  const t4 = await asPlayer(alice, "select transfer_funds('E2E Alice', 10, 'transfer-key-03') r");
  check("self-transfer rejected", failed(t4, "self_transfer"), t4.error);
  const t5 = await asPlayer(alice, "select transfer_funds('E2E Bob', -5, 'transfer-key-04') r");
  check("negative amount rejected", failed(t5, "invalid_amount"), t5.error);
  const t6 = await asPlayer(alice, "select transfer_funds('E2E Bob', 1.005, 'transfer-key-05') r");
  check("sub-cent amount rejected", failed(t6, "invalid_amount"), t6.error);
  const t7 = await asPlayer(alice, "select transfer_funds('E2E Bob', 100001, 'transfer-key-06') r");
  check("transfer limit enforced", failed(t7, "transfer_limit_exceeded"), t7.error);
  const t8 = await asPlayer(alice, "select transfer_funds('Nobody Here', 10, 'transfer-key-07') r");
  check("unknown recipient rejected", failed(t8, "recipient_not_found"), t8.error);

  // --- Exploit attempts ----------------------------------------------------
  const x1 = await asPlayer(alice, "select _apply_wallet_change($1::uuid, 'bank', 1000000, 'admin_credit', 'hack', 'hack-key-0001')", [alice]);
  check("internal money helper not callable by player", failed(x1, "permission denied"), x1.error);
  const x2 = await asPlayer(alice, "update wallets set bank = 999999999 where user_id = $1", [alice]);
  check("direct wallet UPDATE blocked", failed(x2, "permission denied"), x2.error);
  const x3 = await asPlayer(alice, "insert into ledger_entries (user_id, op_type, direction, account, amount, balance_before, balance_after, reason, idempotency_key) values ($1, 'salary', 'credit', 'bank', 1, 0, 1, 'fake', 'fake-key-001')", [alice]);
  check("direct ledger INSERT blocked", failed(x3, "permission denied"), x3.error);
  const x4 = await asPlayer(alice, "insert into admin_roles (user_id, role) values ($1, 'owner')", [alice]);
  check("self-granting admin role blocked", failed(x4, "permission denied"), x4.error);
  const x5 = await asPlayer(alice, "select admin_adjust_balance($1::uuid, 'bank', 1000, 'test reason', 'admin-key-0001') r", [alice]);
  check("admin RPC forbidden for players", failed(x5, "forbidden"), x5.error);
  const x6 = await asPlayer(alice, "select count(*)::int n from ledger_entries");
  const own = (await c.query("select count(*)::int n from ledger_entries where user_id = $1", [alice])).rows[0].n;
  check("player sees only own ledger rows (RLS)", x6.rows?.[0].n === own, `${x6.rows?.[0].n} vs ${own}`);
  const x7 = await asPlayer(alice, "select count(*)::int n from profiles");
  check("player sees only own profile (RLS)", x7.rows?.[0].n === 1, x7.rows?.[0].n);
  const x8 = await asPlayer(alice, "select count(*)::int n from audit_logs");
  check("audit log hidden from players", x8.rows?.[0].n === 0 || failed(x8, "permission denied"), JSON.stringify(x8));
  const x9 = await asPlayer(null, "select get_my_snapshot() s");
  check("anonymous snapshot rejected", failed(x9, "not_authenticated"), x9.error);

  // --- Admin ---------------------------------------------------------------
  await c.query("insert into admin_roles (user_id, role) values ($1, 'admin')", [bob]);
  const a1 = await asPlayer(bob, "select admin_adjust_balance($1::uuid, 'bank', 500, 'compensation test', 'admin-key-0002') r", [alice]);
  check("admin credit works", okStatus(a1, "ok"), JSON.stringify(a1));
  const a2 = await asPlayer(bob, "select admin_adjust_balance($1::uuid, 'bank', 500, 'no', 'admin-key-0003') r", [alice]);
  check("admin adjustment requires a reason", failed(a2, "reason_required"), a2.error);
  const a3 = await asPlayer(bob, "select admin_adjust_balance($1::uuid, 'bank', -9999999, 'debit test xx', 'admin-key-0004') r", [alice]);
  check("admin debit cannot make balance negative", failed(a3, "insufficient_funds"), a3.error);
  const a4 = await asPlayer(bob, "select admin_set_economy_setting('transfer_limit', 200000) r");
  check("admin can change economy setting", okStatus(a4, "ok"), JSON.stringify(a4));
  const a5 = await asPlayer(bob, "select admin_set_economy_setting('made_up_key', 1) r");
  check("unknown economy setting rejected", failed(a5, "unknown_setting"), a5.error);
  const audits = (await c.query("select count(*)::int n from audit_logs where actor_id = $1", [bob])).rows[0].n;
  check("admin actions written to audit log", audits === 2, audits);
  const adminEntry = (await c.query("select op_type, reason, counterparty_id from ledger_entries where idempotency_key = 'admin:admin-key-0002'")).rows[0];
  check("admin credit appears in ledger with reason and actor", adminEntry?.op_type === "admin_credit" && adminEntry.counterparty_id === bob, JSON.stringify(adminEntry));

  const imm = await asOwner("update ledger_entries set amount = 1 where user_id = $1", [alice]);
  check("ledger is append-only even for DB owner", failed(imm, "append_only_table"), imm.error);
  const imm2 = await asOwner("delete from audit_logs");
  check("audit log is append-only even for DB owner", failed(imm2, "append_only_table"), imm2.error);

  // --- Economy from the bot (migration 0006) --------------------------------
  const k = (() => { let n = 0; return (p) => `${p}-key-${String(++n).padStart(4, "0")}`; })();
  const val = async (uid, sql, params = []) => (await asPlayer(uid, sql, params)).rows?.[0]?.r;
  const cashOf = async (uid) => Number((await snapshot(uid)).cash);
  const fund = (uid, amount) => c.query("select _apply_wallet_change($1, 'cash', $2, 'admin_credit', 'test funding', $3)", [uid, amount, `fund-${uid}-${amount}-${Math.random()}`]);

  const erin = await makeUser("e2e_erin", "E2E Erin");
  await fund(erin, 50_000_000);
  let cashE = await cashOf(erin);

  const bk1 = await val(erin, "select bank_deposit(10000, $1) r", [k("bank")]);
  check("wallet → bank account", bk1?.status === "ok" && Number((await snapshot(erin)).bank) === 10000 && (await cashOf(erin)) === cashE - 10000);
  const bk2 = await asPlayer(erin, "select bank_withdraw(20000, $1) r", [k("bank")]);
  check("cannot withdraw more than the bank account holds", failed(bk2, "insufficient_funds"), bk2.error);
  await val(erin, "select bank_withdraw(10000, $1) r", [k("bank")]);
  check("bank account → wallet", (await cashOf(erin)) === cashE && Number((await snapshot(erin)).bank) === 0);

  const dep = await val(erin, "select deposit_open(100000, 90, $1) r", [k("dep")]);
  check("term deposit opens (90 days, 8%)", dep?.status === "ok");
  const early = await asPlayer(erin, "select deposit_claim($1) r", [dep.deposit_id]);
  check("deposit cannot be claimed before maturity", failed(early, "not_matured"), early.error);
  check("open deposit counts in capital", Number((await snapshot(erin)).assets.deposits) === 100000);
  await c.query("update bank_deposits set ends_at = now() - interval '1 second' where id = $1", [dep.deposit_id]);
  const cl = await val(erin, "select deposit_claim($1) r", [dep.deposit_id]);
  check("matured deposit pays principal + 8% = $108,000", Number(cl?.payout) === 108000, JSON.stringify(cl));
  const cl2 = await asPlayer(erin, "select deposit_claim($1) r", [dep.deposit_id]);
  check("deposit cannot be claimed twice", failed(cl2, "already_claimed"), cl2.error);
  const badTerm = await asPlayer(erin, "select deposit_open(1000, 45, $1) r", [k("dep")]);
  check("only bot terms 30/90/180 allowed", failed(badTerm, "invalid_choice"), badTerm.error);

  const bb = await val(erin, "select btc_buy(65967, $1) r", [k("btc")]);
  check("buy BTC at bot rate: $65,967 → 1 BTC", Number(bb?.btc) === 1, JSON.stringify(bb));
  const bs = await val(erin, "select btc_sell(0.5, $1) r", [k("btc")]);
  check("sell 0.5 BTC → $32,983.50", Number(bs?.usd) === 32983.5, JSON.stringify(bs));
  const bsx = await asPlayer(erin, "select btc_sell(5, $1) r", [k("btc")]);
  check("cannot sell more BTC than owned", failed(bsx, "insufficient_funds"), bsx.error);

  const mine1 = await val(erin, "select mine_resources() r");
  check("mining works", mine1?.status === "ok", JSON.stringify(mine1));
  const mine2 = await asPlayer(erin, "select mine_resources() r");
  check("mining cooldown 60 s enforced", failed(mine2, "cooldown_active"), mine2.error);
  const shop = await val(erin, "select shop_buy('buy_diamond', 3, $1) r", [k("shop")]);
  check("shop: 3 diamonds for $6,000", Number(shop?.total) === 6000, JSON.stringify(shop));
  const sold = await val(erin, "select sell_resource('diamond', 3, $1) r", [k("res")]);
  check("sell 3 diamonds at $1,500 = $4,500", Number(sold?.usd) === 4500, JSON.stringify(sold));
  const oversell = await asPlayer(erin, "select sell_resource('diamond', 9999, $1) r", [k("res")]);
  check("cannot sell resources you do not have", failed(oversell, "insufficient_resources"), oversell.error);

  const beforeCase = await cashOf(erin);
  const cs = await val(erin, "select open_case('silver', $1) r", [k("case")]);
  const reward = cs?.reward;
  const expectCash = beforeCase - 50000 + (reward?.reward_type === "usd" ? Number(reward.amount) : 0);
  check("silver case: pay $50,000, get a weighted reward", cs?.status === "ok" && Math.abs((await cashOf(erin)) - expectCash) < 0.001, JSON.stringify(cs));

  const p1 = await val(erin, "select redeem_promo('apexgamestart') r");
  check("promo APEXGAMESTART gives $50,000 (case-insensitive)", Number(p1?.usd) === 50000, JSON.stringify(p1));
  const p2 = await asPlayer(erin, "select redeem_promo('APEXGAMESTART') r");
  check("promo once per player", failed(p2, "promo_already_used"), p2.error);
  await c.query("insert into promo_codes (code, reward_usd, max_uses) values ('E2ELIMIT', 10, 1)");
  await val(erin, "select redeem_promo('E2ELIMIT') r");
  const p3 = await asPlayer(alice, "select redeem_promo('E2ELIMIT') r");
  check("promo activation limit enforced", failed(p3, "promo_limit_reached"), p3.error);
  const p4 = await asPlayer(alice, "select redeem_promo('NOPE_CODE') r");
  check("unknown promo rejected", failed(p4, "promo_not_found"), p4.error);
  const peek = await asPlayer(alice, "select count(*)::int n from promo_codes");
  check("players cannot list promo codes", peek.rows?.[0]?.n === 0 || failed(peek, "permission denied"), JSON.stringify(peek));

  const rb = await val(erin, "select asset_buy('realty', 'villa', $1) r", [k("asset")]);
  check("buy villa for $1,000,000", Number(rb?.price) === 1000000, JSON.stringify(rb));
  const rb2 = await asPlayer(erin, "select asset_buy('realty', 'villa', $1) r", [k("asset")]);
  check("cannot own the same property twice", failed(rb2, "already_owned"), rb2.error);
  await c.query("update user_realty set last_collected_at = now() - interval '2 hours' where user_id = $1", [erin]);
  const inc = await val(erin, "select collect_income('realty') r");
  check("villa pays $10,000/h × 2 h ≈ $20,000", Math.abs(Number(inc?.total) - 20000) < 10, JSON.stringify(inc));
  const inc2 = await val(erin, "select collect_income('realty') r");
  check("immediate re-collect pays ~0", Number(inc2?.total) < 5, JSON.stringify(inc2));
  await c.query("update user_realty set last_collected_at = now() - interval '100 hours' where user_id = $1", [erin]);
  const inc3 = await val(erin, "select collect_income('realty') r");
  check("offline income capped at 24 h ($240,000)", Math.abs(Number(inc3?.total) - 240000) < 10, JSON.stringify(inc3));
  const up = await val(erin, "select asset_upgrade('realty', 'villa', $1) r", [k("asset")]);
  check("villa upgrade costs base × level = $250,000", Number(up?.cost) === 250000 && up.level === 2, JSON.stringify(up));
  const sellV = await val(erin, "select asset_sell('realty', 'villa', $1) r", [k("asset")]);
  check("sell villa lvl 2 at 70% of $1,150,000 = $805,000", Number(sellV?.proceeds) === 805000, JSON.stringify(sellV));

  await val(erin, "select asset_buy('business', 'coffee_shop', $1) r", [k("asset")]);
  const hire = await val(erin, "select business_hire('coffee_shop', $1) r", [k("asset")]);
  check("first employee costs $2,000", Number(hire?.cost) === 2000 && hire.employees === 1, JSON.stringify(hire));
  await c.query("update user_businesses set last_collected_at = now() - interval '1 hour' where user_id = $1", [erin]);
  const binc = await val(erin, "select collect_income('business') r");
  check("coffee shop net = 1200 × 1.05 − 200 = $1,060/h", Math.abs(Number(binc?.total) - 1060) < 2, JSON.stringify(binc));

  await val(erin, "select asset_buy('car', 'sedan', $1) r", [k("asset")]);
  const cup = await val(erin, "select asset_upgrade('car', 'sedan', $1) r", [k("asset")]);
  check("car upgrade = 20% × price × level = $6,000", Number(cup?.cost) === 6000, JSON.stringify(cup));
  const taxi = await val(erin, "select work_shift('taxi', $1) r", [k("shift")]);
  check("taxi works once the player owns a car", taxi?.status === "ok", JSON.stringify(taxi));
  const snapE = await snapshot(erin);
  check("capital = wallet + bank + BTC + assets + deposits",
    Math.abs(Number(snapE.total_capital) - (Number(snapE.cash) + Number(snapE.bank) + Number(snapE.assets.btc_usd) + Number(snapE.assets.realty)
      + Number(snapE.assets.cars) + Number(snapE.assets.business) + Number(snapE.assets.deposits))) < 0.01, JSON.stringify(snapE));
  const mech = await val(erin, "select work_shift('mechanic', $1) r", [k("shift")]);
  check("capital ≥ $500k unlocks mechanic", mech?.status === "ok", JSON.stringify(mech));

  // --- Progression (0007) ---------------------------------------------------
  const q1 = await val(carol, "select claim_quest('play_5_games') r");
  check("quest 'play 5 games' claimable after 54 rounds ($1,000)", Number(q1?.reward) === 1000, JSON.stringify(q1));
  const q2 = await asPlayer(carol, "select claim_quest('play_5_games') r");
  check("quest reward only once", failed(q2, "already_claimed"), q2.error);
  const q3 = await asPlayer(erin, "select claim_quest('invite_1') r");
  check("unfinished quest cannot be claimed", failed(q3, "not_completed"), q3.error);
  const ach1 = await val(carol, "select claim_achievement('first_steps') r");
  check("achievement 'first steps' pays $5,000", Number(ach1?.reward) === 5000, JSON.stringify(ach1));
  const ach2 = await asPlayer(erin, "select claim_achievement('tycoon') r");
  check("tycoon ($10M capital) pays $1,000,000", Number(ach2.rows?.[0]?.r?.reward) === 1000000, ach2.error);

  const vipNo = await asPlayer(erin, "select admin_grant_vip($1, 4, 14, 'test grant') r", [erin]);
  check("players cannot grant VIP", failed(vipNo, "forbidden"), vipNo.error);
  const vip = await val(bob, "select admin_grant_vip($1, 4, 14, 'test grant') r", [erin]);
  check("admin grants VIP 4", vip?.status === "ok", JSON.stringify(vip));
  await c.query("insert into events (code, title, event_type, multiplier, starts_at, ends_at) values ('e2e_x2', 'x2', 'daily', 2, now() - interval '1 hour', now() + interval '1 hour')");
  const ds = (await asPlayer(erin, "select daily_status() s")).rows[0].s;
  check("daily = $100,000 × VIP 2.0 × event 2.0 = $400,000", Number(ds.reward) === 400000, JSON.stringify(ds));

  const refCode = (await val(alice, "select my_referrals() r")).code;
  const dave = await (async () => {
    const { rows } = await c.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e2e_dave@players.bayhan.app', 'x', $1, now(), now()) returning id`,
      [{ login: "e2e_dave", game_name: "E2E Dave", ref: refCode.toLowerCase() }]);
    return rows[0].id;
  })();
  const aliceBefore = await cashOf(alice);
  for (let i = 0; i < 3; i++) {
    await c.query("update work_shifts set created_at = created_at - interval '1 day' where user_id = $1", [dave]);
    await val(dave, "select work_shift('courier', $1) r", [k("shift")]);
    if (i === 1) check("no referral reward before 3 shifts", (await cashOf(alice)) === aliceBefore);
  }
  check("referrer gets $500,000 after invitee's 3rd shift", (await cashOf(alice)) === aliceBefore + 500000);
  await c.query("update work_shifts set created_at = created_at - interval '1 day' where user_id = $1", [dave]);
  await val(dave, "select work_shift('courier', $1) r", [k("shift")]);
  check("referral reward paid only once", (await cashOf(alice)) === aliceBefore + 500000);

  const rn = await asPlayer(erin, "select rename_game_name('E2E Bob') r");
  check("cannot take another player's name", failed(rn, "name_taken"), rn.error);
  const rn2 = await val(erin, "select rename_game_name('E2E Erin2') r");
  check("rename works", rn2?.game_name === "E2E Erin2");

  // --- Cosmetics (0008) -----------------------------------------------------
  const cb = await val(erin, "select cosmetic_buy('frame_neon', $1) r", [k("cx")]);
  check("buy frame_neon for $25,000", Number(cb?.price) === 25000, JSON.stringify(cb));
  const cb2 = await asPlayer(erin, "select cosmetic_buy('frame_neon', $1) r", [k("cx")]);
  check("unique cosmetic cannot be bought twice", failed(cb2, "already_owned"), cb2.error);
  const cb3 = await asPlayer(erin, "select cosmetic_buy('badge_og', $1) r", [k("cx")]);
  check("non-purchasable cosmetic rejected", failed(cb3, "not_purchasable"), cb3.error);
  const eq = await val(erin, "select cosmetic_equip('frame_neon') r");
  check("equip frame", eq?.slot === "frame");
  const eqx = await asPlayer(erin, "select cosmetic_equip('frame_gold') r");
  check("cannot equip what you do not own", failed(eqx, "not_owned"), eqx.error);
  const box = await val(erin, "select open_box('box_common', $1) r", [k("cx")]);
  check("mystery box gives an item not owned before", box?.reward?.code && box.reward.code !== "frame_neon", JSON.stringify(box));
  for (const code of ["frame_cyber", "theme_cyberpunk", "ns_bayhan", "fx_electric"]) {
    await c.query("select _grant_cosmetic($1, $2, 'admin')", [erin, code]);
  }
  const col = await c.query("select 1 from user_cosmetics where user_id = $1 and code = 'title_cyber_master'", [erin]);
  check("completing Cyber collection awards title_cyber_master", col.rowCount === 1);
  await c.query("update cosmetic_items set sold_count = limited_qty where code = 'frame_limited'");
  const lim = await asPlayer(erin, "select cosmetic_buy('frame_limited', $1) r", [k("cx")]);
  check("limited item sold out", failed(lim, "out_of_stock"), lim.error);

  // --- Corporations and marriage (0009) -------------------------------------
  const corp = await val(erin, "select corp_create('E2E Corp', 'test', $1) r", [k("corp")]);
  check("create corporation for $1,000,000", corp?.status === "ok", JSON.stringify(corp));
  const corp2 = await asPlayer(erin, "select corp_create('E2E Corp 2', '', $1) r", [k("corp")]);
  check("one corporation per player", failed(corp2, "corp_already_member"), corp2.error);
  await val(erin, "select corp_invite('E2E Carol') r");
  const inv = (await val(carol, "select my_corporation() r")).invites[0];
  await val(carol, "select corp_respond($1, true) r", [inv.id]);
  const cwNo = await asPlayer(carol, "select corp_withdraw(1, $1) r", [k("corp")]);
  check("member cannot withdraw from treasury", failed(cwNo, "corp_no_permission"), cwNo.error);
  await fund(carol, 1_000_000);
  await val(carol, "select corp_deposit(300000, $1) r", [k("corp")]);
  const bld = await val(erin, "select corp_buy_building('warehouse') r");
  const mc = await val(erin, "select my_corporation() r");
  check("member deposits, president buys warehouse from treasury (+20 prestige)",
    bld?.status === "ok" && Number(mc.corp.treasury) === 50000 && mc.corp.prestige === 20, JSON.stringify(mc.corp));
  const tk = await asPlayer(erin, "select corp_claim_task('recruit_5') r");
  check("corp task needs 5 members", failed(tk, "not_completed"), tk.error);
  await val(erin, "select corp_manage($1, 'promote') r", [carol]);
  check("president promotes member → manager", (await val(erin, "select my_corporation() r")).members.find((m) => m.user_id === carol).role === "manager");
  const lv = await asPlayer(erin, "select corp_leave() r");
  check("president cannot leave", failed(lv, "corp_president_cannot_leave"), lv.error);

  await val(erin, "select marriage_propose('E2E Carol') r");
  const prop = (await val(carol, "select my_marriage() r")).incoming[0];
  await val(carol, "select marriage_respond($1, true) r", [prop.id]);
  check("marriage accepted", (await val(erin, "select my_marriage() r")).partner?.game_name === "E2E Carol");
  const poly = await asPlayer(erin, "select marriage_propose('E2E Bob') r");
  check("cannot propose while married", failed(poly, "already_married"), poly.error);
  await val(carol, "select marriage_divorce() r");
  check("divorce ends the marriage", (await val(erin, "select my_marriage() r")).partner === null);

  // --- Account status ------------------------------------------------------
  await c.query("update profiles set status = 'blocked' where id = $1", [alice]);
  const b1 = await asPlayer(alice, "select work_shift('waiter', 'shift-key-0099') r");
  check("blocked player cannot work", failed(b1, "account_restricted"), b1.error);
  const b2 = await asPlayer(alice, "select transfer_funds('E2E Bob', 1, 'transfer-key-99') r");
  check("blocked player cannot transfer", failed(b2, "account_restricted"), b2.error);

  // --- Global invariant ----------------------------------------------------
  const drift = (await c.query(`
    select count(*)::int n from wallets w
     where w.bank <> coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                                 from ledger_entries l where l.user_id = w.user_id and l.account = 'bank'), 0)
        or w.cash <> coalesce((select sum(case when direction = 'credit' then amount else -amount end)
                                 from ledger_entries l where l.user_id = w.user_id and l.account = 'cash'), 0)`)).rows[0].n;
  check("every wallet equals the sum of its journal entries", drift === 0, drift);
} finally {
  await c.query("rollback");
  await c.end();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  ->  ${r.detail}`}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed (transaction rolled back, no data kept)`);
if (passed !== results.length) process.exitCode = 1;
