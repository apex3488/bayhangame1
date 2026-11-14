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

  // ---------------------------------------------------- group moderation (0029) ----
  const TO = 9100000001, MC = -100990;
  const ownerUid = await makeUser("cbt_owner", "CbtOwner", TO);
  await c.query("insert into admin_roles (user_id, role) values ($1, 'owner') on conflict (user_id) do update set role = 'owner'", [ownerUid]);
  const gameBefore = (await c.query("select count(*)::int n, coalesce(sum(cash), 0)::text s from wallets")).rows[0];
  const banBefore = (await c.query("select count(*)::int n from profiles where status = 'blocked'")).rows[0].n;
  const ob = (await svc("select public.tg_begin(990001, $1, $2, 'supergroup', 'Мод тест', 60, 41, 'own', 'Owner') b", [TO, MC])).rows?.[0]?.b;
  check("tg_begin flags the game owner", ob?.owner === true);
  const pb = (await svc("select public.tg_begin(990002, $1, $2, 'supergroup', 'Мод тест', 60, 42, 'pl1', 'Игрок') b", [T1, MC])).rows?.[0]?.b;
  check("tg_begin: a player is not the owner", pb?.owner === false);
  check("tg_begin keeps the old six-argument call working", (await svc("select public.tg_begin(990003, $1, $2, 'supergroup', 'Мод тест', 60) b", [T2, MC])).rows?.[0]?.b?.new === true);
  check("message ids are indexed for cleanup", (await c.query("select count(*)::int n from tg_mod_messages where chat_id = $1", [MC])).rows[0].n === 2);
  check("member names are stored", (await c.query("select first_name from tg_chat_members where chat_id = $1 and telegram_id = $2", [MC, T1])).rows[0]?.first_name === "Игрок");
  await svc("select public.tg_mod_seen($1, 'Мод тест', 'supergroup', $2, 'member')", [MC, JSON.stringify([{ id: 9100000011, first_name: "Новичок" }, { id: 9100000012, username: "nick12" }])]);
  await svc("select public.tg_mod_seen($1, 'Мод тест', 'supergroup', $2, 'left')", [MC, JSON.stringify([{ id: 9100000013, first_name: "Ушёл" }])]);
  check("joins and leaves become known members", (await c.query("select count(*)::int n from tg_chat_members where chat_id = $1", [MC])).rows[0].n === 6);

  const notOwner = await svc("select public.tg_mod_bulk_create($1, $2, 'ban', 'all', null, null) d", [T1, MC]);
  check("a non-owner cannot create a mass action", String(notOwner.error).includes("forbidden"));
  const draft = (await svc("select public.tg_mod_bulk_create($1, $2, 'ban', 'all', null, array[$3]::bigint[]) d", [TO, MC, T2])).rows?.[0]?.d;
  const tg = (await c.query("select user_id from tg_mod_bulk_targets where bulk_id = $1 order by user_id", [draft?.id])).rows.map((r) => Number(r.user_id));
  check("mass ban targets known members only, without owner, excluded admins and left users",
    draft?.total === 3 && tg.join() === [T1, 9100000011, 9100000012].sort((a, b) => a - b).join(), JSON.stringify({ total: draft?.total, tg }));
  check("mass ban preview has names", draft?.preview?.includes("Новичок") && draft?.preview?.includes("@nick12"));
  const list = (await svc("select public.tg_mod_bulk_create($1, $2, 'kick', 'list', array[$3, 9100000099, $1]::bigint[], null) d", [TO, MC, T1])).rows?.[0]?.d;
  check("an id list excludes the owner", list?.total === 2);
  check("a new draft cancels the previous one", (await c.query("select status from tg_mod_bulk where id = $1", [draft.id])).rows[0].status === "cancelled");

  const run = (await svc("select public.tg_mod_bulk_create($1, $2, 'ban', 'all', null, null) d", [TO, MC])).rows[0].d;
  await c.query("update tg_mod_bulk set status = 'running' where id = $1", [run.id]);
  const bres = [{ user_id: T1, status: "ok" }, { user_id: 9100000011, status: "already" }, { user_id: T2, status: "failed", error: "x" }];
  await svc("select public.tg_mod_bulk_report($1, $2)", [run.id, JSON.stringify(bres)]);
  const bagain = (await svc("select public.tg_mod_bulk_report($1, $2) r", [run.id, JSON.stringify(bres)])).rows[0].r;
  check("batch results are counted once even if reported twice", bagain.ok === 1 && bagain.failed === 1 && bagain.skipped === 1 && bagain.status === "running");
  const fin = (await svc("select public.tg_mod_bulk_report($1, $2) r", [run.id, JSON.stringify([{ user_id: 9100000012, status: "ok" }])])).rows[0].r;
  check("the operation finishes when nothing is pending", fin.status === "done" && fin.ok === 2);
  check("banned members are marked in the member list", (await c.query("select status from tg_chat_members where chat_id = $1 and telegram_id = $2", [MC, T1])).rows[0].status === "kicked");
  check("successful bans are logged with the operation id", (await c.query("select count(*)::int n from tg_mod_actions where bulk_id = $1 and status = 'ok'", [run.id])).rows[0].n === 2);
  check("only the initiator can undo", String((await svc("select public.tg_mod_bulk_undo($1, $2)", [T1, run.id])).error).includes("forbidden"));
  const undo = (await svc("select public.tg_mod_bulk_undo($1, $2) u", [TO, run.id])).rows?.[0]?.u;
  const undoT = (await c.query("select user_id from tg_mod_bulk_targets where bulk_id = $1 order by user_id", [undo?.id])).rows.map((r) => Number(r.user_id));
  check("undo unbans only users this operation banned (not the already-banned one)", undo?.total === 2 && undoT.join() === [T1, 9100000012].sort((a, b) => a - b).join());
  check("an undo cannot be created twice", String((await svc("select public.tg_mod_bulk_undo($1, $2)", [TO, run.id])).error).includes("already_exists"));

  await c.query("insert into tg_mod_actions (chat_id, target_id, moderator_id, action, status, expires_at) values ($1, $2, $3, 'mute', 'ok', now() + interval '1 hour'), ($1, 9100000011, $3, 'ban', 'ok', null), ($1, 9100000011, $3, 'unban', 'ok', null), ($1, 9100000012, $3, 'mute', 'ok', now() - interval '1 minute')", [MC, T2, TO]);
  const active = (await svc("select public.tg_mod_active($1) a", [MC])).rows[0].a;
  check("active punishments: latest action wins, expired ones drop out", active.items.some((x) => Number(x.user_id) === T2 && x.action === "mute") && !active.items.some((x) => Number(x.user_id) === 9100000011) && !active.items.some((x) => Number(x.user_id) === 9100000012 && x.action === "mute"));
  const st = (await svc("select public.tg_mod_stats($1) s", [MC])).rows[0].s;
  check("moderation stats", st.bans >= 3 && st.mutes >= 2 && st.bulk === 1);
  await c.query("insert into tg_mod_warnings (chat_id, user_id, moderator_id, reason) values ($1, $2, $3, 'a'), ($1, $2, $3, 'b')", [MC, T2, TO]);
  check("warnings list per user", (await svc("select public.tg_mod_warn_list($1) w", [MC])).rows[0].w[0]?.count === 2);
  await c.query("insert into tg_mod_autodelete (chat_id, message_id, delete_at) values ($1, 1, now() - interval '1 second'), ($1, 2, now() + interval '1 hour')", [MC]);
  const due = (await svc("select * from public.tg_mod_autodelete_due()")).rows ?? [];
  check("only due notices are handed out, once", due.filter((r) => Number(r.chat_id) === MC).length === 1 && (await svc("select * from public.tg_mod_autodelete_due()")).rows.filter((r) => Number(r.chat_id) === MC).length === 0);
  for (const role of ["anon", "authenticated"]) {
    check(`${role} cannot use moderation functions or tables`,
      Boolean((await as(role, "select public.tg_mod_bulk_create($1, $2, 'ban', 'all', null, null)", [TO, MC], ownerUid)).error) &&
      Boolean((await as(role, "select * from tg_mod_actions limit 1", [], ownerUid)).error) &&
      Boolean((await as(role, "select public.tg_mod_is_owner($1)", [TO], ownerUid)).error));
  }
  const gameAfter = (await c.query("select count(*)::int n, coalesce(sum(cash), 0)::text s from wallets")).rows[0];
  check("moderation changes no game balances or game bans",
    gameAfter.n === gameBefore.n && gameAfter.s === gameBefore.s && (await c.query("select count(*)::int n from profiles where status = 'blocked'")).rows[0].n === banBefore);
} finally {
  await c.query("rollback");
  await c.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (transaction rolled back, no data kept)`);
process.exit(failed.length ? 1 : 0);
