import { useLocation, Link } from "wouter";
import { LayoutDashboard, Layers, BookMarked, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/hooks/useTelegram";
import { useGetBotStatus } from "@workspace/api-client-react";

const TABS = [
  { href: "/",            label: "Deals",       icon: LayoutDashboard },
  { href: "/collections", label: "Collections", icon: Layers          },
  { href: "/watchlist",   label: "Watchlist",   icon: BookMarked      },
  { href: "/settings",    label: "Config",      icon: Settings2       },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 8000 } });

  return (
    <div className="tg-app flex flex-col h-screen overflow-hidden">

      {/* ── Header compact ── */}
      <header className="tg-header flex items-center justify-between px-4 py-3 flex-shrink-0">
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
            <p className="text-sm font-bold leading-none text-text">GetGems Sniper</p>
            <p className="text-[10px] text-hint leading-none mt-0.5">
              {botStatus?.isRunning ? "🟢 Bot actif" : "⚪ Bot inactif"}
            </p>
          </div>
        </div>

        {/* Indicateur de scan animé */}
        {botStatus?.isRunning && (
          <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
            <span className="text-[11px] font-semibold text-green-400">SCANNING</span>
          </div>
        )}
      </header>

      {/* ── Contenu principal (scrollable) ── */}
      <main className="flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="px-3 py-3 pb-24"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Barre de navigation bas (style Telegram) ── */}
      <nav className="tg-tabbar fixed bottom-0 left-0 right-0 flex items-stretch border-t border-divider z-50">
        {TABS.map((tab) => {
          const active = location === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => haptic.select()}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors duration-150 select-none",
                active ? "text-button" : "text-hint"
              )}
            >
              <tab.icon
                className={cn(
                  "w-5 h-5 transition-all duration-150",
                  active ? "scale-110" : "scale-100"
                )}
              />
              <span className="text-[10px] font-semibold">{tab.label}</span>
              {active && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 h-0.5 w-8 rounded-full bg-button"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </Link>
          );
        })}
      </nav>

    </div>
  );
}
