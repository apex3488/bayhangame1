"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Heart } from "lucide-react";
import { useGame } from "@/components/game-context";
import { ProfileHero } from "@/components/profile-hero";
import { Money, Reveal, Skeleton } from "@/components/ui";
import { fetchPublicProfile, type PublicProfile } from "@/lib/profile";
import type { Loadout } from "@/lib/economy";

export default function PublicPlayerPage() {
  const { t, snapshot } = useGame();
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name ?? "");
  const [p, setP] = useState<PublicProfile | null | undefined>(undefined);

  useEffect(() => {
    setP(undefined);
    fetchPublicProfile(name).then(setP).catch(() => setP(null));
  }, [name]);

  if (p === undefined) return <Skeleton className="h-96" />;
  if (p === null) {
    return (
      <div className="panel p-8 text-center">
        <p className="mb-4 text-[var(--muted)]">{t("playerNotFound")}</p>
        <Link href="/leaderboard" className="text-sm text-[var(--accent-2)] hover:underline">
          ← {t("leaderboard")}
        </Link>
      </div>
    );
  }

  const isMe = snapshot?.user_id === p.id;
  const winRate = p.stats.games_played > 0 ? Math.round((p.stats.games_won / p.stats.games_played) * 100) : 0;

  return (
    <div>
      <Link href="/leaderboard" className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-white">
        <ArrowLeft size={15} /> {t("leaderboard")}
      </Link>
      <Reveal>
        <ProfileHero
          data={p}
          loadout={p.loadout as Loadout}
          vipLevel={p.vip}
          meta={
            <>
              {t("playerId")} #{p.public_id} · {t("memberSince")} {new Date(p.created_at).toLocaleDateString()} · {t("level")} {p.level}
              {isMe && (
                <Link href="/profile" className="ml-3 text-xs text-[var(--accent-2)] hover:underline">
                  {t("editProfile")}
                </Link>
              )}
            </>
          }
          right={
            <div className="pb-1 text-right">
              <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{t("capital")}</p>
              <Money value={Number(p.capital)} className="font-display text-3xl font-semibold" />
            </div>
          }
        >
          {(p.corporation || p.partner) && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {p.corporation && (
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1">
                  <Building2 size={13} className="text-[var(--accent-2)]" /> {p.corporation}
                </span>
              )}
              {p.partner && (
                <Link href={`/players/${encodeURIComponent(p.partner)}`} className="flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 py-1 hover:text-white">
                  <Heart size={13} className="text-[#f43f5e]" /> {p.partner}
                </Link>
              )}
            </div>
          )}
        </ProfileHero>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label={t("gamesPlayed")} value={String(p.stats.games_played)} />
          <Stat label={t("winRate")} value={`${winRate}%`} />
          <Stat label={t("achievements")} value={String(p.stats.achievements)} />
          <Stat label={t("cars")} value={String(p.stats.cars)} />
          <Stat label={t("luxury")} value={String(p.stats.luxury)} />
        </div>
      </Reveal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display mt-1 text-xl font-semibold tabular">{value}</p>
    </div>
  );
}
