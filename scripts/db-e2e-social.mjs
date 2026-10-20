// Notifications, broadcasts and news (migration 0019).
// Runs in one transaction that is rolled back, like the other db-e2e scripts.
import { connect } from "./db-env.mjs";

const c = await connect();
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const failed = (r, code) => typeof r.error === "string" && r.error.includes(code);
let n = 0;
const key = () => `social-test-key-${String(++n).padStart(4, "0")}`;

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
const inbox = async (uid) => (await r1(uid, "select my_notifications(50) r")).r;
async function anonCall(sql) {
  await c.query("savepoint anon");
  await c.query("set local role anon");
  const res = await c.query(sql).then(() => "ok", (e) => e.message);
  await c.query("rollback to savepoint anon");
  await c.query("reset role");
  return res;
}

await c.query("begin");
try {
  const owner = await makeUser("soc_owner", "Soc Owner");
  const admin = await makeUser("soc_admin", "Soc Admin");
  const mod = await makeUser("soc_mod", "Soc Mod");
  const alice = await makeUser("soc_alice", "Soc Alice");
  const bob = await makeUser("soc_bob", "Soc Bob");
  await c.query("insert into admin_roles (user_id, role) values ($1,'owner'),($2,'admin'),($3,'moderator')", [owner, admin, mod]);

  // --- access ---------------------------------------------------------------
  for (const fn of ["my_notifications()", "news_list()", "admin_broadcast('a','b')"]) {
    const res = await anonCall(`select ${fn}`);
    check(`anonymous cannot call ${fn}`, res.includes("permission denied"), res);
  }
  for (const [who, uid] of [["player", alice], ["moderator", mod]]) {
    const b = await as(uid, "select admin_broadcast('Hi', 'Body')");
    check(`${who} cannot broadcast`, failed(b, "forbidden"), b.error);
    const p = await as(uid, "select admin_publish_news('Title', 'Body')");
    check(`${who} cannot publish news`, failed(p, "forbidden"), p.error);
  }
  const direct = await as(alice, "select * from notifications");
  check("notifications table is not readable directly", direct.rows?.length === 0 || failed(direct, "permission denied"), JSON.stringify(direct));
  const directIns = await as(alice, "insert into notifications (user_id, kind) values ($1, 'broadcast')", [alice]);
  check("players cannot write notifications directly", failed(directIns, "permission denied") || failed(directIns, "row-level security"), directIns.error);

  // --- broadcasts -----------------------------------------------------------
  const before = (await inbox(alice)).unread;
  const all = await r1(owner, "select admin_broadcast('Обновление', 'Новая версия игры!', '/news') r");
  const eligible = Number((await c.query("select count(*) n from profiles where status <> 'blocked'")).rows[0].n);
  check("owner broadcast reaches every non-blocked player", all.r?.recipients === eligible, `${all.r?.recipients} vs ${eligible} ${all.error ?? ""}`);
  const a1 = await inbox(alice);
  check("player sees the broadcast as unread", a1.unread === before + 1 && a1.items[0].kind === "broadcast" && a1.items[0].title === "Обновление" && a1.items[0].link === "/news", JSON.stringify(a1.items[0]));
  const one = await r1(admin, "select admin_broadcast('Лично', 'Только Бобу', null, $1) r", [bob]);
  check("admin can message one player", one.r?.recipients === 1, one.error);
  check("other players do not get a personal message", (await inbox(alice)).items.every((x) => x.title !== "Лично"));
  check("the recipient gets it", (await inbox(bob)).items.some((x) => x.title === "Лично" && x.body === "Только Бобу"));
  const evil = await as(owner, "select admin_broadcast('x', 'y', 'https://evil.example/login')");
  check("external links are rejected (phishing)", failed(evil, "invalid_link"), evil.error);
  const js = await as(owner, "select admin_broadcast('x', 'y', 'javascript:alert(1)')");
  check("javascript: links are rejected", failed(js, "invalid_link"), js.error);
  const empty = await as(owner, "select admin_broadcast('', 'y')");
  check("empty title is rejected", failed(empty, "invalid_text"), empty.error);
  const hist = await r1(owner, "select admin_list_broadcasts() r");
  check("broadcast history lists both sends", hist.r?.length >= 2 && hist.r[0].title === "Лично", JSON.stringify(hist.r?.[0]));
  check("broadcast is audited", Number((await c.query("select count(*) n from audit_logs where action = 'broadcast' and actor_id = $1", [owner])).rows[0].n) === 1);

  // --- read state -----------------------------------------------------------
  const firstId = a1.items[0].id;
  const steal = await r1(bob, "select notifications_mark_read($1) r", [[firstId]]);
  check("a player cannot mark someone else's notification", steal.r === 0, JSON.stringify(steal));
  const mark = await r1(alice, "select notifications_mark_read($1) r", [[firstId]]);
  check("marking one notification read", mark.r === 1 && (await inbox(alice)).unread === a1.unread - 1);
  await as(alice, "select notifications_mark_read()");
  check("mark all read", (await inbox(alice)).unread === 0 && (await r1(alice, "select my_unread_notifications() r")).r === 0);

  // --- automatic notifications ------------------------------------------------
  const tr = await as(alice, "select transfer_funds('Soc Bob', 1500, $1)", [key()]);
  check("transfer works", !tr.error, tr.error);
  const tb = (await inbox(bob)).items.find((x) => x.kind === "transfer_in");
  check("incoming transfer creates a notification with sender and amount", tb && tb.params.from === "Soc Alice" && Number(tb.params.amount) > 0 && tb.link === "/history", JSON.stringify(tb));
  check("the sender gets no transfer notification", !(await inbox(alice)).items.some((x) => x.kind === "transfer_in"));
  const adj = await as(owner, "select admin_adjust_balance($1, 'cash', 777, 'тест уведомлений', $2)", [alice, key()]);
  check("admin credit works", !adj.error, adj.error);
  const ac = (await inbox(alice)).items.find((x) => x.kind === "admin_credit");
  check("credit from the administration creates a notification", ac && Number(ac.params.amount) === 777 && ac.params.reason === "тест уведомлений", JSON.stringify(ac));
  const deb = await as(owner, "select admin_adjust_balance($1, 'cash', -10, 'списание', $2)", [alice, key()]);
  check("debits do not notify", !deb.error && (await inbox(alice)).items.filter((x) => x.kind === "admin_credit").length === 1, deb.error);
  const prop = await as(alice, "select marriage_propose('Soc Bob')");
  const mp = (await inbox(bob)).items.find((x) => x.kind === "marriage_proposal");
  check("marriage proposal notifies the partner", !prop.error && mp?.params.from === "Soc Alice" && mp.link === "/marriage", prop.error ?? JSON.stringify(mp));

  // --- news -----------------------------------------------------------------
  const bad = await as(owner, "select admin_publish_news('Заголовок', 'Текст', 'https://evil.example/x.png')");
  check("news image must be a news-media path", failed(bad, "invalid_image"), bad.error);
  const missing = await as(owner, "select admin_publish_news('Заголовок', 'Текст', 'news/00000000-0000-0000-0000-000000000000.webp')");
  check("news image must exist in storage", failed(missing, "upload_missing"), missing.error);
  const imgPath = "news/11111111-2222-3333-4444-555555555555.webp";
  const up = await as(owner, "insert into storage.objects (bucket_id, name, owner) values ('news-media', $1, $2)", [imgPath, owner]);
  check("owner can upload a news photo", !up.error, up.error);
  const upP = await as(alice, "insert into storage.objects (bucket_id, name, owner) values ('news-media', 'news/99999999-2222-3333-4444-555555555555.webp', $1)", [alice]);
  check("players cannot upload news photos", failed(upP, "row-level security"), upP.error);
  const upMod = await as(mod, "insert into storage.objects (bucket_id, name, owner) values ('news-media', 'news/88888888-2222-3333-4444-555555555555.webp', $1)", [mod]);
  check("moderators cannot upload news photos", failed(upMod, "row-level security"), upMod.error);
  const unreadBefore = (await inbox(bob)).unread;
  const pub = await r1(owner, "select admin_publish_news('Большое обновление', 'Мы запустили новую версию.', $1, true) r", [imgPath]);
  check("owner publishes news with a photo", pub.r?.id && pub.r.notified === eligible, pub.error ?? JSON.stringify(pub.r));
  const nb = await inbox(bob);
  check("players are notified about news", nb.unread === unreadBefore + 1 && nb.items[0].kind === "news" && nb.items[0].link === "/news");
  const list = await r1(alice, "select news_list() r");
  const post = list.r?.find((x) => x.id === pub.r.id);
  check("players see the news with photo and author", post && post.image_path === imgPath && post.author === "Soc Owner" && post.pinned === true, JSON.stringify(post));
  const quiet = await r1(admin, "select admin_publish_news('Тихая новость', 'Без уведомления', null, false, false) r");
  check("admin can publish without notifying", quiet.r?.notified === 0, quiet.error);
  const hide = await as(owner, "select admin_update_news($1, 'Тихая новость', 'Без уведомления', false, true)", [quiet.r.id]);
  check("hiding news", !hide.error && !(await r1(alice, "select news_list() r")).r.some((x) => x.id === quiet.r.id), hide.error);
  check("hidden news still visible in the admin list", (await r1(admin, "select admin_list_news() r")).r.some((x) => x.id === quiet.r.id && x.hidden));
  const del = await r1(owner, "select admin_delete_news($1) r", [pub.r.id]);
  check("deleting news returns the photo path for cleanup", del.r?.path === imgPath, del.error);
  check("deleting news removes its notifications", !(await inbox(bob)).items.some((x) => x.kind === "news" && x.params.news_id === pub.r.id));
  const modDel = await as(mod, "select admin_delete_news($1)", [quiet.r.id]);
  check("moderators cannot delete news", failed(modDel, "forbidden"), modDel.error);

  // --- big wins feed (0022) ---------------------------------------------------
  const anonFeed = await anonCall("select big_wins()");
  check("anonymous cannot read the big wins feed", anonFeed.includes("permission denied"), anonFeed);
  const mk = async (uid, mult, revealed) => {
    const id = (await c.query(
      `insert into game_rounds (user_id, game, bet, multiplier, payout, status, choice, result, idempotency_key, settled_at)
       values ($1, 'mines', 1000, $2::numeric, 1000 * $2::numeric, 'settled', '{}', '{}', $3, now()) returning id`, [uid, mult, key()])).rows[0].id;
    if (revealed) await c.query("insert into audit_logs (actor_id, action, target_type, target_id, payload) values ($1, 'mines_secret_reveal', 'game_round', $2, '{}')", [uid, id]);
    return id;
  };
  const honest = await mk(alice, 12, false);
  const cheat = await mk(bob, 50, true);
  const small = await mk(alice, 1.5, false);
  const feed = (await r1(bob, "select big_wins(30) r")).r ?? [];
  check("feed shows an honest big win with player name", feed.some((w) => w.id === honest && w.game_name === "Soc Alice" && Number(w.multiplier) === 12), JSON.stringify(feed.slice(0, 2)));
  check("feed hides wins made with a secret code", !feed.some((w) => w.id === cheat));
  check("feed hides small wins (under ×3)", !feed.some((w) => w.id === small));
} finally {
  await c.query("rollback");
  await c.end();
}

const bad = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
