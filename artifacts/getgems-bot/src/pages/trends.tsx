import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus,
  BarChart2, Layers, Activity, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useTelegram";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = "24h" | "7d" | "30d";

interface FloorPoint  { time: string; floor: number }
interface CollectionTrend {
  slug:         string;
  name:         string;
  currentFloor: number;
  itemCount:    number;
  volume24h:    number;
  dealsFound:   number;
  change24h:    number | null;
  change7d:     number | null;
  updatedAt:    string;
  floorHistory: FloorPoint[];
}
interface TrendsResponse {
  collections: CollectionTrend[];
  period:      string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TG_BLUE   = "var(--tg-theme-button-color)";
const TG_GREEN  = "#30d158";
const TG_RED    = "#ff453a";
const TG_ORANGE = "#ff9f0a";
const TG_HINT   = "var(--tg-theme-hint-color)";

const PERIOD_LABELS: Record<Period, string> = {
  "24h": "24h",
  "7d":  "7 jours",
  "30d": "30 jours",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function changeColor(v: number | null): string {
  if (v == null) return TG_HINT;
  if (v > 0)    return TG_GREEN;
  if (v < 0)    return TG_RED;
  return TG_HINT;
}

function ChangeIcon({ v }: { v: number | null }) {
  if (v == null || v === 0) return <Minus className="w-3 h-3" style={{ color: TG_HINT }} />;
  if (v > 0) return <TrendingUp  className="w-3 h-3" style={{ color: TG_GREEN }} />;
  return      <TrendingDown className="w-3 h-3" style={{ color: TG_RED }} />;
}

function shortLabel(time: string): string {
  if (!time) return "";
  if (time.includes("T")) return time.slice(11, 16);
  return time.slice(5);
}

// ── Micro sparkline ──────────────────────────────────────────────────────────

function Sparkline({ data, positive }: { data: FloorPoint[]; positive: boolean | null }) {
  if (!data || data.length < 2) {
    return (
      <div className="h-12 flex items-center justify-center text-[10px]"
        style={{ color: TG_HINT }}>
        Historique en accumulation…
      </div>
    );
  }

  const color = positive == null ? TG_BLUE : positive ? TG_GREEN : TG_RED;

  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${positive}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="floor"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${positive})`}
          dot={false}
          isAnimationActive={false}
        />
        <XAxis dataKey="time" hide />
        <YAxis domain={["auto", "auto"]} hide />
        <Tooltip
          contentStyle={{
            background: "var(--tg-theme-secondary-bg-color)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            fontSize: 11,
            color: "var(--tg-theme-text-color)",
          }}
          formatter={(v: number) => [`${v.toFixed(4)} TON`, "Floor"]}
          labelFormatter={shortLabel}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Collection card ──────────────────────────────────────────────────────────

function CollectionCard({ col, period }: { col: CollectionTrend; period: Period }) {
  const [expanded, setExpanded] = useState(false);
  const mainChange = period === "24h" ? col.change24h : col.change7d;
  const positive   = mainChange == null ? null : mainChange > 0;

  return (
    <div
      className="rounded-2xl p-3.5 cursor-pointer transition-all duration-150 active:scale-[0.98]"
      style={{ background: "var(--tg-theme-secondary-bg-color)", border: "1px solid rgba(255,255,255,0.06)" }}
      onClick={() => { setExpanded(e => !e); haptic.select(); }}
    >
      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold truncate">{col.name}</p>
          <p className="text-[10px] mt-0.5" style={{ color: TG_HINT }}>
            {col.itemCount} listings • {col.dealsFound} deals
          </p>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-[13px] font-black">{col.currentFloor.toFixed(4)} TON</p>
          <div className="flex items-center gap-1 justify-end mt-0.5">
            <ChangeIcon v={mainChange} />
            <span className="text-[11px] font-bold" style={{ color: changeColor(mainChange) }}>
              {pct(mainChange)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-2 mt-2.5">
        {[
          { label: "Floor",     value: `${col.currentFloor.toFixed(4)} TON`, icon: Activity },
          { label: "24h",       value: pct(col.change24h),                  icon: TrendingUp, color: changeColor(col.change24h) },
          { label: "7 jours",   value: pct(col.change7d),                   icon: TrendingUp, color: changeColor(col.change7d) },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl p-2 text-center"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <Icon className="w-3 h-3 mx-auto mb-0.5" style={{ color: color ?? TG_HINT }} />
            <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: TG_HINT }}>{label}</p>
            <p className="text-[11px] font-bold" style={{ color: color ?? "inherit" }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Sparkline (expandable) ── */}
      {expanded && (
        <div className="mt-3">
          <p className="text-[10px] mb-1.5 font-semibold" style={{ color: TG_HINT }}>
            Évolution du floor — {PERIOD_LABELS[period]}
          </p>
          <Sparkline data={col.floorHistory} positive={positive} />
          <a
            href={`https://getgems.io/collection/${col.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 mt-2.5 text-[11px] font-semibold"
            style={{ color: TG_BLUE }}
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
            Voir sur GetGems
          </a>
        </div>
      )}
    </div>
  );
}

// ── Page principale ──────────────────────────────────────────────────────────

export default function TrendsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [sort, setSort]     = useState<"change" | "floor" | "listings">("change");

  const { data, isLoading, isError, refetch } = useQuery<TrendsResponse>({
    queryKey: ["trends", period],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/trends?period=${period}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<TrendsResponse>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const collections = data?.collections ?? [];

  const sorted = [...collections].sort((a, b) => {
    if (sort === "floor")    return b.currentFloor - a.currentFloor;
    if (sort === "listings") return b.itemCount - a.itemCount;
    // change: tri par variation absolue (plus actif en premier)
    const changeA = period === "24h" ? (a.change24h ?? 0) : (a.change7d ?? 0);
    const changeB = period === "24h" ? (b.change24h ?? 0) : (b.change7d ?? 0);
    return Math.abs(changeB) - Math.abs(changeA);
  });

  // Agrégats globaux
  const withChange24 = collections.filter(c => c.change24h != null);
  const avgChange24  = withChange24.length
    ? withChange24.reduce((s, c) => s + (c.change24h!), 0) / withChange24.length
    : null;
  const topGainer    = [...collections].sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity))[0];
  const topLoser     = [...collections].sort((a, b) => (a.change24h ?? Infinity) - (b.change24h ?? Infinity))[0];

  return (
    <div className="space-y-3">

      {/* ── Titre ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-black">Tendances</h1>
          <p className="text-[10px]" style={{ color: TG_HINT }}>
            Collections GetGems · Floor virtuel (médiane)
          </p>
        </div>
        <button
          onClick={() => { refetch(); haptic.impact(); }}
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}
        >
          <BarChart2 className="w-4 h-4" style={{ color: TG_BLUE }} />
        </button>
      </div>

      {/* ── Filtre période ── */}
      <div className="flex gap-1.5">
        {(["24h", "7d", "30d"] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => { setPeriod(p); haptic.select(); }}
            className={cn(
              "flex-1 py-1.5 rounded-xl text-[11px] font-bold transition-colors",
              period === p
                ? "text-white"
                : "text-hint"
            )}
            style={period === p
              ? { background: TG_BLUE }
              : { background: "var(--tg-theme-secondary-bg-color)" }
            }
          >
            {p}
          </button>
        ))}
      </div>

      {/* ── Résumé global ── */}
      {collections.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="stat-card text-center">
            <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: TG_HINT }}>Collections</p>
            <p className="text-xl font-black" style={{ color: TG_BLUE }}>{collections.length}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: TG_HINT }}>Moy. 24h</p>
            <p className="text-xl font-black" style={{ color: changeColor(avgChange24) }}>
              {avgChange24 != null ? pct(avgChange24) : "—"}
            </p>
          </div>
          <div className="stat-card text-center">
            <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: TG_HINT }}>Listings</p>
            <p className="text-xl font-black">
              {collections.reduce((s, c) => s + c.itemCount, 0)}
            </p>
          </div>
        </div>
      )}

      {/* ── Top Gainer / Loser ── */}
      {(topGainer?.change24h != null || topLoser?.change24h != null) && (
        <div className="grid grid-cols-2 gap-2">
          {topGainer?.change24h != null && topGainer.change24h > 0 && (
            <div className="rounded-2xl p-3"
              style={{ background: "rgba(48,209,88,0.08)", border: "1px solid rgba(48,209,88,0.2)" }}>
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="w-3 h-3" style={{ color: TG_GREEN }} />
                <p className="text-[9px] font-bold uppercase" style={{ color: TG_GREEN }}>Top Hausse 24h</p>
              </div>
              <p className="text-[11px] font-bold truncate">{topGainer.name}</p>
              <p className="text-[15px] font-black" style={{ color: TG_GREEN }}>
                {pct(topGainer.change24h)}
              </p>
            </div>
          )}
          {topLoser?.change24h != null && topLoser.change24h < 0 && (
            <div className="rounded-2xl p-3"
              style={{ background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.2)" }}>
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown className="w-3 h-3" style={{ color: TG_RED }} />
                <p className="text-[9px] font-bold uppercase" style={{ color: TG_RED }}>Top Baisse 24h</p>
              </div>
              <p className="text-[11px] font-bold truncate">{topLoser.name}</p>
              <p className="text-[15px] font-black" style={{ color: TG_RED }}>
                {pct(topLoser.change24h)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Tri ── */}
      {collections.length > 0 && (
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] font-semibold shrink-0" style={{ color: TG_HINT }}>Trier:</p>
          {([
            { key: "change",   label: "Activité" },
            { key: "floor",    label: "Floor" },
            { key: "listings", label: "Listings" },
          ] as { key: typeof sort; label: string }[]).map(s => (
            <button
              key={s.key}
              onClick={() => { setSort(s.key); haptic.select(); }}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors",
                sort === s.key ? "text-white" : "text-hint"
              )}
              style={sort === s.key
                ? { background: TG_BLUE }
                : { background: "var(--tg-theme-secondary-bg-color)" }
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── État de chargement ── */}
      {isLoading && (
        <div className="space-y-2.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl h-24 animate-pulse"
              style={{ background: "var(--tg-theme-secondary-bg-color)" }} />
          ))}
        </div>
      )}

      {/* ── Erreur ── */}
      {isError && (
        <div className="rounded-2xl p-5 text-center"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
          <p className="text-2xl mb-1">⚠️</p>
          <p className="text-sm font-bold">Impossible de charger les tendances</p>
          <button
            onClick={() => refetch()}
            className="mt-3 text-[11px] font-bold px-4 py-1.5 rounded-full"
            style={{ background: TG_BLUE, color: "white" }}
          >
            Réessayer
          </button>
        </div>
      )}

      {/* ── Liste des collections ── */}
      {!isLoading && !isError && sorted.length === 0 && (
        <div className="rounded-2xl p-6 text-center"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
          <Layers className="w-8 h-8 mx-auto mb-2" style={{ color: TG_HINT }} />
          <p className="text-sm font-bold mb-1">Aucune donnée de tendance</p>
          <p className="text-[11px]" style={{ color: TG_HINT }}>
            Les tendances apparaissent après plusieurs heures de scan.
            Le bot accumule l'historique automatiquement.
          </p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-2.5">
          {sorted.map(col => (
            <CollectionCard key={col.slug} col={col} period={period} />
          ))}
        </div>
      )}

      {/* ── Note de bas de page ── */}
      {sorted.length > 0 && (
        <p className="text-center text-[9px] pb-1" style={{ color: TG_HINT }}>
          Source: TonAPI · Floor = médiane des listings GetGems · /{">"}trends pour accéder via Telegram
        </p>
      )}
    </div>
  );
}
