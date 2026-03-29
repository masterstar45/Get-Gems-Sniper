import { useLocation, Link } from "wouter";
import { LayoutDashboard, Layers, BookMarked, Settings2, BarChart2, TrendingUp, Newspaper, Wallet, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/hooks/useTelegram";
import { useGetBotStatus } from "@workspace/api-client-react";
import { useTonWallet } from "@/hooks/useTonWallet";
import { useDealsNotifier } from "@/hooks/useDealsNotifier";
import { useState, useEffect } from "react";

const TABS = [
  { href: "/",            label: "Deals",    icon: LayoutDashboard },
  { href: "/stats",       label: "Stats",    icon: BarChart2       },
  { href: "/trends",      label: "Trends",   icon: TrendingUp      },
  { href: "/market",      label: "Actus",    icon: Newspaper       },
  { href: "/collections", label: "Collecs",  icon: Layers          },
  { href: "/watchlist",   label: "Watch",    icon: BookMarked      },
  { href: "/settings",    label: "Config",   icon: Settings2       },
];

// ── Bouton Wallet TON ──────────────────────────────────────────────────────────

function WalletButton() {
  const { connected, shortAddress, loading, connect, disconnect } = useTonWallet();
  const [showDisconnect, setShowDisconnect] = useState(false);

  if (connected && shortAddress) {
    return (
      <div className="relative">
        <button
          onClick={() => { haptic.select(); setShowDisconnect(!showDisconnect); }}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95"
          style={{ background: "rgba(0,122,255,0.15)", border: "1px solid rgba(0,122,255,0.35)", color: "#007aff" }}
        >
          <Wallet className="w-3 h-3" />
          {shortAddress}
        </button>
        {showDisconnect && (
          <div className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-xl"
            style={{ background: "var(--tg-theme-secondary-bg-color)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <button
              onClick={() => { haptic.medium(); disconnect(); setShowDisconnect(false); }}
              className="flex items-center gap-2 px-4 py-3 text-xs font-semibold whitespace-nowrap w-full"
              style={{ color: "#ff453a" }}
            >
              <LogOut className="w-3.5 h-3.5" />
              Déconnecter
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => { haptic.select(); connect(); }}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "var(--tg-theme-hint-color)" }}
    >
      <Wallet className={`w-3 h-3 ${loading ? "animate-pulse" : ""}`} />
      {loading ? "…" : "Wallet"}
    </button>
  );
}

// ── Layout principal ───────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 8000 } });
  const { newCount, markAllSeen } = useDealsNotifier();

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  // Quand l'utilisateur ouvre l'onglet Deals, marque tout comme vu
  useEffect(() => {
    if (location === "/") markAllSeen();
  }, [location, markAllSeen]);

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

        <WalletButton />
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

      {/* ── Navigation bas (scrollable) ── */}
      <nav className="tg-tabbar fixed bottom-0 left-0 right-0 border-t z-50 overflow-x-auto"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="flex items-stretch" style={{ minWidth: "max-content", width: "100%" }}>
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            const showBadge = tab.href === "/" && newCount > 0 && !active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => { haptic.select(); if (tab.href === "/") markAllSeen(); }}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors duration-150 select-none",
                  active ? "text-button" : "text-hint"
                )}
                style={{ minWidth: "52px", flex: "1 1 0" }}
              >
                <div className="relative">
                  <tab.icon className={cn("w-4 h-4 transition-all duration-150", active && "scale-110")} />
                  {showBadge && (
                    <span
                      className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-black"
                      style={{ background: "#ff453a", color: "#fff", lineHeight: 1 }}
                    >
                      {newCount > 9 ? "9+" : newCount}
                    </span>
                  )}
                </div>
                <span className="text-[8px] font-semibold">{tab.label}</span>
                {active && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 h-0.5 w-5 rounded-full bg-button"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
