"use client";

import { motion } from "motion/react";

/** Length of one animated shift. The payout is revealed when both this and the server call finish. */
export const SHIFT_MS = 5600;
const D = SHIFT_MS / 1000;

const ease = [0.45, 0, 0.2, 1] as const;

function Frame({ children, tint }: { children: React.ReactNode; tint: string }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-3xl border border-[var(--border)] bg-[#070a12]">
      <div className="grid-bg absolute inset-0 opacity-70" />
      <div className="absolute inset-0" style={{ background: `radial-gradient(70% 60% at 50% 40%, ${tint}, transparent 70%)` }} />
      <svg viewBox="0 0 400 250" className="absolute inset-0 h-full w-full">
        {children}
      </svg>
    </div>
  );
}

function Courier() {
  const route = "M30,200 C90,200 90,120 150,120 S210,60 260,70 S330,170 370,60";
  return (
    <Frame tint="rgba(47,123,255,.22)">
      {[
        [40, 30, 60, 50], [120, 150, 50, 70], [210, 120, 70, 50], [300, 180, 60, 50], [320, 20, 50, 30], [20, 100, 40, 60],
      ].map(([x, y, w, h], i) => (
        <motion.rect key={i} x={x} y={y} width={w} height={h} rx="6" fill="#111a2e" stroke="#1f2b47"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 }} />
      ))}
      <path d={route} fill="none" stroke="#1d2840" strokeWidth="14" strokeLinecap="round" />
      <motion.path d={route} fill="none" stroke="#2f7bff" strokeWidth="3" strokeDasharray="1 0" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: D * 0.85, ease }} />
      {[[150, 120], [260, 70]].map(([x, y], i) => (
        <motion.circle key={i} cx={x} cy={y} r="6" fill="#5aa2ff" initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 1] }}
          transition={{ delay: D * (0.3 + i * 0.25) }} />
      ))}
      <motion.g initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ delay: D * 0.85 }} style={{ transformOrigin: "370px 60px" }}>
        <circle cx="370" cy="60" r="14" fill="#2fe0a0" opacity=".2" />
        <circle cx="370" cy="60" r="7" fill="#2fe0a0" />
      </motion.g>
      <motion.g style={{ offsetPath: `path("${route}")`, offsetRotate: "auto" }}
        initial={{ offsetDistance: "0%" }} animate={{ offsetDistance: "100%" }} transition={{ duration: D * 0.85, ease }}>
        <rect x="-11" y="-7" width="22" height="14" rx="4" fill="#fff" />
        <rect x="-4" y="-5" width="8" height="10" rx="2" fill="#2f7bff" />
      </motion.g>
    </Frame>
  );
}

function Taxi() {
  return (
    <Frame tint="rgba(255,201,77,.18)">
      <rect x="0" y="150" width="400" height="70" fill="#0d1220" />
      {Array.from({ length: 10 }, (_, i) => (
        <motion.rect key={i} y="183" width="30" height="4" rx="2" fill="#ffc94d" opacity=".7"
          initial={{ x: i * 50 }} animate={{ x: i * 50 - 400 }} transition={{ duration: 1.4, ease: "linear", repeat: Infinity }} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <motion.rect key={`b${i}`} y={60 + (i % 3) * 15} width="44" height={90 - (i % 3) * 15} rx="4" fill="#111a2e"
          initial={{ x: i * 70 }} animate={{ x: i * 70 - 490 }} transition={{ duration: 6, ease: "linear", repeat: Infinity }} />
      ))}
      <motion.g animate={{ y: [0, -2, 0] }} transition={{ duration: 0.35, repeat: Infinity }}>
        <rect x="150" y="150" width="100" height="26" rx="8" fill="#ffc94d" />
        <path d="M168,150 L182,132 L222,132 L236,150 Z" fill="#ffc94d" />
        <rect x="186" y="136" width="16" height="12" rx="2" fill="#0b1020" />
        <rect x="205" y="136" width="16" height="12" rx="2" fill="#0b1020" />
        <circle cx="172" cy="178" r="10" fill="#0b1020" stroke="#333" strokeWidth="3" />
        <circle cx="228" cy="178" r="10" fill="#0b1020" stroke="#333" strokeWidth="3" />
        <rect x="192" y="124" width="20" height="8" rx="2" fill="#fff" />
      </motion.g>
    </Frame>
  );
}

function Mechanic() {
  return (
    <Frame tint="rgba(255,120,60,.16)">
      <rect x="60" y="200" width="280" height="8" rx="4" fill="#1d2840" />
      <motion.g initial={{ y: 0 }} animate={{ y: -40 }} transition={{ delay: 0.3, duration: 1.2, ease }}>
        <rect x="120" y="175" width="160" height="10" rx="3" fill="#2f7bff" />
        <path d="M120,170 L140,140 L250,140 L280,170 Z" fill="#cfd6e6" />
        <rect x="150" y="146" width="40" height="18" rx="3" fill="#0b1020" />
        <rect x="200" y="146" width="40" height="18" rx="3" fill="#0b1020" />
        <circle cx="150" cy="175" r="13" fill="#0b1020" stroke="#444" strokeWidth="4" />
        <circle cx="250" cy="175" r="13" fill="#0b1020" stroke="#444" strokeWidth="4" />
      </motion.g>
      {[[70, 70, 22, 1], [110, 50, 14, -1]].map(([x, y, r, dir], i) => (
        <motion.g key={i} style={{ transformOrigin: `${x}px ${y}px` }} animate={{ rotate: 360 * dir }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
          <circle cx={x} cy={y} r={r} fill="none" stroke="#ff8a3d" strokeWidth="6" strokeDasharray="6 5" />
          <circle cx={x} cy={y} r={r / 3} fill="#ff8a3d" />
        </motion.g>
      ))}
      <motion.g style={{ transformOrigin: "320px 60px" }} animate={{ rotate: [0, -35, 0] }} transition={{ duration: 0.8, repeat: Infinity }}>
        <rect x="316" y="60" width="8" height="70" rx="3" fill="#cfd6e6" />
        <circle cx="320" cy="58" r="12" fill="none" stroke="#cfd6e6" strokeWidth="6" />
      </motion.g>
      {[0, 1, 2, 3].map((i) => (
        <motion.circle key={i} cx={200} cy={115} r="2.5" fill="#ffc94d"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0], x: [0, (i - 1.5) * 30], y: [0, -25 - i * 6] }}
          transition={{ delay: 1.6 + i * 0.25, duration: 0.7, repeat: 3, repeatDelay: 0.5 }} />
      ))}
    </Frame>
  );
}

function Programmer() {
  const lines = [70, 140, 110, 180, 90, 150, 60, 130, 170];
  return (
    <Frame tint="rgba(47,123,255,.2)">
      <rect x="40" y="25" width="320" height="200" rx="12" fill="#0b1020" stroke="#1f2b47" />
      <rect x="40" y="25" width="320" height="24" rx="12" fill="#121a2e" />
      {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => <circle key={c} cx={58 + i * 14} cy={37} r="4" fill={c} />)}
      {lines.map((w, i) => (
        <motion.rect key={i} x={60 + (i % 3) * 14} y={62 + i * 15} height="6" rx="3"
          fill={["#5aa2ff", "#c792ea", "#2fe0a0", "#ffc94d"][i % 4]}
          initial={{ width: 0 }} animate={{ width: w }} transition={{ delay: 0.25 + i * 0.32, duration: 0.3 }} />
      ))}
      <motion.rect x="60" y="200" width="0" height="8" rx="4" fill="#2fe0a0" animate={{ width: 280 }}
        transition={{ delay: 3.4, duration: 1.5, ease }} />
      <motion.text x="300" y="196" fill="#2fe0a0" fontSize="11" fontWeight="700" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 4.9 }}>BUILD ✓</motion.text>
      <motion.rect x="60" y="62" width="2" height="10" fill="#fff" animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} />
    </Frame>
  );
}

function Engineer() {
  const outline = "M80,210 L80,110 L200,50 L320,110 L320,210 Z M130,210 L130,150 L170,150 L170,210 M230,130 L280,130 L280,170 L230,170 Z";
  return (
    <Frame tint="rgba(47,160,255,.22)">
      <rect x="30" y="20" width="340" height="210" rx="10" fill="#0a2a5a" opacity=".55" />
      <motion.path d={outline} fill="none" stroke="#9fd0ff" strokeWidth="2.2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: D * 0.75, ease }} />
      <motion.path d="M60,225 L340,225" stroke="#9fd0ff" strokeWidth="1" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ delay: 0.5, duration: 1.2 }} />
      <motion.text x="185" y="240" fill="#9fd0ff" fontSize="10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
        24.0 m
      </motion.text>
      <motion.g initial={{ x: 0, y: 0 }} animate={{ x: [0, 120, 240, 120, 60], y: [0, -60, 0, 60, 20] }} transition={{ duration: D * 0.75, ease }}>
        <circle cx="80" cy="150" r="5" fill="#fff" />
        <circle cx="80" cy="150" r="12" fill="none" stroke="#fff" strokeOpacity=".4" />
      </motion.g>
      <motion.text x="300" y="45" fill="#2fe0a0" fontSize="12" fontWeight="700" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: D * 0.8 }}>APPROVED</motion.text>
    </Frame>
  );
}

function Financier() {
  const candles = [[120, 150], [110, 140], [130, 160], [100, 125], [90, 118], [95, 110], [70, 100], [60, 88], [50, 75], [40, 62]];
  return (
    <Frame tint="rgba(47,224,160,.16)">
      {[60, 100, 140, 180].map((y) => <line key={y} x1="30" x2="370" y1={y} y2={y} stroke="#1a2236" />)}
      {candles.map(([top, bottom], i) => {
        const up = i === 0 || top < candles[i - 1][0];
        return (
          <motion.g key={i} initial={{ opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }}
            style={{ transformOrigin: `${50 + i * 32}px ${bottom}px` }} transition={{ delay: 0.2 + i * 0.38, duration: 0.35 }}>
            <line x1={50 + i * 32} x2={50 + i * 32} y1={top - 10} y2={bottom + 10} stroke={up ? "#2fe0a0" : "#ff4d61"} />
            <rect x={42 + i * 32} y={top} width="16" height={bottom - top} rx="2" fill={up ? "#2fe0a0" : "#ff4d61"} />
          </motion.g>
        );
      })}
      <motion.path d="M50,140 L82,130 L114,148 L146,118 L178,108 L210,104 L242,92 L274,80 L306,68 L338,54" fill="none" stroke="#5aa2ff"
        strokeWidth="2.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: D * 0.8, ease }} />
      <motion.text x="300" y="35" fill="#2fe0a0" fontSize="14" fontWeight="800" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: D * 0.8 }}>+12.4%</motion.text>
    </Frame>
  );
}

function Entrepreneur() {
  const towers = [[60, 90], [110, 140], [160, 70], [210, 170], [260, 110], [310, 130]];
  return (
    <Frame tint="rgba(122,60,255,.2)">
      <rect x="20" y="215" width="360" height="4" rx="2" fill="#1d2840" />
      {towers.map(([x, h], i) => (
        <motion.g key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ transformOrigin: `${x}px 215px` }}
          transition={{ delay: 0.3 + i * 0.5, duration: 0.9, ease }}>
          <rect x={x - 20} y={215 - h} width="40" height={h} rx="4" fill="#151d33" stroke="#2a3557" />
          {Array.from({ length: Math.floor(h / 22) }, (_, j) => (
            <rect key={j} x={x - 12} y={225 - h + j * 22} width="24" height="8" rx="2" fill={j % 2 ? "#5aa2ff" : "#2a3557"} opacity=".8" />
          ))}
        </motion.g>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.g key={`c${i}`} initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -50 }}
          transition={{ delay: 1.2 + i * 0.7, duration: 1.2 }}>
          <circle cx={70 + i * 60} cy={120} r="9" fill="#ffc94d" />
          <text x={66 + i * 60} y={124} fontSize="11" fontWeight="800" fill="#5a3a00">$</text>
        </motion.g>
      ))}
    </Frame>
  );
}

function Director() {
  return (
    <Frame tint="rgba(255,201,77,.14)">
      <rect x="110" y="40" width="180" height="90" rx="8" fill="#0b1020" stroke="#2a3557" />
      {[0, 1, 2, 3].map((i) => (
        <motion.rect key={i} x={130 + i * 38} width="22" rx="3" fill="#2f7bff" initial={{ y: 120, height: 0 }}
          animate={{ y: 120 - (20 + i * 18), height: 20 + i * 18 }} transition={{ delay: 0.5 + i * 0.35, duration: 0.6, ease }} />
      ))}
      <ellipse cx="200" cy="190" rx="150" ry="30" fill="#1a1f30" stroke="#2a3557" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = Math.PI + (i / 7) * Math.PI;
        const x = 200 + Math.cos(a) * 170;
        const y = 195 - Math.sin(a) * -40;
        return (
          <motion.circle key={i} cx={x} cy={y} r="11" fill="#1f2740" stroke="#2a3557"
            animate={{ fill: ["#1f2740", "#2f7bff", "#1f2740"] }} transition={{ delay: 1.5 + i * 0.3, duration: 0.8 }} />
        );
      })}
      <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: D * 0.8, type: "spring" }}
        style={{ transformOrigin: "200px 190px" }}>
        <rect x="160" y="178" width="80" height="24" rx="12" fill="#2fe0a0" />
        <text x="176" y="194" fontSize="11" fontWeight="800" fill="#04130d">SIGNED</text>
      </motion.g>
    </Frame>
  );
}

const SCENES: Record<string, () => React.JSX.Element> = {
  courier: Courier,
  taxi: Taxi,
  mechanic: Mechanic,
  programmer: Programmer,
  engineer: Engineer,
  financier: Financier,
  entrepreneur: Entrepreneur,
  director: Director,
};

export function WorkScene({ job }: { job: string }) {
  const Scene = SCENES[job] ?? Courier;
  return <Scene />;
}

/** Three shift stages per job, shown under the scene. */
export const STAGES: Record<string, Record<"ru" | "en" | "uz", [string, string, string]>> = {
  courier: {
    ru: ["Забираем заказ", "Едем по маршруту", "Вручаем посылку"],
    en: ["Picking up the order", "Riding the route", "Handing over the parcel"],
    uz: ["Buyurtmani olamiz", "Yo'nalish bo'ylab", "Posilkani topshiramiz"],
  },
  taxi: {
    ru: ["Принимаем вызов", "Везём пассажира", "Оплата поездки"],
    en: ["Accepting the ride", "Driving the passenger", "Collecting the fare"],
    uz: ["Chaqiruvni qabul qilamiz", "Yo'lovchini olib boramiz", "To'lov"],
  },
  mechanic: {
    ru: ["Поднимаем авто", "Диагностика и ремонт", "Финальная проверка"],
    en: ["Lifting the car", "Diagnostics and repair", "Final check"],
    uz: ["Avtoni ko'taramiz", "Diagnostika va ta'mir", "Yakuniy tekshiruv"],
  },
  programmer: {
    ru: ["Пишем код", "Ревью и тесты", "Сборка релиза"],
    en: ["Writing code", "Review and tests", "Building the release"],
    uz: ["Kod yozamiz", "Ko'rib chiqish va testlar", "Reliz yig'ish"],
  },
  engineer: {
    ru: ["Расчёты", "Чертим проект", "Согласование"],
    en: ["Calculations", "Drafting the project", "Approval"],
    uz: ["Hisob-kitob", "Loyiha chizamiz", "Kelishuv"],
  },
  financier: {
    ru: ["Анализ рынка", "Открываем позиции", "Фиксируем прибыль"],
    en: ["Market analysis", "Opening positions", "Taking profit"],
    uz: ["Bozor tahlili", "Pozitsiyalar ochamiz", "Foydani qayd etamiz"],
  },
  entrepreneur: {
    ru: ["Запуск проекта", "Масштабирование", "Выручка"],
    en: ["Launching the project", "Scaling up", "Revenue"],
    uz: ["Loyihani boshlash", "Kengaytirish", "Tushum"],
  },
  director: {
    ru: ["Совет директоров", "Стратегия", "Подписание сделки"],
    en: ["Board meeting", "Strategy", "Signing the deal"],
    uz: ["Direktorlar kengashi", "Strategiya", "Bitimni imzolash"],
  },
};
