import { useState, useEffect } from "react";
import { useGetCollections } from "@workspace/api-client-react";
import type { Collection } from "@workspace/api-client-react";
import { openLink, haptic } from "@/hooks/useTelegram";
import { ExternalLink, TrendingUp, TrendingDown, Minus, Search, X } from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip
} from "recharts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const TG_BLUE   = "var(--tg-theme-button-color)";
const TG_GREEN  = "#30d158";
const TG_RED    = "#ff453a";
const TG_ORANGE = "#ff9f0a";
const TG_HINT   = "var(--tg-theme-hint-color)";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FloorPoint { time: string; floor: number }
interface CollectionTrend {
  slug:         string;
  name:         string;
  currentFloor: number;
  volume24h:    number;
  change24h:    number | null;
  change7d:     number | null;
  floorHistory: FloorPoint[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function changeColor(v: number | null) {
  if (v == null) return TG_HINT;
  if (v > 0) return TG_GREEN;
  if (v < 0) return TG_RED;
  return TG_HINT;
}

function pct(v: number | null) {
  if (v == null) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

// ── Mini sparkline (inline, no axes) ─────────────────────────────────────────

function MiniSparkline({ data, positive }: { data: FloorPoint[]; positive: boolean | null }) {
  if (!data || data.length < 2) {
    return <div className="w-16 h-8" />;
  }
  const color = positive == null ? TG_BLUE : positive ? TG_GREEN : TG_RED;
  return (
    <ResponsiveContainer width={64} height={32}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`mini-${positive}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.4} />
            <stop offset="95%" stopColor={color} stopOpacity={0}   />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="floor"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#mini-${positive})`}
          dot={false}
        />
        <Tooltip
          contentStyle={{ background: "var(--tg-theme-secondary-bg-color)", border: "none", fontSize: 9, borderRadius: 6, padding: "2px 6px" }}
          formatter={(v: number) => [`${v.toFixed(4)}`, "Floor"]}
          labelFormatter={() => ""}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Collection Row ────────────────────────────────────────────────────────────

function CollectionRow({ col, trend }: { col: Collection; trend?: CollectionTrend }) {
  const change = trend?.change24h ?? null;
  const history = trend?.floorHistory ?? [];
  const first = history[0]?.floor;
  const last  = history[history.length - 1]?.floor;
  const positive = first != null && last != null ? last >= first : null;

  return (
    <div
      className="tg-row cursor-pointer active:scale-[0.99] transition-transform"
      onClick={() => { haptic.light(); openLink(`https://getgems.io/collection/${col.slug}`); }}
    >
      {/* Left: name + slug */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-sm font-semibold truncate">{col.name}</p>
        </div>
        <p className="text-[10px] truncate" style={{ color: TG_HINT }}>@{col.slug}</p>

        <div className="flex items-center gap-2 mt-1">
          {/* Floor */}
          <span className="text-xs font-bold" style={{ color: TG_BLUE }}>
            💎 {col.floorPrice.toFixed(2)}
          </span>

          {/* Volume */}
          {col.volume24h != null && col.volume24h > 0 && (
            <span className="text-[10px]" style={{ color: TG_HINT }}>
              Vol: {col.volume24h.toFixed(0)} TON
            </span>
          )}

          {/* Item count */}
          {col.itemCount != null && (
            <span className="text-[10px]" style={{ color: TG_HINT }}>
              {col.itemCount.toLocaleString()} items
            </span>
          )}
        </div>
      </div>

      {/* Right: sparkline + change + link */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Mini sparkline */}
        <MiniSparkline data={history} positive={positive} />

        {/* Change 24h */}
        <div className="flex flex-col items-end gap-0.5 min-w-[48px]">
          <div className="flex items-center gap-0.5" style={{ color: changeColor(change) }}>
            {change == null || change === 0
              ? <Minus className="w-3 h-3" style={{ color: TG_HINT }} />
              : change > 0
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />
            }
            <span className="text-[10px] font-bold">{pct(change)}</span>
          </div>
          <span className="text-[9px]" style={{ color: TG_HINT }}>24h</span>
          <ExternalLink className="w-3 h-3 mt-0.5" style={{ color: TG_HINT }} />
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CollectionsPage() {
  const { data: collections, isLoading, refetch } = useGetCollections({
    query: { refetchInterval: 30000 },
  });
  const [trends, setTrends] = useState<CollectionTrend[]>([]);
  const [search, setSearch] = useState("");

  // Load trends data
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/trends?period=7d`);
        if (!r.ok) return;
        const json = await r.json();
        setTrends(json.collections ?? []);
      } catch {}
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const trendMap = new Map<string, CollectionTrend>(
    trends.map((t) => [t.slug, t])
  );

  const filtered = (collections ?? []).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
  });

  // Sort by floor desc or by volume if available
  const sorted = [...filtered].sort((a, b) => {
    const ta = trendMap.get(a.slug);
    const tb = trendMap.get(b.slug);
    const va = ta?.volume24h ?? a.volume24h ?? 0;
    const vb = tb?.volume24h ?? b.volume24h ?? 0;
    if (vb !== va) return vb - va;
    return b.floorPrice - a.floorPrice;
  });

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Collections surveillées</p>
          <p className="text-xs mt-0.5" style={{ color: TG_HINT }}>
            Floor · Volume · Tendance 7j
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); refetch(); }}
          className="text-[10px] font-semibold px-3 py-1.5 rounded-full transition-all active:scale-95"
          style={{ background: `${TG_BLUE}20`, color: TG_BLUE, border: `1px solid ${TG_BLUE}40` }}
        >
          ⟳ Sync
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: TG_HINT }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une collection..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
          style={{ color: "var(--tg-theme-text-color)" }}
        />
        {search && (
          <button onClick={() => setSearch("")}>
            <X className="w-3.5 h-3.5" style={{ color: TG_HINT }} />
          </button>
        )}
      </div>

      {/* Stats summary */}
      {!isLoading && collections && collections.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl px-3 py-2 text-center" style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: TG_HINT }}>Collections</p>
            <p className="text-lg font-black mt-0.5">{collections.length}</p>
          </div>
          <div className="rounded-xl px-3 py-2 text-center" style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: TG_HINT }}>Floor moy.</p>
            <p className="text-lg font-black mt-0.5" style={{ color: TG_BLUE }}>
              {(collections.reduce((s, c) => s + c.floorPrice, 0) / collections.length).toFixed(1)}
            </p>
          </div>
          <div className="rounded-xl px-3 py-2 text-center" style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
            <p className="text-[9px] font-bold uppercase" style={{ color: TG_HINT }}>Vol. 24h</p>
            <p className="text-lg font-black mt-0.5" style={{ color: TG_ORANGE }}>
              {(() => {
                const total = collections.reduce((s, c) => s + (c.volume24h ?? 0), 0);
                return total > 1000 ? `${(total / 1000).toFixed(1)}k` : total.toFixed(0);
              })()}
            </p>
          </div>
        </div>
      )}

      {/* List */}
      <div className="tg-section">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="tg-row animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 bg-white/10 rounded" />
                <div className="h-3 w-16 bg-white/10 rounded" />
              </div>
              <div className="w-16 h-8 bg-white/10 rounded" />
            </div>
          ))
        ) : !sorted.length ? (
          <div className="tg-row justify-center py-10 flex-col gap-3">
            <span className="text-4xl">{search ? "🔎" : "📭"}</span>
            <p className="text-sm font-semibold">
              {search ? "Aucune collection trouvée" : "Aucune collection"}
            </p>
            <p className="text-xs" style={{ color: TG_HINT }}>
              {search ? "Essayez un autre terme." : "Ajoutez des collections dans la Watchlist"}
            </p>
          </div>
        ) : (
          sorted.map((c) => (
            <CollectionRow key={c.id} col={c} trend={trendMap.get(c.slug)} />
          ))
        )}
      </div>

    </div>
  );
}
