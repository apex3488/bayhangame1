"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Check, Gift, Lock } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { CosmeticPreview, RARITY_COLOR, cosmeticName } from "@/components/cosmetic-view";
import { CosmeticArt } from "@/components/cosmetic-art";
import { mediaUrl } from "@/lib/profile";
import { Tabs } from "@/components/forms";
import { Burst, Button, PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "@/components/ui";
import {
  cosmeticBuy,
  cosmeticEquip,
  cosmeticUnequip,
  fetchBoxRewards,
  fetchCollections,
  fetchCosmetics,
  fetchMyCosmetics,
  openBox,
  type CosmeticItem,
  type Slot,
} from "@/lib/economy";

type Tab = "featured" | "elite" | CosmeticItem["category"] | "collections";
const TABS: Tab[] = ["elite", "featured", "frame", "badge", "theme", "name_style", "title", "effect", "box", "collections"];

export default function StorePage() {
  const { t, loadout, refreshLoadout, snapshot } = useGame();
  const avatarSrc = snapshot ? mediaUrl(snapshot.user_id, "avatar", snapshot.avatar_version) : null;
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("elite");
  const [items, setItems] = useState<CosmeticItem[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [boxRewards, setBoxRewards] = useState<{ box_code: string; reward_code: string; weight: number }[]>([]);
  const [collections, setCollections] = useState<{ code: string; reward_code: string; items: string[]; completed: boolean }[]>([]);
  const [opened, setOpened] = useState<{ id: number; item: CosmeticItem } | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchCosmetics(), fetchMyCosmetics(), fetchBoxRewards(), fetchCollections()])
      .then(([i, m, b, c]) => {
        setItems(i);
        setOwned(new Set(m.map((x) => x.code)));
        setBoxRewards(b);
        setCollections(c);
      })
      .catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const byCode = (code: string) => items?.find((i) => i.code === code);
  // Elite: billion-dollar items, most expensive first.
  const list = !items
    ? []
    : tab === "elite"
      ? items.filter((i) => Number(i.price) >= 1_000_000_000).sort((a, b) => Number(b.price) - Number(a.price))
      : tab === "featured"
        ? items.filter((i) => i.featured)
        : items.filter((i) => i.category === tab);

  async function buy(item: CosmeticItem) {
    if (item.category === "box") {
      const r = await run(`buy-${item.code}`, (k) => openBox(item.code, k));
      if (r?.reward) setOpened({ id: Date.now(), item: r.reward });
    } else {
      await run(`buy-${item.code}`, (k) => cosmeticBuy(item.code, k), () => `${t("bought")}: ${cosmeticName(item.code)}`);
    }
    load();
  }

  async function equip(item: CosmeticItem) {
    const slot = item.category as Slot;
    const isOn = loadout[slot]?.code === item.code;
    await run(`eq-${item.code}`, () => (isOn ? cosmeticUnequip(slot) : cosmeticEquip(item.code)));
    refreshLoadout();
  }

  return (
    <div>
      <PageTitle title={t("store")} subtitle={t("storeSubtitle")} />
      <div className="-mx-4 overflow-x-auto px-4">
        <Tabs id="store" value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: id === "featured" ? t("featured") : id === "elite" ? `💎 ${t("cat_elite")}` : id === "collections" ? t("collections") : t(`cat_${id}`) }))} />
      </div>

      {!items ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : tab === "collections" ? (
        <div className="grid gap-4 md:grid-cols-3">
          {collections.map((c, i) => {
            const reward = byCode(c.reward_code);
            const have = c.items.filter((x) => owned.has(x)).length;
            return (
              <Reveal key={c.code} delay={i * 0.05}>
                <div className={`panel p-5 ${c.completed ? "panel-glow" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-display text-lg font-semibold">{cosmeticName(c.code.replace(/^col_/, "box_"))}</p>
                    <span className="text-xs text-[var(--muted)] tabular">
                      {have}/{c.items.length}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {c.items.map((code) => {
                      const it = byCode(code);
                      return (
                        <div key={code} className={`grid aspect-square place-items-center rounded-2xl bg-[var(--bg-2)] ${owned.has(code) ? "" : "opacity-35 grayscale"}`}>
                          {it ? <CosmeticPreview item={it} size={36} /> : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-[var(--bg-2)] p-3">
                    <span className="text-xs text-[var(--muted)]">{t("collectionReward")}</span>
                    <span className="text-sm font-semibold" style={{ color: RARITY_COLOR[reward?.rarity ?? "common"] }}>
                      {reward?.icon} {cosmeticName(c.reward_code)}
                    </span>
                  </div>
                  {c.completed && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[var(--success)]">
                      <Check size={14} /> {t("completed")}
                    </p>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {list.map((item, i) => {
            const color = RARITY_COLOR[item.rarity];
            const has = owned.has(item.code);
            const equipped = item.category !== "box" && loadout[item.category as Slot]?.code === item.code;
            const soldOut = item.limited_qty !== null && item.sold_count >= item.limited_qty;
            return (
              <Reveal key={item.code} delay={Math.min(i, 12) * 0.03}>
                <motion.div
                  whileHover={{ y: -4 }}
                  className="relative flex h-full flex-col overflow-hidden rounded-3xl border p-4"
                  style={{ borderColor: equipped ? color : "var(--border)", background: `linear-gradient(170deg, ${color}1f, var(--surface) 55%)` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: `${color}26`, color }}>
                      {t(`rarity_${item.rarity}`)}
                    </span>
                    {item.limited_qty !== null && (
                      <span className="text-[10px] text-[var(--muted)] tabular">
                        {t("limited")} {item.sold_count}/{item.limited_qty}
                      </span>
                    )}
                  </div>
                  <div className="my-3 grid h-32 place-items-center">
                    <CosmeticArt item={item} size={84} avatarSrc={avatarSrc} playerName={snapshot?.game_name} />
                  </div>
                  <p className="font-display text-sm font-semibold">{cosmeticName(item.code)}</p>
                  <p className="mb-3 text-xs text-[var(--muted)]">{t(`cat_${item.category}`)}</p>
                  {item.category === "box" && (
                    <p className="mb-3 text-[11px] leading-relaxed text-[var(--muted)]">
                      {t("boxDrops")}:{" "}
                      {boxRewards
                        .filter((b) => b.box_code === item.code)
                        .map((b) => `${cosmeticName(b.reward_code)}${owned.has(b.reward_code) ? " ✓" : ""}`)
                        .join(", ")}
                    </p>
                  )}
                  <div className="mt-auto">
                    {item.category !== "box" && has ? (
                      <Button variant={equipped ? "success" : "outline"} className="w-full py-2.5 text-xs" disabled={busy !== null} loading={busy === `eq-${item.code}`} onClick={() => equip(item)}>
                        {equipped ? (
                          <>
                            <Check size={14} /> {t("equipped")}
                          </>
                        ) : (
                          t("equip")
                        )}
                      </Button>
                    ) : !item.purchasable ? (
                      <div className="flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--bg-2)] py-2.5 text-xs text-[var(--muted)]">
                        <Lock size={13} /> {t("notForSale")}
                      </div>
                    ) : soldOut ? (
                      <div className="rounded-2xl bg-[var(--bg-2)] py-2.5 text-center text-xs text-[var(--muted)]">{t("soldOut")}</div>
                    ) : (
                      <Button className="w-full py-2.5 text-xs" disabled={busy !== null} loading={busy === `buy-${item.code}`} onClick={() => buy(item)}>
                        {item.category === "box" ? t("openBox") : t("buy")} · {Number(item.price) >= 1_000_000 ? `${formatCompact(Number(item.price))}` : formatUsd(Number(item.price), 0)}
                      </Button>
                    )}
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {opened && (
          <motion.div
            className="fixed inset-0 z-40 grid place-items-center bg-black/75 p-6 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpened(null)}
          >
            <div className="relative text-center" onClick={(e) => e.stopPropagation()}>
              <motion.div initial={{ scale: 0.6, rotate: 0 }} animate={{ scale: [0.6, 1, 1, 0], rotate: [0, -8, 8, -8, 0] }} transition={{ duration: 1.1, times: [0, 0.3, 0.8, 1] }}
                className="absolute inset-0 grid place-items-center text-[var(--gold)]">
                <Gift size={120} strokeWidth={1.2} />
              </motion.div>
              <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.05, type: "spring", stiffness: 220, damping: 14 }}
                className="panel relative w-72 p-8" style={{ boxShadow: `0 0 80px ${RARITY_COLOR[opened.item.rarity]}66` }}>
                <Burst trigger={opened.id} count={40} color={RARITY_COLOR[opened.item.rarity]} />
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase" style={{ background: `${RARITY_COLOR[opened.item.rarity]}26`, color: RARITY_COLOR[opened.item.rarity] }}>
                  {t(`rarity_${opened.item.rarity}`)}
                </span>
                <div className="my-6 grid h-36 place-items-center">
                  <CosmeticArt item={opened.item} size={96} avatarSrc={avatarSrc} playerName={snapshot?.game_name} />
                </div>
                <p className="font-display text-xl font-semibold">{cosmeticName(opened.item.code)}</p>
                <p className="text-sm text-[var(--muted)]">{t(`cat_${opened.item.category}`)}</p>
                <Button className="mt-6 w-full" onClick={() => setOpened(null)}>
                  {t("collect")}
                </Button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
