import { useLocation, Link } from "wouter";
import { LayoutDashboard, Layers, BookMarked, Settings2, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/hooks/useTelegram";
import { useGetBotStatus } from "@workspace/api-client-react";

const TABS = [
  { href: "/",            label: "Deals",   icon: LayoutDashboard },
  { href: "/stats",       label: "Stats",   icon: BarChart2       },
  { href: "/collections", label: "Collecs", icon: Layers          },
  { href: "/watchlist",   label: "Watch",   icon: BookMarked      },
  { href: "/settings",    label: "Config",  icon: Settings2       },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 8000 } });
  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <div className="tg-app flex flex-col h-screen overflow-hidden">

      {/* ── Header compact ── */}
      <header className="tg-header flex items-center justify-between px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8">
            <div className="w-8 h-8 rounded-xl bg-button flex items-center justify-center text-button-text text-base font-bold select-none">
              💎
            </div>
            {botStatus?.isRunning && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-bg animate-pulse" />
            )}
          </div>
          <div>
            <p className="text-sm font-bold leading-none">GetGems Sniper</p>
            <p className="text-[10px] leading-none mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
              {botStatus?.isRunning
                ? `🟢 Actif · ${botStatus.totalScans ?? 0} scans`
                : "⚪ Bot inactif"}
            </p>
          </div>
        </div>

        {botStatus?.isRunning && (
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.25)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
            <span className="text-[10px] font-bold text-green-400">LIVE</span>
          </div>
        )}
      </header>

      {/* ── Contenu principal ── */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="px-3 py-3 pb-24"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Navigation bas (5 onglets) ── */}
      <nav className="tg-tabbar fixed bottom-0 left-0 right-0 flex items-stretch border-t z-50"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => haptic.select()}
              className={cn(
                "relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors duration-150 select-none",
                active ? "text-button" : "text-hint"
              )}
            >
              <tab.icon className={cn("w-4.5 h-4.5 transition-all duration-150", active && "scale-110")} />
              <span className="text-[9px] font-semibold">{tab.label}</span>
              {active && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 h-0.5 w-6 rounded-full bg-button"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
