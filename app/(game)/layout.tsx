import { AppShell } from "@/components/app-shell";

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
