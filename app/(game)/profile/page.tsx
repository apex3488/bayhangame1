"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { LogOut, Pencil, Volume2, VolumeX } from "lucide-react";
import { play, setSoundEnabled, soundEnabled } from "@/lib/sound";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { LANGS } from "@/lib/i18n";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { CosmeticPreview, RARITY_COLOR, cosmeticName } from "@/components/cosmetic-view";
import { ProfileHero } from "@/components/profile-hero";
import { AppearanceEditor } from "@/components/appearance-editor";
import { PasswordCard, TelegramCard } from "@/components/telegram-card";
import { uploadMedia, type MediaKind } from "@/lib/profile";
import { TextForm } from "@/components/forms";
import { Button, Money, PageTitle, Reveal, Skeleton, formatCompact } from "@/components/ui";
import {
  cosmeticEquip,
  cosmeticUnequip,
  fetchCosmetics,
  fetchMyCosmetics,
  fetchProfile,
  fetchVip,
  renameGameName,
  type CosmeticItem,
  type Slot,
} from "@/lib/economy";

type Profile = Awaited<ReturnType<typeof fetchProfile>>;

export default function ProfilePage() {
  const { t, snapshot, loadout, refreshLoadout, refresh, lang, setLang } = useGame();
  const router = useRouter();
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundEnabled()), []);
  async function logout() {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }
  const { busy, run } = useAction();
  const [p, setP] = useState<Profile | null>(null);
  const [vip, setVip] = useState<{ level: number; active: boolean; multiplier: number; ends_at?: string } | null>(null);
  const [items, setItems] = useState<CosmeticItem[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [uploading, setUploading] = useState<MediaKind | null>(null);
  const { toast, toastError } = useGame();

  async function upload(kind: MediaKind, file: File) {
    if (!snapshot) return;
    setUploading(kind);
    try {
      await uploadMedia(snapshot.user_id, kind, file);
      toast(t(kind === "avatar" ? "avatarUpdated" : "backgroundUpdated"), "success");
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(null);
    }
  }

  const load = useCallback(() => {
    fetchProfile().then(setP).catch(() => {});
    fetchVip().then(setVip).catch(() => {});
    Promise.all([fetchCosmetics(), fetchMyCosmetics()]).then(([all, mine]) => {
      const own = new Set(mine.map((m) => m.code));
      setItems(all.filter((i) => own.has(i.code) && i.category !== "box"));
    });
  }, []);
  useEffect(load, [load]);

  if (!p || !snapshot) return <Skeleton className="h-96" />;
  const s = p.stats;
  const winRate = Number(s.games_played) > 0 ? Math.round((Number(s.games_won) / Number(s.games_played)) * 100) : 0;

  return (
    <div>
      <Reveal>
        <ProfileHero
          data={{ id: snapshot.user_id, game_name: p.game_name, bio: snapshot.bio, avatar_version: snapshot.avatar_version, background: snapshot.background, background_version: snapshot.background_version }}
          loadout={loadout}
          vipLevel={vip?.active ? vip.level : null}
          busy={uploading}
          labels={{ avatar: t("uploadAvatar"), background: t("uploadBackground") }}
          onPickAvatar={(file) => upload("avatar", file)}
          onPickBackground={(file) => upload("background", file)}
          meta={
            <>
              {t("playerId")} #{p.public_id} · {t("memberSince")} {new Date(p.created_at).toLocaleDateString()} · {t("level")} {p.level}
              <button onClick={() => setRenaming((v) => !v)} className="ml-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent-2)] hover:underline">
                <Pencil size={12} /> {t("rename")}
              </button>
            </>
          }
          right={
            <div className="pb-1 text-right">
              <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{t("capital")}</p>
              <Money value={Number(snapshot.total_capital)} className="font-display text-3xl font-semibold" />
            </div>
          }
        >
          {renaming && (
            <div className="mt-4 max-w-sm">
              <TextForm
                action={t("save")}
                maxLength={20}
                initial={p.game_name}
                busy={busy === "rename"}
                onSubmit={async (name) => {
                  const r = await run("rename", () => renameGameName(name), () => t("renamed"));
                  if (r) {
                    setRenaming(false);
                    load();
                    refresh();
                  }
                  return r;
                }}
              />
            </div>
          )}
        </ProfileHero>
      </Reveal>

      <Reveal delay={0.03}>
        <AppearanceEditor key={snapshot.bio + snapshot.background} />
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Reveal delay={0.05}>
          <div className="panel grid grid-cols-2 gap-3 p-5">
            <Stat label={t("gamesPlayed")} value={String(s.games_played)} />
            <Stat label={t("winRate")} value={`${winRate}%`} />
            <Stat label={t("totalWagered")} value={`$${formatCompact(Number(s.total_wagered))}`} />
            <Stat label={t("totalWon")} value={`$${formatCompact(Number(s.total_won))}`} />
            <Stat label={t("shiftsDone")} value={String(s.shifts)} />
            <Stat label={t("mined")} value={String(s.mined)} />
            <Stat label={t("wallet")} value={`$${formatCompact(Number(snapshot.cash))}`} />
            <Stat label={t("assets")} value={`$${formatCompact(Number(snapshot.assets_value))}`} />
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">{t("myItems")}</p>
              <Link href="/store" className="text-xs text-[var(--accent-2)] hover:underline">
                {t("store")} →
              </Link>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((it) => {
                  const slot = it.category as Slot;
                  const on = loadout[slot]?.code === it.code;
                  return (
                    <motion.button
                      key={it.code}
                      whileTap={{ scale: 0.96 }}
                      disabled={busy !== null}
                      onClick={async () => {
                        await run(`eq-${it.code}`, () => (on ? cosmeticUnequip(slot) : cosmeticEquip(it.code)));
                        refreshLoadout();
                      }}
                      className="flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors"
                      style={{ borderColor: on ? RARITY_COLOR[it.rarity] : "var(--border)", background: on ? `${RARITY_COLOR[it.rarity]}14` : "var(--bg-2)" }}
                    >
                      <div className="grid h-12 place-items-center">
                        <CosmeticPreview item={it} size={44} />
                      </div>
                      <span className="text-xs font-semibold">{cosmeticName(it.code)}</span>
                      <span className="text-[10px]" style={{ color: on ? RARITY_COLOR[it.rarity] : "var(--muted)" }}>
                        {on ? t("equipped") : t(`cat_${it.category}`)}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div className="panel mt-5 flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm font-semibold">{t("settings")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border)] bg-[var(--bg-2)] p-1">
              {LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${lang === l ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-white"}`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Button variant="ghost" className="py-2 text-xs" onClick={() => { const on = !sound; setSoundEnabled(on); setSound(on); if (on) play("coin"); }}>
              {sound ? <Volume2 size={14} /> : <VolumeX size={14} />} {sound ? t("soundOn") : t("soundOff")}
            </Button>
            <Button variant="ghost" className="py-2 text-xs" onClick={logout}>
              <LogOut size={14} /> {t("logout")}
            </Button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.11}>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <TelegramCard />
          <PasswordCard login={p?.login} />
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["/quests", "quests"],
            ["/history", "history"],
            ["/referrals", "referrals"],
          ].map(([href, key]) => (
            <Link key={href} href={href}>
              <Button variant="ghost" className="w-full">
                {t(key)}
              </Button>
            </Link>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-2)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display mt-1 text-xl font-semibold tabular">{value}</p>
    </div>
  );
}
