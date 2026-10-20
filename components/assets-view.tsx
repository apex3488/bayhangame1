"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Gauge, Star, Users, Zap } from "lucide-react";
import { useAsk, useGame } from "./game-context";
import { useAction } from "./use-action";
import { AssetArt, HAS_PICTURE } from "./asset-art";
import { Button, Money, PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "./ui";
import {
  assetBuy,
  assetSell,
  assetUpgrade,
  businessHire,
  collectIncome,
  fetchCatalog,
  fetchOwned,
  fetchSettings,
  type AssetKind,
  type CatalogItem,
  type OwnedAsset,
} from "@/lib/economy";

const marketValue = (price: number, level: number) => Math.round(price * (1 + 0.15 * (Math.max(level, 1) - 1)) * 100) / 100;

/** Per-hour income the server will pay (same formulas as migration 0006). */
function hourly(kind: AssetKind, item: CatalogItem, own: OwnedAsset, s: Record<string, number>) {
  if (kind === "realty") return Number(item.income_per_hour) * own.level;
  if (kind === "business") {
    const gross = Number(item.income_per_hour) * own.level * (1 + (s.employee_bonus ?? 0.05) * (own.employees ?? 0));
    return Math.max(gross - Number(item.expense_per_hour) * own.level, 0);
  }
  return 0;
}

function upgradeCost(kind: AssetKind, item: CatalogItem, level: number, s: Record<string, number>) {
  if (kind === "car") return Math.round(Number(item.price) * (s.car_upgrade_ratio ?? 0.2) * level * 100) / 100;
  return Number(item.upgrade_cost_base) * level;
}

const maxLevel = (kind: AssetKind, item: CatalogItem, s: Record<string, number>) => (kind === "car" ? s.car_max_level ?? 5 : Number(item.max_level ?? 5));

export function AssetsView({ kind, titleKey, subtitleKey, nameKey }: { kind: Exclude<AssetKind, "luxury">; titleKey: string; subtitleKey: string; nameKey: string }) {
  const { t } = useGame();
  const { busy, run } = useAction();
  const ask = useAsk();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [owned, setOwned] = useState<OwnedAsset[]>([]);
  const [settings, setSettings] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    Promise.all([fetchCatalog(kind), fetchOwned(kind), fetchSettings()])
      .then(([c, o, s]) => {
        setCatalog(c);
        setOwned(o);
        setSettings(s);
      })
      .catch(() => setCatalog([]));
  }, [kind]);
  useEffect(load, [load]);
  // Ticks the live income counters.
  useEffect(() => {
    if (kind === "car") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [kind]);

  const capHours = settings.offline_income_hours ?? 24;
  const pendingOf = (item: CatalogItem, own: OwnedAsset) => {
    if (!own.last_collected_at) return 0;
    const hours = Math.min(Math.max((now - new Date(own.last_collected_at).getTime()) / 3_600_000, 0), capHours);
    return hourly(kind, item, own, settings) * hours;
  };
  const totalPending = catalog
    ? owned.reduce((sum, o) => {
        const item = catalog.find((c) => c.code === o.code);
        return item ? sum + pendingOf(item, o) : sum;
      }, 0)
    : 0;

  const act = async <T,>(id: string, fn: (key: string) => Promise<T>, msg: (r: T) => string) => {
    await run(id, fn, msg);
    load();
  };

  const ownedItems = catalog ? owned.map((o) => ({ own: o, item: catalog.find((c) => c.code === o.code)! })).filter((x) => x.item) : [];
  const forSale = catalog?.filter((c) => !owned.some((o) => o.code === c.code)) ?? [];

  return (
    <div>
      <PageTitle
        title={t(titleKey)}
        subtitle={t(subtitleKey)}
        right={
          kind !== "car" && owned.length > 0 ? (
            <Button
              variant="success"
              onClick={() => act("collect-all", () => collectIncome(kind), (r) => `${t("collected")}: +${formatUsd(Number(r.total))}`)}
              loading={busy === "collect-all"}
              disabled={busy !== null || totalPending < 0.01}
            >
              {t("collectAll")} · <Money value={totalPending} />
            </Button>
          ) : undefined
        }
      />

      {kind !== "car" && owned.length > 0 && <p className="-mt-3 mb-5 text-xs text-[var(--muted)]">{t("offlineCap")}</p>}

      {!catalog ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <>
          {ownedItems.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                {t("myAssets")} · {ownedItems.length}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence>
                  {ownedItems.map(({ own, item }) => {
                    const max = maxLevel(kind, item, settings);
                    const cost = upgradeCost(kind, item, own.level, settings);
                    const pending = pendingOf(item, own);
                    const value = marketValue(Number(item.price), own.level);
                    return (
                      <motion.div key={item.code} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                        className="panel panel-glow overflow-hidden">
                        <div className={`group relative ${HAS_PICTURE(kind) ? "aspect-[16/10]" : "h-36"} bg-gradient-to-b from-[var(--accent-soft)] to-transparent`}>
                          <AssetArt kind={kind} code={item.code} owned />
                          <div className="absolute left-4 top-3 flex gap-0.5">
                            {Array.from({ length: max }, (_, i) => (
                              <Star key={i} size={13} className={i < own.level ? "fill-[var(--gold)] text-[var(--gold)]" : "text-[var(--dim)]"} />
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3 p-5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-display text-lg font-semibold">{t(`${nameKey}_${item.code}`)}</h3>
                            <span className="text-xs text-[var(--muted)]">
                              {t("marketValue")} <span className="tabular font-semibold text-white">{formatUsd(value, 0)}</span>
                            </span>
                          </div>
                          {kind === "car" ? (
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <Spec icon={Zap} label={t("power")} value={`${item.power} hp`} />
                              <Spec icon={Gauge} label={t("maxSpeed")} value={`${item.max_speed} km/h`} />
                            </div>
                          ) : (
                            <div className="rounded-2xl bg-[var(--bg-2)] p-3">
                              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                                <span>{t("pending")}</span>
                                <span>
                                  {t("netPerHour")}: <span className="tabular text-[var(--success)]">{formatUsd(hourly(kind, item, own, settings), 0)}</span>
                                </span>
                              </div>
                              <p className="font-display mt-1 text-2xl font-semibold tabular text-[var(--success)]">{formatUsd(pending)}</p>
                            </div>
                          )}
                          {kind === "business" && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1.5 text-[var(--muted)]">
                                <Users size={14} /> {t("employees")}: <span className="font-semibold text-white">{own.employees ?? 0}/{settings.max_employees ?? 10}</span>
                              </span>
                              <Button
                                variant="ghost"
                                className="px-3 py-1.5 text-xs"
                                disabled={busy !== null || (own.employees ?? 0) >= (settings.max_employees ?? 10)}
                                loading={busy === `hire-${item.code}`}
                                onClick={() => act(`hire-${item.code}`, (k) => businessHire(item.code, k), (r) => `${t("hired")} (−${formatUsd(Number(r.cost))})`)}
                              >
                                {t("hire")} · {formatUsd((settings.employee_cost ?? 2000) * ((own.employees ?? 0) + 1), 0)}
                              </Button>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            {kind !== "car" && (
                              <Button
                                variant="success"
                                className="py-2.5"
                                disabled={busy !== null || pending < 0.01}
                                loading={busy === `collect-${item.code}`}
                                onClick={() => act(`collect-${item.code}`, () => collectIncome(kind), (r) => `${t("collected")}: +${formatUsd(Number(r.total))}`)}
                              >
                                {t("collect")}
                              </Button>
                            )}
                            <Button
                              className={`py-2.5 ${kind === "car" ? "col-span-2" : ""}`}
                              disabled={busy !== null || own.level >= max}
                              loading={busy === `up-${item.code}`}
                              onClick={() => act(`up-${item.code}`, (k) => assetUpgrade(kind, item.code, k), (r) => `${t("upgraded")} ${r.level}`)}
                            >
                              {own.level >= max ? t("maxLevelReached") : `${t("upgrade")} · ${formatCompact(cost)}`}
                            </Button>
                          </div>
                          <button
                            disabled={busy !== null}
                            onClick={async () => {
                              if (await ask(t("confirmSell"), { danger: true, message: `${t("sellFor")} ${formatUsd(value * (settings.asset_sell_ratio ?? 0.7), 0)}` })) {
                                act(`sell-${item.code}`, (k) => assetSell(kind, item.code, k), (r) => `${t("soldFor")} ${formatUsd(Number(r.proceeds))}`);
                              }
                            }}
                            className="w-full text-center text-xs text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
                          >
                            {t("sellFor")} {formatUsd(value * (settings.asset_sell_ratio ?? 0.7), 0)}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </section>
          )}

          {forSale.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">{t("catalog")}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {forSale.map((item, i) => (
                  <Reveal key={item.code} delay={i * 0.04}>
                    <motion.div whileHover={{ y: -4 }} className="panel group overflow-hidden">
                      <div className={`relative ${HAS_PICTURE(kind) ? "aspect-[16/10]" : "h-32"} bg-gradient-to-b from-[var(--surface-3)] to-transparent transition-colors group-hover:from-[var(--accent-soft)]`}>
                        <AssetArt kind={kind} code={item.code} />
                      </div>
                      <div className="space-y-3 p-5">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display text-lg font-semibold">{t(`${nameKey}_${item.code}`)}</h3>
                          <span className="font-display text-lg font-semibold tabular text-[var(--accent-2)]">{formatUsd(Number(item.price), 0)}</span>
                        </div>
                        {kind === "car" ? (
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <Spec icon={Zap} label={t("power")} value={`${item.power} hp`} />
                            <Spec icon={Gauge} label={t("maxSpeed")} value={`${item.max_speed} km/h`} />
                          </div>
                        ) : (
                          <div className="space-y-1 text-xs">
                            <Line label={t("incomePerHour")} value={formatUsd(Number(item.income_per_hour), 0)} tone="up" />
                            {kind === "business" && <Line label={t("expensePerHour")} value={formatUsd(Number(item.expense_per_hour), 0)} tone="down" />}
                          </div>
                        )}
                        <Button
                          className="w-full"
                          disabled={busy !== null}
                          loading={busy === `buy-${item.code}`}
                          onClick={() => act(`buy-${item.code}`, (k) => assetBuy(kind, item.code, k), () => `${t("bought")}: ${t(`${nameKey}_${item.code}`)}`)}
                        >
                          {t("buy")}
                        </Button>
                      </div>
                    </motion.div>
                  </Reveal>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Spec({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-2)] p-2.5">
      <p className="flex items-center gap-1 text-[var(--muted)]">
        <Icon size={12} /> {label}
      </p>
      <p className="mt-0.5 font-semibold tabular">{value}</p>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone: "up" | "down" }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tabular font-semibold ${tone === "up" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{value}</span>
    </div>
  );
}
