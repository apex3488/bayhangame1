// Database tests for the chat bot layer (migration 0025): the tg_rpc bridge, chats, duels,
// party rewards and permissions. Everything runs in ONE transaction that is rolled back.
import { connect } from "./db-env.mjs";

const c = await connect();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  — ${detail}`}`);
};

async function makeUser(login, gameName, tg) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, 'x', $2, now(), now())
     returning id`,
    [`${login}@players.bayhan.app`, { login, game_name: gameName }],
  );
  if (tg) await c.query("select public.tg_link_user($1, $2, null, null)", [rows[0].id, tg]);
  return rows[0].id;
}
/** Runs SQL as a role, returning rows or the error message. */
async function as(role, sql, params = [], sub = null) {
  await c.query("savepoint s");
  try {
    await c.query(`set local role ${role}`);
    if (sub) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    const { rows } = await c.query(sql, params);
    await c.query("reset role");
    await c.query("release savepoint s");
    return { rows };
  } catch (e) {
    await c.query("rollback to savepoint s");
    await c.query("reset role");
    return { error: e.message };
  }
}
const svc = (sql, p) => as("service_role", sql, p);
const cash = async (uid) => Number((await c.query("select cash from wallets where user_id = $1", [uid])).rows[0].cash);

await c.query("begin");
try {
  const T1 = 9_300_000_000_001, T2 = 9_300_000_000_002, T3 = 9_300_000_000_003;
  const u1 = await makeUser("cbt_one", "CbtOne", T1);
  const u2 = await makeUser("cbt_two", "CbtTwo", T2);

  // ---- tg_rpc bridge
  const snap = await svc("select public.tg_rpc($1, 'get_my_snapshot', '{}') r", [T1]);
  check("tg_rpc runs a player RPC as the linked player", snap.rows?.[0]?.r?.user_id === u1, snap.error);
  const slots = await svc("select public.tg_rpc($1, 'play_game', $2) r", [T1, { p_game: "slots", p_bet: 100, p_choice: {}, p_idempotency_key: "cbt-slots-0001" }]);
  check("tg_rpc plays a game with jsonb arguments", slots.rows?.[0]?.r?.status === "ok", slots.error);
  const again = await svc("select public.tg_rpc($1, 'play_game', $2) r", [T1, { p_game: "slots", p_bet: 100, p_choice: {}, p_idempotency_key: "cbt-slots-0001" }]);
  check("same idempotency key does not play twice", again.rows?.[0]?.r?.status === "duplicate");
  const quests = await svc("select public.tg_rpc($1, 'my_quests', '{}') r", [T1]);
  check("set-returning RPC comes back as a JSON array", Array.isArray(quests.rows?.[0]?.r), quests.error);
  const marks = await svc("select public.tg_rpc($1, 'notifications_mark_read', $2) r", [T1, { p_ids: [] }]);
  check("array arguments are converted", !marks.error, marks.error);
  check("internal helpers are not reachable", String((await svc("select public.tg_rpc($1, '_apply_wallet_change', '{}')", [T1])).error).includes("unknown_operation"));
  check("tg-only functions are not reachable through the bridge", String((await svc("select public.tg_rpc($1, 'tg_duel_accept', '{}')", [T1])).error).includes("unknown_operation"));
  check("unlinked Telegram id refused", String((await svc("select public.tg_rpc($1, 'get_my_snapshot', '{}')", [T3])).error).includes("telegram_not_linked"));
  check("admin RPC refused for a regular player", Boolean((await svc("select public.tg_rpc($1, 'admin_dashboard', '{}')", [T1])).error));
  const inj = await svc("select public.tg_rpc($1, 'rename_game_name', $2) r", [T1, { p_name: "x'); drop table profiles; --" }]);
  check("argument values cannot inject SQL", String(inj.error).includes("invalid_game_name") && (await c.query("select to_regclass('public.profiles') t")).rows[0].t);

  // ---- permissions
  for (const role of ["anon", "authenticated"]) {
    check(`${role} cannot call tg_rpc`, Boolean((await as(role, "select public.tg_rpc($1, 'get_my_snapshot', '{}')", [T1], u1)).error));
    check(`${role} cannot settle duels`, Boolean((await as(role, "select public.tg_duel_accept(gen_random_uuid(), $1)", [T2], u2)).error));
    check(`${role} cannot pay party rewards`, Boolean((await as(role, "select public.tg_party_reward(gen_random_uuid(), array[$1::bigint])", [T1], u1)).error));
  }

  // ---- chats
  await svc("select public.tg_chat_seen(-100123, 'Test chat', 'supergroup', $1)", [T1]);
  await svc("select public.tg_chat_seen(-100123, 'Test chat', 'supergroup', $1)", [T2]);
  const top = (await svc("select public.tg_chat_top(-100123, 10) r")).rows?.[0]?.r;
  check("chat top lists the chat's linked players", top?.length === 2 && top[0].rank === 1);
  const set = (await svc("select public.tg_chat_set(-100123, 'casino', false) r")).rows?.[0]?.r;
  check("chat settings can be changed", set?.casino === false && set?.party === true);

  // ---- duels
  const before1 = await cash(u1), before2 = await cash(u2);
  const d = (await svc("select public.tg_duel_create($1, -100123, 1000, $2) r", [T1, T2])).rows?.[0]?.r;
  check("duel created", d?.id && d.b_name === "CbtTwo");
  check("second open duel refused", String((await svc("select public.tg_duel_create($1, -100123, 1000, null)", [T1])).error).includes("duel_pending"));
  check("creator cannot accept own duel", String((await svc("select public.tg_duel_accept($1, $2)", [d.id, T1])).error).includes("duel_self"));
  check("targeted duel refused for others", String((await svc("select public.tg_duel_accept($1, $2)", [d.id, T3])).error).length > 0);
  const res = (await svc("select public.tg_duel_accept($1, $2) r", [d.id, T2])).rows?.[0]?.r;
  const after1 = await cash(u1), after2 = await cash(u2);
  check("duel settles: winner +stake, loser -stake, total unchanged",
    res?.status === "ok" && after1 + after2 === before1 + before2 && Math.abs(after1 - before1) === 1000, JSON.stringify({ before1, after1, before2, after2 }));
  check("a settled duel cannot be accepted again", String((await svc("select public.tg_duel_accept($1, $2)", [d.id, T2])).error).includes("duel_closed"));
  const rich = (await svc("select public.tg_duel_create($1, -100123, 999999999, null) r", [T1]));
  check("duel above own cash refused", String(rich.error).includes("insufficient_funds"));

  // ---- party rewards
  const g = (await svc("insert into tg_party_games (chat_id, kind, phase, finished_at) values (-100123, 'spy', 'done', now()) returning id")).rows[0].id;
  const p1 = (await svc("select public.tg_party_reward($1, array[$2, $3, $4]::bigint[]) r", [g, T1, T2, T3])).rows?.[0]?.r;
  check("party reward pays linked winners only", p1?.paid?.length === 2, JSON.stringify(p1));
  const p2 = (await svc("select public.tg_party_reward($1, array[$2]::bigint[]) r", [g, T1])).rows?.[0]?.r;
  check("party reward for the same game is paid once", p2?.paid?.length === 0);
  for (let i = 0; i < 6; i++) {
    const gi = (await svc("insert into tg_party_games (chat_id, kind, phase, finished_at) values (-100124, 'spy', 'done', now()) returning id")).rows[0].id;
    await svc("select public.tg_party_reward($1, array[$2]::bigint[])", [gi, T1]);
  }
  const n = Number((await c.query("select count(*) n from ledger_entries where user_id = $1 and op_type = 'party_reward'", [u1])).rows[0].n);
  check("party rewards capped per day", n === 5, `rewards=${n}`);
  // ---- tg_begin: one call per update
  const b1 = (await svc("select public.tg_begin(777000001, $1, -100126, 'supergroup', 'Chat', 40) r", [T1])).rows?.[0]?.r;
  check("tg_begin: new update, linked player, chat settings", b1?.new === true && b1.linked === true && b1.settings?.casino === true && b1.party === false, JSON.stringify(b1));
  const b2 = (await svc("select public.tg_begin(777000001, $1, -100126, 'supergroup', 'Chat', 40) r", [T1])).rows?.[0]?.r;
  check("tg_begin: a re-delivered update is reported as seen", b2?.new === false);
  check("tg_begin registers the chat and the member", Number((await c.query("select count(*) n from tg_chat_members where chat_id = -100126")).rows[0].n) === 1);
  const b3 = (await svc("select public.tg_begin(777000002, $1, $1, 'private', null, 40) r", [T3])).rows?.[0]?.r;
  check("tg_begin: unlinked user in private", b3?.new === true && b3.linked === false);
  const rc = (await svc("select public.tg_rpc_cash($1, 'get_my_snapshot', '{}') r", [T1])).rows?.[0]?.r;
  check("tg_rpc_cash returns the result and the cash", rc?.r?.user_id === u1 && Number(rc.cash) === await cash(u1));

  // ---- lottery
  const l0 = await cash(u1), l2 = await cash(u2);
  check("lottery bet below minimum refused", Boolean((await svc("select public.tg_lottery_buy($1, -100127, 50)", [T1])).error));
  await svc("select public.tg_lottery_buy($1, -100127, 1000)", [T1]);
  await svc("select public.tg_lottery_buy($1, -100127, 1000)", [T1]);
  const lb = (await svc("select public.tg_lottery_buy($1, -100127, 3000) r", [T2])).rows?.[0]?.r;
  check("lottery collects bets into one pot", Number(lb?.pot) === 5000 && Number(lb.players) === 2);
  check("lottery debits the bets", (await cash(u1)) === l0 - 2000 && (await cash(u2)) === l2 - 3000);
  await c.query("update tg_lotteries set draw_at = now() - interval '1 second' where chat_id = -100127 and status = 'open'");
  const draw = (await svc("select public.tg_lottery_draw_due() r")).rows?.[0]?.r?.find((x) => x.chat_id === -100127);
  const after = (await cash(u1)) + (await cash(u2));
  check("lottery draw pays pot minus 5% fee to one winner", draw && !draw.refunded && Number(draw.payout) === 4750 && after === l0 + l2 - 5000 + 4750, JSON.stringify(draw));
  check("a drawn lottery is not drawn twice", !(await svc("select public.tg_lottery_draw_due() r")).rows?.[0]?.r?.some((x) => x.chat_id === -100127));
  const s0 = await cash(u1);
  await svc("select public.tg_lottery_buy($1, -100128, 500)", [T1]);
  await c.query("update tg_lotteries set draw_at = now() - interval '1 second' where chat_id = -100128 and status = 'open'");
  const solo = (await svc("select public.tg_lottery_draw_due() r")).rows?.[0]?.r?.find((x) => x.chat_id === -100128);
  check("lottery with one player is refunded", solo?.refunded === true && (await cash(u1)) === s0);

  // ---- giveaways
  const g0 = await cash(u1);
  const gv = (await svc("select public.tg_giveaway_create($1, -100129, 1000, 3) r", [T1])).rows?.[0]?.r;
  check("giveaway debits only whole shares", Number(gv?.share) === 333.33 && (await cash(u1)) === Math.round((g0 - 999.99) * 100) / 100);
  check("creator cannot claim own giveaway", String((await svc("select public.tg_giveaway_claim($1, $2)", [gv.id, T1])).error).includes("giveaway_own"));
  const c2 = await cash(u2);
  await svc("select public.tg_giveaway_claim($1, $2)", [gv.id, T2]);
  check("a player claims one share once", String((await svc("select public.tg_giveaway_claim($1, $2)", [gv.id, T2])).error).includes("giveaway_already") && (await cash(u2)) === Math.round((c2 + 333.33) * 100) / 100);
  check("unlinked users cannot claim", String((await svc("select public.tg_giveaway_claim($1, $2)", [gv.id, T3])).error).includes("telegram_not_linked"));
  await c.query("update tg_giveaways set expires_at = now() - interval '1 second' where id = $1", [gv.id]);
  const g1 = await cash(u1);
  await svc("select public.tg_giveaway_expire_due()");
  check("unclaimed shares return to the creator on expiry", Math.round(((await cash(u1)) - g1) * 100) / 100 === 666.66);
  check("expired giveaway cannot be claimed", String((await svc("select public.tg_giveaway_claim($1, $2)", [gv.id, T2])).error).includes("giveaway_closed"));
  for (const role of ["anon", "authenticated"]) {
    check(`${role} cannot draw lotteries or create giveaways`, Boolean((await as(role, "select public.tg_lottery_draw_due()")).error) && Boolean((await as(role, "select public.tg_giveaway_create($1, 1, 1000, 1)", [T1], u1)).error));
  }

  const running = (await svc("insert into tg_party_games (chat_id, kind, phase) values (-100125, 'mafia', 'lobby') returning id")).rows[0].id;
  check("unfinished game pays nothing", Boolean((await svc("select public.tg_party_reward($1, array[$2]::bigint[])", [running, T1])).error));
  check("one running party game per chat", Boolean((await svc("insert into tg_party_games (chat_id, kind, phase) values (-100125, 'spy', 'lobby')")).error));
} finally {
  await c.query("rollback");
  await c.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (transaction rolled back, no data kept)`);
process.exit(failed.length ? 1 : 0);
