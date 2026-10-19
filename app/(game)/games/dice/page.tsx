"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

const SIZE = 150;
// Rotation that brings each face to the front.
const FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
};
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};
const FACE_TRANSFORM: Record<number, string> = {
  1: `rotateY(0deg) translateZ(${SIZE / 2}px)`,
  6: `rotateY(180deg) translateZ(${SIZE / 2}px)`,
  3: `rotateY(90deg) translateZ(${SIZE / 2}px)`,
  4: `rotateY(-90deg) translateZ(${SIZE / 2}px)`,
  2: `rotateX(90deg) translateZ(${SIZE / 2}px)`,
  5: `rotateX(-90deg) translateZ(${SIZE / 2}px)`,
};

export default function DicePage() {
  const { t } = useGame();
  const round = useRound<{ value: number; pick: number }>("dice");
  const [pick, setPick] = useState(6);
  const [rot, setRot] = useState({ x: -20, y: 25 });
  const [value, setValue] = useState<number | null>(null);

  async function roll() {
    setValue(null);
    const res = await round.play({ pick });
    if (!res) return;
    const face = FACE_ROT[res.result.value];
    // Always add full turns so the die visibly tumbles.
    setRot((r) => ({
      x: Math.ceil(r.x / 360) * 360 + 720 + face.x,
      y: Math.ceil(r.y / 360) * 360 + 1080 + face.y,
    }));
    setTimeout(() => {
      setValue(res.result.value);
      round.reveal(res);
    }, 1900);
  }

  const stage = (
    <div className="flex flex-col items-center py-10">
      <div style={{ perspective: 900 }} className="relative">
        <motion.div
          className="relative"
          style={{ width: SIZE, height: SIZE, transformStyle: "preserve-3d" }}
          animate={{ rotateX: rot.x, rotateY: rot.y, y: round.busy ? [0, -60, 0] : 0 }}
          transition={{ rotateX: { duration: 1.8, ease: [0.2, 0.8, 0.25, 1] }, rotateY: { duration: 1.8, ease: [0.2, 0.8, 0.25, 1] }, y: { duration: 0.9 } }}
        >
          {[1, 2, 3, 4, 5, 6].map((f) => (
            <div
              key={f}
              className="absolute inset-0 rounded-[26px] border border-white/40 bg-gradient-to-br from-white to-[#d9def0] shadow-[inset_0_-10px_30px_rgba(0,0,0,.12)]"
              style={{ transform: FACE_TRANSFORM[f], backfaceVisibility: "hidden" }}
            >
              {PIPS[f].map(([x, y], i) => (
                <span
                  key={i}
                  className={`absolute h-[18%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full ${f === 1 ? "bg-[#e11d48]" : "bg-[#0b1020]"} shadow-[inset_0_3px_4px_rgba(0,0,0,.5)]`}
                  style={{ left: `${x}%`, top: `${y}%` }}
                />
              ))}
            </div>
          ))}
        </motion.div>
        <motion.div
          className="mx-auto mt-10 h-5 rounded-full bg-black/60 blur-md"
          animate={{ width: round.busy ? [140, 70, 140] : 140, opacity: round.busy ? [0.7, 0.3, 0.7] : 0.7 }}
          transition={{ duration: 0.9 }}
        />
      </div>
      <div className="mt-6 h-8 text-center">
        {value !== null && (
          <motion.p initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-2xl font-bold">
            {value}
          </motion.p>
        )}
      </div>
    </div>
  );

  const controls = (
    <div>
      <p className="mb-2 text-xs text-[var(--muted)]">{t("pickNumber")}</p>
      <div className="grid grid-cols-6 gap-2">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <motion.button
            key={n}
            whileTap={{ scale: 0.9 }}
            disabled={round.busy}
            onClick={() => setPick(n)}
            className={`font-display rounded-xl py-3 text-lg font-bold transition-colors ${
              pick === n ? "bg-[#a855f7] text-white shadow-[0_8px_24px_-8px_#a855f7]" : "bg-[var(--surface-3)] text-[var(--muted)] hover:text-white"
            }`}
          >
            {n}
          </motion.button>
        ))}
      </div>
    </div>
  );

  return <GameRoom game="dice" round={round} accent="#a855f7" stage={stage} controls={controls} action={<PlayButton onClick={roll} busy={round.busy} label={t("roll")} />} />;
}
