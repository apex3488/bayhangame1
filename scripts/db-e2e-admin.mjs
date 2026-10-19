// Admin panel tests (migration 0012): role checks, audit trail and every admin action.
// Runs in one transaction that is rolled back, like db-e2e.mjs.
import { connect } from "./db-env.mjs";

const c = await connect();
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const failed = (r, code) => typeof r.error === "string" && r.error.includes(code);
let n = 0;
const key = () => `admin-test-key-${String(++n).padStart(4, "0")}`;

async function makeUser(login, gameName) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, 'x', $2, now(), now())
     returning id`,
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
    return { rows };
  } catch (e) {
    await c.query("rollback to savepoint p");
    await c.query("reset role");
    return { error: e.message };
  }
}
const r1 = async (uid, sql, params) => {
  const res = await as(uid, sql, params);
  return res.error ? res : { ...res, r: res.rows?.[0]?.r };
};
const cash = async (uid) => Number((await c.query("select cash from wallets where user_id = $1", [uid])).rows[0].cash);
const auditCount = async (action) => Number((await c.query("select count(*) n from audit_logs where action = $1", [action])).rows[0].n);

await c.query("begin");
try {
  const owner = await makeUser("adm_owner", "Adm Owner");
  const admin = await makeUser("adm_admin", "Adm Admin");
  const mod = await makeUser("adm_mod", "Adm Mod");
  const op = await makeUser("adm_op", "Adm Op");
  const player = await makeUser("adm_player", "Adm Player");
  await c.query("insert into admin_roles (user_id, role) values ($1,'owner'),($2,'admin'),($3,'moderator'),($4,'operator')", [owner, admin, mod, op]);

  // --- Access control -------------------------------------------------------
  for (const fn of ["admin_dashboard()", "admin_search_players('')", "admin_list_promos()", "admin_audit()", "admin_list_jobs()"]) {
    const r = await as(player, `select * from ${fn}`);
    check(`player cannot call ${fn}`, failed(r, "forbidden"), r.error);
  }
  await c.query("savepoint anon");
  await c.query("set local role anon");
  const anon = await c.query("select admin_dashboard()").then(() => "ok", (e) => e.message);
  await c.query("rollback to savepoint anon");
  await c.query("reset role");
  check("anonymous visitors cannot even call admin functions", anon.includes("permission denied"), anon);
  const me = await r1(player, "select admin_me() r");
  check("admin_me reports no role for a player", me.r?.role === null, JSON.stringify(me.r));
  const meA = await r1(admin, "select admin_me() r");
  check("admin_me reports role 'admin'", meA.r?.role === "admin");

  const dash = await r1(op, "select admin_dashboard() r");
  const total = Number((await c.query("select count(*) n from profiles")).rows[0].n);
  check("operator sees dashboard with real player count", Number(dash.r?.players_total) === total, `${dash.r?.players_total} vs ${total}`);
  const series = await as(op, "select * from admin_daily_stats(7)");
  check("daily stats return 7 days", series.rows?.length === 7, series.error);
  const search = await as(op, "select * from admin_search_players('adm_play')");
  check("search finds player by login", search.rows?.length === 1 && search.rows[0].game_name === "Adm Player", JSON.stringify(search));
  const detail = await r1(op, "select admin_player($1) r", [player]);
  check("player detail includes wallet and ledger", Number(detail.r?.wallet?.cash) === 50000 && detail.r.ledger.length === 1, JSON.stringify(detail.r?.wallet));

  // --- Status ---------------------------------------------------------------
  const opBlock = await as(op, "select admin_set_status($1, 'blocked', 'spam test') r", [player]);
  check("operator cannot block", failed(opBlock, "forbidden"), opBlock.error);
  const noReason = await as(mod, "select admin_set_status($1, 'blocked', 'x') r", [player]);
  check("block requires a reason", failed(noReason, "reason_required"), noReason.error);
  const modBlock = await r1(mod, "select admin_set_status($1, 'blocked', 'spam test') r", [player]);
  check("moderator blocks a player", modBlock.r?.status === "ok", modBlock.error);
  const blockedShift = await as(player, "select work_shift('courier', $1) r", [key()]);
  check("blocked player cannot work", failed(blockedShift, "account_restricted"), blockedShift.error);
  const modVsAdmin = await as(mod, "select admin_set_status($1, 'blocked', 'try block admin') r", [admin]);
  check("moderator cannot block an admin", failed(modVsAdmin, "forbidden"), modVsAdmin.error);
  const self = await as(mod, "select admin_set_status($1, 'blocked', 'block myself') r", [mod]);
  check("cannot change own status", failed(self, "cannot_target_self"), self.error);
  await r1(mod, "select admin_set_status($1, 'active', 'appeal accepted') r", [player]);
  check("status changes are audited", (await auditCount("status_change")) >= 2);

  // --- Balances -------------------------------------------------------------
  const modAdj = await as(mod, "select admin_adjust_balance($1, 'cash', 100, 'compensation', $2) r", [player, key()]);
  check("moderator cannot change balances", failed(modAdj, "forbidden"), modAdj.error);
  const adj = await r1(admin, "select admin_adjust_balance($1, 'cash', 1234.56, 'event prize', $2) r", [player, key()]);
  check("admin credits wallet with before/after", Number(adj.r?.before) === 50000 && Number(adj.r?.after) === 51234.56, JSON.stringify(adj.r));
  const adjBtc = await r1(admin, "select admin_adjust_balance($1, 'btc', 0.12345678, 'btc prize', $2) r", [player, key()]);
  check("admin credits BTC with 8 decimals", Number(adjBtc.r?.after) === 0.12345678, JSON.stringify(adjBtc));
  const over = await as(admin, "select admin_adjust_balance($1, 'cash', -999999999, 'too much', $2) r", [player, key()]);
  check("admin debit cannot exceed limit / balance", over.error, over.error);
  const auditAdj = (await c.query("select payload from audit_logs where action = 'balance_adjust' order by id desc limit 1")).rows[0]?.payload;
  check("balance audit stores before/after and reason", auditAdj?.reason === "btc prize" && auditAdj.after !== undefined, JSON.stringify(auditAdj));

  // --- Economy, games, jobs ---------------------------------------------------
  const set = await r1(admin, "select admin_set_economy_setting('daily_base', 150000) r");
  check("admin changes economy setting", set.r?.status === "ok");
  const ds = await as(player, "select daily_status() s");
  check("daily reward follows the new base", Number(ds.rows?.[0]?.s?.reward) === 150000, JSON.stringify(ds));
  const modSet = await as(mod, "select admin_set_economy_setting('daily_base', 1) r");
  check("moderator cannot change economy", failed(modSet, "forbidden"), modSet.error);
  await r1(admin, "select admin_set_game('dice', true, 500, 2000) r");
  const lowBet = await as(player, "select play_game('dice', 100, '{\"pick\":1}', $1) r", [key()]);
  check("new game minimum bet enforced", failed(lowBet, "invalid_bet"), lowBet.error);
  await r1(admin, "select admin_set_game('dice', false, 500, 2000) r");
  const off = await as(player, "select play_game('dice', 600, '{\"pick\":1}', $1) r", [key()]);
  check("admin can disable a game", failed(off, "game_disabled"), off.error);
  const badGame = await as(admin, "select admin_set_game('dice', true, 3000, 1000) r");
  check("game limits validated (max ≥ min)", failed(badGame, "invalid_value"), badGame.error);
  const job = await r1(admin, "select admin_set_job('courier', 100, 200, 0, 0, 5, true) r");
  check("admin edits job", job.r?.status === "ok");
  const shift = await r1(player, "select work_shift('courier', $1) r", [key()]);
  check("shift pays within the new range", Number(shift.r?.salary) >= 100 && Number(shift.r?.salary) <= 200, JSON.stringify(shift));

  // --- Promo codes ---------------------------------------------------------
  const pc = await r1(admin, "select admin_create_promo('adm_gift', 777, 0, 1, null, null) r");
  check("admin creates promo (code upper-cased)", pc.r?.code === "ADM_GIFT", JSON.stringify(pc));
  const dupPc = await as(admin, "select admin_create_promo('ADM_GIFT', 1, 0, 1, null, null) r");
  check("duplicate promo code rejected", failed(dupPc, "already_exists"), dupPc.error);
  await r1(admin, "select admin_set_promo_active('ADM_GIFT', false) r");
  const inactive = await as(player, "select redeem_promo('ADM_GIFT') r");
  check("disabled promo cannot be redeemed", failed(inactive, "promo_inactive"), inactive.error);
  await r1(admin, "select admin_set_promo_active('ADM_GIFT', true) r");
  const before = await cash(player);
  await r1(player, "select redeem_promo('ADM_GIFT') r");
  check("re-enabled promo pays $777", (await cash(player)) === before + 777);
  const reds = await as(op, "select * from admin_promo_redemptions('ADM_GIFT')");
  check("redemptions visible to staff", reds.rows?.length === 1 && reds.rows[0].game_name === "Adm Player");
  const expired = await as(admin, "select admin_create_promo('ADM_OLD', 10, 0, 5, now(), now() - interval '1 day') r");
  check("promo expiry must be after start", failed(expired, "invalid_value"), expired.error);

  // --- Events and VIP ------------------------------------------------------
  const ev = await r1(admin, "select admin_create_event('adm_x3', 'Triple', 'test', 'daily', 3, now() - interval '1 minute', now() + interval '1 hour') r");
  check("admin creates event", ev.r?.status === "ok", ev.error);
  const ds3 = await as(player, "select daily_status() s");
  check("event triples daily reward (150k × 3)", Number(ds3.rows?.[0]?.s?.reward) === 450000, JSON.stringify(ds3.rows?.[0]?.s));
  await r1(admin, "select admin_set_event_active('adm_x3', false) r");
  const ds4 = await as(player, "select daily_status() s");
  check("disabled event stops applying", Number(ds4.rows?.[0]?.s?.reward) === 150000);
  await r1(admin, "select admin_grant_vip($1, 2, 7, 'loyal player') r", [player]);
  const vips = await as(op, "select * from admin_list_vip()");
  check("VIP list shows granted VIP", vips.rows?.some((v) => v.game_name === "Adm Player" && v.level === 2 && v.active));
  const rv = await r1(admin, "select admin_revoke_vip($1, 'test revoke') r", [player]);
  check("admin revokes VIP", rv.r?.status === "ok" && (await as(op, "select * from admin_list_vip()")).rows.every((v) => v.game_name !== "Adm Player"));

  // --- Roles -----------------------------------------------------------------
  const adminRole = await as(admin, "select admin_set_role($1, 'moderator') r", [player]);
  check("admin cannot grant roles", failed(adminRole, "forbidden"), adminRole.error);
  const grant = await r1(owner, "select admin_set_role($1, 'operator') r", [player]);
  check("owner grants operator role", grant.r?.status === "ok" && (await r1(player, "select admin_me() r")).r.role === "operator");
  const ownerRole = await as(owner, "select admin_set_role($1, 'owner') r", [player]);
  check("owner role cannot be granted through the panel", failed(ownerRole, "invalid_choice"), ownerRole.error);
  await r1(owner, "select admin_set_role($1, null) r", [player]);
  check("owner revokes role", (await r1(player, "select admin_me() r")).r.role === null);
  const selfRole = await as(owner, "select admin_set_role($1, null) r", [owner]);
  check("owner cannot remove own role", failed(selfRole, "cannot_target_self"), selfRole.error);

  // --- Audit -----------------------------------------------------------------
  await r1(op, "select admin_session_start() r");
  const log = await as(op, "select * from admin_audit(null, 200, 0)");
  const actions = new Set(log.rows?.map((r) => r.action));
  check("audit log lists every action type performed",
    ["admin_login", "status_change", "balance_adjust", "economy_setting_change", "game_settings_change", "job_change", "promo_create",
      "promo_disable", "promo_enable", "event_create", "event_disable", "vip_grant", "vip_revoke", "role_change"].every((a) => actions.has(a)),
    [...actions].join(","));
  const filtered = await as(op, "select * from admin_audit('promo_create', 50, 0)");
  check("audit filter by action", filtered.rows?.length >= 1 && filtered.rows.every((r) => r.action === "promo_create"));
  check("audit shows target player name", log.rows?.some((r) => r.action === "balance_adjust" && r.target_name === "Adm Player"));
  const tamper = await as(admin, "delete from audit_logs");
  check("staff cannot delete audit entries", failed(tamper, "permission denied"), tamper.error);

  await r1(player, "select transfer_funds('Adm Admin', 60000, $1) r", [key()]).catch(() => {});
  await c.query("select _apply_wallet_change($1, 'cash', 100000, 'admin_credit', 'fund', 'fund-adm-player')", [player]);
  await r1(player, "select transfer_funds('Adm Admin', 60000, $1) r", [key()]);
  const big = await as(op, "select * from admin_large_transfers(50000, 20)");
  check("large transfers report shows sender and receiver", big.rows?.some((r) => r.sender === "Adm Player" && r.receiver === "Adm Admin" && Number(r.amount) === 60000), JSON.stringify(big.rows?.slice(0, 2)));

  // --- Mines secret code (0014). A temporary code inside this rolled-back transaction. ---
  await c.query("insert into game_secrets (key, code_hash) values ('mines_reveal', _sha256_hex('0000')) on conflict (key) do update set code_hash = excluded.code_hash");
  const gamer = await makeUser("adm_gamer", "Adm Gamer");
  const rnd = (await r1(gamer, "select mines_start(1000, 3, $1) r", [key()])).r;
  const wrong = await r1(gamer, "select mines_reveal($1, '1111') r", [rnd.round_id]);
  check("wrong secret code refused, attempts counted", wrong.r?.status === "wrong_code" && wrong.r.attempts_left === 4, JSON.stringify(wrong));
  const right = await r1(gamer, "select mines_reveal($1, '0000') r", [rnd.round_id]);
  const truth = (await c.query("select secret->'mines' m from game_round_secrets where round_id = $1", [rnd.round_id])).rows[0].m;
  check("correct code returns the real mine positions", JSON.stringify(right.r?.mine_positions) === JSON.stringify(truth), JSON.stringify(right));
  check("secret use is audited", Number((await c.query("select count(*) n from audit_logs where action = 'mines_secret_reveal' and target_id = $1", [rnd.round_id])).rows[0].n) === 1);
  const foreignRound = await as(player, "select mines_reveal($1, '0000') r", [rnd.round_id]);
  check("cannot reveal another player's round", failed(foreignRound, "round_not_found"), foreignRound.error);
  for (let i = 0; i < 4; i++) await r1(gamer, "select mines_reveal($1, '9999') r", [rnd.round_id]);
  const limited = await as(gamer, "select mines_reveal($1, '0000') r", [rnd.round_id]);
  check("5 wrong attempts per hour → blocked even with the right code", failed(limited, "too_many_attempts"), limited.error);
  const peekSecret = await as(gamer, "select * from game_secrets");
  check("players cannot read the stored code hash", failed(peekSecret, "permission denied") || peekSecret.rows?.length === 0, JSON.stringify(peekSecret));

  // --- Profile appearance (0017–0018) -----------------------------------------
  const bioOk = await r1(gamer, "select update_profile_appearance('Hello, I am a tycoon', 'aurora') r");
  check("player sets bio and preset background", bioOk.r?.status === "ok", bioOk.error);
  const longBio = await as(gamer, "select update_profile_appearance($1, 'aurora') r", ["x".repeat(201)]);
  check("bio longer than 200 chars rejected", failed(longBio, "bio_too_long"), longBio.error);
  const badBg = await as(gamer, "select update_profile_appearance('hi', 'hacked') r");
  check("unknown background preset rejected", failed(badBg, "invalid_choice"), badBg.error);
  const noCustom = await as(gamer, "select update_profile_appearance('hi', 'custom') r");
  check("custom background needs an uploaded image", failed(noCustom, "no_custom_background"), noCustom.error);
  const missing = await as(gamer, "select set_profile_media('avatar', true) r");
  check("avatar cannot be enabled without an upload", failed(missing, "upload_missing"), missing.error);

  // Storage rules, exercised as the player through RLS.
  const ownUpload = await as(gamer, "insert into storage.objects (bucket_id, name, owner_id) values ('profile-media', $1, $2) returning name r", [`${gamer}/avatar`, gamer]);
  check("player may upload to own folder", ownUpload.rows?.length === 1, ownUpload.error);
  const foreignUpload = await as(gamer, "insert into storage.objects (bucket_id, name) values ('profile-media', $1) returning name r", [`${player}/avatar`]);
  check("player cannot upload into another player's folder", failed(foreignUpload, "row-level security"), foreignUpload.error);
  const oddName = await as(gamer, "insert into storage.objects (bucket_id, name) values ('profile-media', $1) returning name r", [`${gamer}/virus.exe`]);
  check("only 'avatar' / 'background' file names allowed", failed(oddName, "row-level security"), oddName.error);
  const av = await r1(gamer, "select set_profile_media('avatar', true) r");
  check("avatar enabled after upload, versioned", Number(av.r?.version) > 0, JSON.stringify(av));
  const pub = await r1(player, "select public_profile('adm gamer') r");
  check("public profile shows bio, background and avatar", pub.r?.bio === "Hello, I am a tycoon" && pub.r.background === "aurora" && Number(pub.r.avatar_version) > 0, JSON.stringify(pub.r));
  check("public profile hides private data", pub.r && !("cash" in pub.r) && !("login" in pub.r));
  const lb = await as(player, "select * from leaderboard_capital(100)");
  check("leaderboard carries avatar versions", lb.rows?.some((r) => r.game_name === "Adm Gamer" && Number(r.avatar_version) > 0));

  const plClear = await as(player, "select admin_clear_profile_media($1, 'avatar', 'inappropriate') r", [gamer]);
  check("players cannot clear others' media", failed(plClear, "forbidden"), plClear.error);
  const modClear = await r1(mod, "select admin_clear_profile_media($1, 'avatar', 'inappropriate image') r", [gamer]);
  check("moderator hides avatar and gets file path to delete", modClear.r?.path === `${gamer}/avatar`, JSON.stringify(modClear));
  const after = await r1(player, "select public_profile('adm gamer') r");
  check("cleared avatar no longer shown", after.r?.avatar_version === null);
  await r1(mod, "select admin_clear_profile_media($1, 'bio', 'offensive words') r", [gamer]);
  check("moderator clears bio, audited", (await r1(player, "select public_profile('adm gamer') r")).r?.bio === ""
    && Number((await c.query("select count(*) n from audit_logs where action = 'profile_media_clear' and target_id = $1", [gamer])).rows[0].n) === 2);
} finally {
  await c.query("rollback");
  await c.end();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  ->  ${r.detail}`}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed (transaction rolled back, no data kept)`);
if (passed !== results.length) process.exitCode = 1;
