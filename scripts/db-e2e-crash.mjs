// Tests for Crash (0015) and the luxury / billions catalog (0016). Rolled back at the end.
// Time is simulated by moving a round's started_at back; the crash point is set in its secret.
import { connect } from "./db-env.mjs";

const c = await connect();
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const failed = (r, code) => typeof r.error === "string" && r.error.includes(code);
let n = 0;
const key = () => `crash-test-key-${String(++n).padStart(4, "0")}`;

async function makeUser(login, gameName) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, 'x', $2, now(), now()) returning id`,
    [`${login}@players.bayhan.app`, { login, game_name: gameName }],
  );
  return rows[0].id;
}
async function as(uid, sql, params = []) {
  await c.query("savepoint p");
  try {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const { rows } = await c.query(sql, params);
    await c.query("reset role");
    await c.query("release savepoint p");
    return { rows, r: rows?.[0]?.r };
  } catch (e) {
    await c.query("rollback to savepoint p");
    await c.query("reset role");
    return { error: e.message };
  }
}
const cash = async (uid) => Number((await c.query("select cash from wallets where user_id = $1", [uid])).rows[0].cash);
/** Rewinds a round by `seconds` and fixes its crash point. */
const rig = (round, seconds, crashAt) =>
  c.query("update game_rounds set started_at = now() - make_interval(secs => $2) where id = $1; ", [round, seconds]).then(() =>
    c.query("update game_round_secrets set secret = jsonb_build_object('crash', $2::numeric) where round_id = $1", [round, crashAt]));
const fund = (uid, amount) => c.query("select _apply_wallet_change($1, 'cash', $2, 'admin_credit', 'test funding', $3)", [uid, amount, `fund-${uid}-${amount}`]);

await c.query("begin");
try {
  const p = await makeUser("crash_p", "Crash Pilot");

  // --- Crash ---------------------------------------------------------------
  const s1 = await as(p, "select crash_start(1000, null, $1) r", [key()]);
  check("crash round starts, crash point hidden", s1.r?.status === "active" && s1.r.crash === null && s1.r.started_at, JSON.stringify(s1));
  check("bet debited", (await cash(p)) === 49000);
  const twice = await as(p, "select crash_start(1000, null, $1) r", [key()]);
  check("only one active round", failed(twice, "round_already_active"), twice.error);
  await rig(s1.r.round_id, 5, 2.5);                                   // e^(0.0693·5) = 1.41
  const co = await as(p, "select crash_cashout($1) r", [s1.r.round_id]);
  check("cash out before crash pays bet × current multiplier (1.41)", co.r?.outcome === "cashed_out" && Number(co.r.multiplier) === 1.41 && Number(co.r.payout) === 1410, JSON.stringify(co.r));
  check("crash point revealed after the round", Number(co.r?.crash) === 2.5);
  const co2 = await as(p, "select crash_cashout($1) r", [s1.r.round_id]);
  check("repeated cash out pays nothing more", co2.r?.status === "settled" && (await cash(p)) === 50410, `${await cash(p)}`);

  const s2 = await as(p, "select crash_start(1000, null, $1) r", [key()]);
  await rig(s2.r.round_id, 10, 1.5);                                  // 2.00× already passed 1.50×
  const st = await as(p, "select crash_state($1) r", [s2.r.round_id]);
  check("state settles a crashed round as lost", st.r?.outcome === "crashed" && Number(st.r.payout) === 0 && Number(st.r.crash) === 1.5, JSON.stringify(st.r));
  const late = await as(p, "select crash_cashout($1) r", [s2.r.round_id]);
  check("cash out after the crash is too late", late.r?.outcome === "crashed" && (await cash(p)) === 49410);

  const s3 = await as(p, "select crash_start(1000, 1.3, $1) r", [key()]);
  await rig(s3.r.round_id, 10, 3);
  const auto = await as(p, "select crash_state($1) r", [s3.r.round_id]);
  check("auto cash-out at 1.30× pays $1,300", auto.r?.outcome === "auto_cashout" && Number(auto.r.payout) === 1300, JSON.stringify(auto.r));

  const s4 = await as(p, "select crash_start(1000, 5, $1) r", [key()]);
  await rig(s4.r.round_id, 20, 2);
  const autoLost = await as(p, "select crash_state($1) r", [s4.r.round_id]);
  check("auto target above the crash point loses", autoLost.r?.outcome === "crashed" && Number(autoLost.r.payout) === 0, JSON.stringify(autoLost.r));

  const badAuto = await as(p, "select crash_start(1000, 1.00, $1) r", [key()]);
  check("auto cash-out below 1.01× rejected", failed(badAuto, "invalid_choice"), badAuto.error);
  const lowBet = await as(p, "select crash_start(50, null, $1) r", [key()]);
  check("crash minimum bet $100", failed(lowBet, "invalid_bet"), lowBet.error);

  const s5 = await as(p, "select crash_start(1000, null, $1) r", [key()]);
  const flying = await as(p, "select crash_state($1) r", [s5.r.round_id]);
  check("fresh round keeps flying", flying.r?.status === "active" || flying.r?.outcome === "crashed", JSON.stringify(flying.r));
  await c.query("insert into game_secrets (key, code_hash) values ('crash_reveal', _sha256_hex('0000')) on conflict (key) do update set code_hash = excluded.code_hash");
  if (flying.r?.status === "active") {
    await rig(s5.r.round_id, 0, 7.77);
    const rv = await as(p, "select crash_reveal($1, '0000') r", [s5.r.round_id]);
    check("secret code shows the crash point of the active round", rv.r?.status === "ok" && Number(rv.r.crash) === 7.77, JSON.stringify(rv));
    const wrong = await as(p, "select crash_reveal($1, '1234') r", [s5.r.round_id]);
    check("wrong crash code refused", wrong.r?.status === "wrong_code", JSON.stringify(wrong));
    check("crash code use audited", Number((await c.query("select count(*) n from audit_logs where action = 'crash_secret_reveal' and target_id = $1", [s5.r.round_id])).rows[0].n) === 1);
    await as(p, "select crash_cashout($1) r", [s5.r.round_id]);
  }
  const other = await makeUser("crash_o", "Crash Other");
  const foreign = await as(other, "select crash_cashout($1) r", [s1.r.round_id]);
  check("cannot touch another player's crash round", failed(foreign, "round_not_found"), foreign.error);
  const hist = await as(p, "select * from crash_history(10)");
  check("history lists settled crash points", hist.rows?.length >= 4, JSON.stringify(hist.rows?.slice(0, 2)));

  // Distribution sanity: P(crash ≥ 2) should be ≈ 0.495.
  const dist = (await c.query(
    "select avg(case when least(1000, greatest(1.00, floor(100 * 0.99 / greatest(1 - _rand(), 0.0000001)) / 100)) >= 2 then 1 else 0 end)::numeric p from generate_series(1, 20000)")).rows[0].p;
  check("crash formula: P(≥2×) ≈ 49.5%", Math.abs(Number(dist) - 0.495) < 0.02, String(dist));

  // --- Luxury and billions ---------------------------------------------------
  const rich = await makeUser("crash_rich", "Crash Rich");
  await fund(rich, 30_000_000_000);
  const capBefore = Number((await as(rich, "select get_my_snapshot() r")).r.total_capital);
  const lux = await as(rich, "select asset_buy('luxury', 'history_supreme', $1) r", [key()]);
  check("buy History Supreme yacht for $4.8B", Number(lux.r?.price) === 4800000000, JSON.stringify(lux));
  const snap = (await as(rich, "select get_my_snapshot() r")).r;
  check("luxury counts in capital at full price", Number(snap.assets.luxury) === 4800000000 && Number(snap.total_capital) === capBefore, JSON.stringify(snap.assets));
  const lux2 = await as(rich, "select asset_buy('luxury', 'history_supreme', $1) r", [key()]);
  check("luxury item owned once", failed(lux2, "already_owned"), lux2.error);
  const sell = await as(rich, "select asset_sell('luxury', 'history_supreme', $1) r", [key()]);
  check("sell luxury at 70% ($3.36B)", Number(sell.r?.proceeds) === 3360000000, JSON.stringify(sell));
  const up = await as(rich, "select asset_upgrade('luxury', 'rolex_daytona', $1) r", [key()]);
  check("luxury cannot be upgraded", failed(up, "invalid_choice"), up.error);
  const car = await as(rich, "select asset_buy('car', 'bugatti_noire', $1) r", [key()]);
  check("buy Bugatti La Voiture Noire ($18.7M)", Number(car.r?.price) === 18700000, JSON.stringify(car));
  const biz = await as(rich, "select asset_buy('business', 'bank', $1) r", [key()]);
  check("buy a $5B bank business", Number(biz.r?.price) === 5000000000, JSON.stringify(biz));
  await c.query("update user_businesses set last_collected_at = now() - interval '1 hour' where user_id = $1 and code = 'bank'", [rich]);
  const inc = await as(rich, "select collect_income('business') r");
  check("bank nets $32M per hour", Math.abs(Number(inc.r?.total) - 32000000) < 20000, JSON.stringify(inc.r));
  const cx = await as(rich, "select cosmetic_buy('title_emperor', $1) r", [key()]);
  check("buy $10B Emperor title", Number(cx.r?.price) === 10000000000, JSON.stringify(cx));
  const ach = await as(rich, "select claim_achievement('billionaire') r");
  check("billionaire achievement pays $10M", Number(ach.r?.reward) === 10000000, JSON.stringify(ach));
  const drift = Number((await c.query(`select count(*) n from wallets w where w.cash <> coalesce((select sum(case when direction='credit' then amount else -amount end)
      from ledger_entries l where l.user_id = w.user_id and l.account = 'cash'), 0)`)).rows[0].n);
  check("every wallet still equals its journal", drift === 0, String(drift));
} finally {
  await c.query("rollback");
  await c.end();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  ->  ${r.detail}`}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed (transaction rolled back, no data kept)`);
if (passed !== results.length) process.exitCode = 1;
