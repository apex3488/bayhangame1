import {
  Award,
  Bitcoin,
  Briefcase,
  Building2,
  Car,
  CircleHelp,
  Factory,
  Gem,
  Gamepad2,
  Heart,
  History,
  Home,
  Landmark,
  LayoutGrid,
  Package,
  Pickaxe,
  Send,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trophy,
  User,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface Section {
  href: string;
  key: string;
  icon: LucideIcon;
  hue: string;
}

export const GROUPS: { key: string; items: Section[] }[] = [
  {
    key: "groupMain",
    items: [
      { href: "/", key: "home", icon: Home, hue: "#2f7bff" },
      { href: "/city", key: "city", icon: LayoutGrid, hue: "#5aa2ff" },
      { href: "/work", key: "work", icon: Briefcase, hue: "#38bdf8" },
      { href: "/games", key: "games", icon: Gamepad2, hue: "#a855f7" },
    ],
  },
  {
    key: "groupEconomy",
    items: [
      { href: "/bank", key: "bank", icon: Landmark, hue: "#10b981" },
      { href: "/mining", key: "mining", icon: Pickaxe, hue: "#f59e0b" },
      { href: "/cases", key: "cases", icon: Package, hue: "#ec4899" },
      { href: "/store", key: "store", icon: ShoppingBag, hue: "#8b5cf6" },
      { href: "/promo", key: "promo", icon: Ticket, hue: "#f43f5e" },
    ],
  },
  {
    key: "groupAssets",
    items: [
      { href: "/business", key: "business", icon: Factory, hue: "#f97316" },
      { href: "/realty", key: "realty", icon: Building2, hue: "#06b6d4" },
      { href: "/cars", key: "cars", icon: Car, hue: "#ef4444" },
      { href: "/luxury", key: "luxury", icon: Gem, hue: "#ffc94d" },
    ],
  },
  {
    key: "groupSocial",
    items: [
      { href: "/corporation", key: "corporation", icon: Users, hue: "#6366f1" },
      { href: "/marriage", key: "marriage", icon: Heart, hue: "#fb7185" },
      { href: "/referrals", key: "referrals", icon: UserPlus, hue: "#22c55e" },
      { href: "/transfer", key: "transfer", icon: Send, hue: "#0ea5e9" },
      { href: "/leaderboard", key: "leaderboard", icon: Trophy, hue: "#eab308" },
    ],
  },
  {
    key: "groupMe",
    items: [
      { href: "/profile", key: "profile", icon: User, hue: "#94a3b8" },
      { href: "/quests", key: "quests", icon: Award, hue: "#facc15" },
      { href: "/events", key: "events", icon: Sparkles, hue: "#c084fc" },
      { href: "/history", key: "history", icon: History, hue: "#64748b" },
      { href: "/help", key: "help", icon: CircleHelp, hue: "#64748b" },
    ],
  },
];

export const MOBILE_NAV = ["/", "/city", "/work", "/games", "/profile"];

export const ALL_SECTIONS = GROUPS.flatMap((g) => g.items);

export const BTC_ICON = Bitcoin;

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
