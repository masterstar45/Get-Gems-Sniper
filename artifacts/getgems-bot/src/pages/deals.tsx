import { useState, useMemo, useRef, useEffect } from "react";
import { useGetDeals, useGetDealStats, useGetBotStatus } from "@workspace/api-client-react";
import type { Deal, BotStatus } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { tg, haptic } from "@/hooks/useTelegram";
import {
  Flame, Target, TrendingDown, Layers, Search, X,
  SlidersHorizontal, ChevronRight, Crosshair
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip
} from "recharts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ── Color constants ────────────────────────────────────────────────────────────

const TG_BLUE   = "var(--tg-theme-button-color)";
const TG_GREEN  = "#30d158";
const TG_RED    = "#ff453a";
const TG_ORANGE = "#ff9f0a";
const TG_HINT   = "var(--tg-theme-hint-color)";

// ── Helpers ───────────────────────────────────────────────────────────────────

type DealEx = Deal & { source?: string; buy_link?: string };

function priorityLabel(p: string) {
  if (p === "extreme") return { label: "🔴 EXTRÊME",  color: TG_RED    };
  if (p === "high")    return { label: "🟠 HOT DEAL", color: TG_ORANGE };
  return                      { label: "🟢 DEAL",     color: TG_GREEN  };
}

function sourceInfo(src: string | undefined) {
  if (src === "fragment")     return { label: "Fragment",  emoji: "💫", color: "#0088cc", key: "fragment" };
  if (src === "getgems_gift") return { label: "TG Gift",   emoji: "🎁", color: "#bf5af2", key: "tg_gifts" };
  if (src === "tg_gifts")     return { label: "TG Gift",   emoji: "🎁", color: "#bf5af2", key: "tg_gifts" };
  if (src === "tonnel")       return { label: "Tonnel",    emoji: "🔵", color: "#30d158", key: "tonnel"   };
  return                              { label: "GetGems",  emoji: "💎", color: TG_BLUE,   key: "getgems"  };
}

function buyButtonLabel(src: string | undefined) {
  if (src === "fragment")                 return "💫 Acheter sur Fragment";
  if (src === "getgems_gift" || src === "tg_gifts") return "🎁 Acheter sur GetGems";
  if (src === "tonnel")                   return "🔵 Acheter sur Tonnel";
  return "🛒 Acheter sur GetGems";
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? TG_GREEN : score >= 40 ? TG_ORANGE : TG_HINT;
  return (
    <span className="rounded-lg text-[10px] font-black px-2 py-0.5 whitespace-nowrap"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {score}/100
    </span>
  );
}

// ── Floor sparkline (7j) ──────────────────────────────────────────────────────

interface FloorPoint { time: string; floor: number }

function FloorSparkline({ collectionName }: { collectionName: string }) {
  const [data, setData] = useState<FloorPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/trends?period=7d`);
        if (!r.ok) return;
        const json = await r.json();
        const nameLower = collectionName.toLowerCase();
        // Prefer exact name match, then partial match as fallback
        const col = (json.collections ?? []).find(
          (c: { name: string; slug: string; floorHistory: FloorPoint[] }) =>
            c.name.toLowerCase() === nameLower
        ) ?? (json.collections ?? []).find(
          (c: { name: string; slug: string; floorHistory: FloorPoint[] }) =>
            c.name.toLowerCase().includes(nameLower) ||
            nameLower.includes(c.name.toLowerCase())
        );
        if (!cancelled && col?.floorHistory?.length) {
          setData(col.floorHistory);
        }
      } catch {}
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [collectionName]);

  if (loading) {
    return (
      <div className="h-14 flex items-center justify-center">
        <span className="text-[10px] animate-pulse" style={{ color: TG_HINT }}>Chargement historique…</span>
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="h-10 flex items-center justify-center">
        <span className="text-[10px]" style={{ color: TG_HINT }}>Historique en accumulation…</span>
      </div>
    );
  }

  const first = data[0].floor;
  const last  = data[data.length - 1].floor;
  const trend = last >= first;
  const color = trend ? TG_GREEN : TG_RED;

  const shortLabel = (t: string) => {
    if (t.includes("T")) return t.slice(11, 16);
    return t.slice(5);
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={52}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="floor"
            stroke={color}
            strokeWidth={1.5}
            fill="url(#spark-grad)"
            dot={false}
          />
          <XAxis dataKey="time" tickFormatter={shortLabel} tick={{ fontSize: 8, fill: TG_HINT }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--tg-theme-secondary-bg-color)", border: "none", fontSize: 10, borderRadius: 8 }}
            formatter={(v: number) => [`${v.toFixed(4)} TON`, "Floor"]}
            labelFormatter={shortLabel}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[9px] mt-0.5" style={{ color: TG_HINT }}>
        <span>{first.toFixed(4)} TON</span>
        <span style={{ color }}>{last >= first ? "▲" : "▼"} {last.toFixed(4)} TON</span>
      </div>
    </div>
  );
}

// ── Deal Drawer ───────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round(value / max * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]" style={{ color: TG_HINT }}>
        <span>{label}</span><span>{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function DealDrawer({ deal, onClose }: { deal: DealEx; onClose: () => void }) {
  const prio    = priorityLabel(deal.priority);
  const src     = sourceInfo(deal.source);
  const savings = deal.floorPrice - deal.currentPrice;
  const [imgError, setImgError] = useState(false);

  const s_disc  = Math.round(Math.min(40, (deal.discountPercent / 80) * 40));
  const s_vol   = Math.round(deal.score > 50 ? 15 : 5);
  const s_trend = Math.round(deal.score > 60 ? 12 : 8);
  const s_floor = Math.round(Math.min(15, (deal.floorPrice / 100) * 15));

  const handleBuy = () => {
    haptic.medium();
    const url = deal.buy_link ?? deal.link;
    if (tg) {
      try { tg.openLink(url); } catch { window.open(url, "_blank"); }
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative rounded-t-2xl overflow-hidden"
        style={{ background: "var(--tg-theme-secondary-bg-color)" }}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 400, damping: 40 }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
        </div>

        <div className="px-4 space-y-4 max-h-[82vh] overflow-y-auto"
          style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>

          {/* Header avec image */}
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-2xl flex-shrink-0 overflow-hidden flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              {deal.imageUrl && !imgError
                ? <img src={deal.imageUrl} alt={deal.nftName}
                    className="w-full h-full object-cover"
                    onError={() => setImgError(true)} />
                : <span className="text-3xl">🎁</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-base truncate">{deal.nftName}</p>
              <p className="text-xs truncate" style={{ color: TG_HINT }}>{deal.collectionName}</p>
              <p className="text-[10px] mt-0.5" style={{ color: TG_HINT }}>
                Détecté {formatDistanceToNow(new Date(deal.detectedAt), { addSuffix: true, locale: fr })}
              </p>
            </div>
            <button onClick={onClose} className="ml-1 mt-0.5 p-1.5 rounded-full flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.08)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ background: `${prio.color}22`, color: prio.color, border: `1px solid ${prio.color}44` }}>
              {prio.label}
            </span>
            <ScoreBadge score={deal.score} />
            <span className="text-xs font-semibold px-2 py-1 rounded-full"
              style={{ background: `${src.color}18`, color: src.color, border: `1px solid ${src.color}33` }}>
              {src.emoji} {src.label}
            </span>
          </div>

          {/* Prix */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: TG_HINT }}>Prix actuel</span>
              <span className="font-black text-sm" style={{ color: TG_BLUE }}>
                💎 {deal.currentPrice.toFixed(4)} TON
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: TG_HINT }}>Floor price</span>
              <span className="text-sm font-semibold">{deal.floorPrice.toFixed(4)} TON</span>
            </div>
            <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold" style={{ color: TG_HINT }}>Réduction</span>
              <span className="font-black text-lg" style={{ color: TG_GREEN }}>
                -{deal.discountPercent}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: TG_HINT }}>Économie</span>
              <span className="text-sm font-bold" style={{ color: TG_GREEN }}>
                +{savings.toFixed(4)} TON
              </span>
            </div>
          </div>

          {/* Historique du floor (sparkline 7j) */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>
              Historique floor — 7 jours
            </p>
            <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
              <FloorSparkline collectionName={deal.collectionName} />
            </div>
          </div>

          {/* Score détaillé */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>
              Score détaillé
            </p>
            <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(255,255,255,0.04)" }}>
              <ScoreBar label="Réduction"    value={s_disc}  max={40} color={TG_GREEN}  />
              <ScoreBar label="Liquidité"    value={s_vol}   max={25} color={TG_BLUE}   />
              <ScoreBar label="Tendance"     value={s_trend} max={20} color={TG_ORANGE} />
              <ScoreBar label="Valeur floor" value={s_floor} max={15} color="#bf5af2"   />
            </div>
          </div>

          {/* Bouton achat */}
          <button
            onClick={handleBuy}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm active:scale-[0.98] transition-transform"
            style={{ background: src.color, color: "#fff" }}
          >
            {buyButtonLabel(deal.source)}
          </button>

        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Deal Row ──────────────────────────────────────────────────────────────────

function DealRow({
  deal,
  onTap,
  snipeMode,
  isNew,
}: {
  deal: DealEx;
  onTap: () => void;
  snipeMode: boolean;
  isNew: boolean;
}) {
  const prio = priorityLabel(deal.priority);
  const src  = sourceInfo(deal.source);
  const flash = snipeMode && isNew && deal.priority === "extreme";

  return (
    <motion.div
      className="tg-row items-start cursor-pointer active:scale-[0.98] transition-transform relative overflow-hidden"
      onClick={() => { haptic.select(); onTap(); }}
      layout
      initial={isNew ? { opacity: 0, x: -20 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      {/* Flash overlay pour snipe mode extreme */}
      {flash && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none z-10"
          style={{ background: "rgba(255,69,58,0.35)" }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      )}

      {/* Image */}
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.06)" }}>
        {deal.imageUrl
          ? <img src={deal.imageUrl} alt={deal.nftName} className="w-full h-full object-cover" />
          : <span className="text-2xl">{src.emoji}</span>}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: `${prio.color}20`, color: prio.color }}>
            {prio.label}
          </span>
          <ScoreBadge score={deal.score} />
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
            style={{ background: `${src.color}18`, color: src.color }}>
            {src.emoji} {src.label}
          </span>
        </div>

        <p className="text-sm font-semibold truncate">{deal.nftName}</p>
        <p className="text-[10px] truncate" style={{ color: TG_HINT }}>{deal.collectionName}</p>

        <div className="flex items-center gap-3 mt-1.5">
          <div>
            <p className="text-[9px]" style={{ color: TG_HINT }}>Prix</p>
            <p className="text-xs font-bold" style={{ color: TG_BLUE }}>
              💎 {deal.currentPrice.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[9px]" style={{ color: TG_HINT }}>Floor</p>
            <p className="text-xs" style={{ color: TG_HINT }}>{deal.floorPrice.toFixed(2)}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-base font-black" style={{ color: TG_GREEN }}>
              -{deal.discountPercent}%
            </span>
            <ChevronRight className="w-3.5 h-3.5" style={{ color: TG_HINT }} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Source filter options ─────────────────────────────────────────────────────

const SOURCES = [
  { key: "",          label: "Toutes",    emoji: "🔍" },
  { key: "getgems",   label: "GetGems",   emoji: "💎" },
  { key: "tg_gifts",  label: "TG Gift",   emoji: "🎁" },
  { key: "fragment",  label: "Fragment",  emoji: "💫" },
  { key: "tonnel",    label: "Tonnel",    emoji: "🔵" },
] as const;

const PRIORITIES = ["", "normal", "high", "extreme"] as const;
const PRIORITY_LABELS: Record<string, string> = {
  "": "Tous", normal: "🟢 Deal", high: "🟠 Hot", extreme: "🔴 Extrême"
};

// ── Page principale ───────────────────────────────────────────────────────────

export default function DealsPage() {
  const { data: botStatus } = useGetBotStatus({ query: { refetchInterval: 8000 } });
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGetDealStats({ query: { refetchInterval: 10000 } });
  const { data: deals, isLoading: dealsLoading, refetch: refetchDeals, isFetching } = useGetDeals({}, { query: { refetchInterval: 8000 } });

  const [search, setSearch]       = useState("");
  const [priority, setPriority]   = useState<string>("");
  const [source, setSource]       = useState<string>("");
  const [minScore, setMinScore]   = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealEx | null>(null);
  const [snipeMode, setSnipeMode] = useState(false);

  // Track which deal IDs are "new" (arrived since last render)
  const prevIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!deals) return;
    const currentIds = new Set(deals.map((d) => d.id));
    const arrivedIds = new Set<number>();
    currentIds.forEach((id) => {
      if (!prevIdsRef.current.has(id) && prevIdsRef.current.size > 0) {
        arrivedIds.add(id);
      }
    });
    if (arrivedIds.size > 0) {
      setNewIds(arrivedIds);
      // Snipe mode: haptic heavy for extreme new deals
      if (snipeMode) {
        const extremeNew = deals.filter((d) => arrivedIds.has(d.id) && d.priority === "extreme");
        if (extremeNew.length > 0) {
          try { haptic.heavy?.(); } catch { haptic.medium(); }
        }
      }
      setTimeout(() => setNewIds(new Set()), 3000);
    }
    prevIdsRef.current = currentIds;
  }, [deals, snipeMode]);

  const handleRefresh = () => {
    haptic.medium();
    refetchDeals();
    refetchStats();
  };

  const filtered = useMemo(() => {
    if (!deals) return [];
    return (deals as DealEx[]).filter((d) => {
      if (priority && d.priority !== priority) return false;
      if (minScore && d.score < minScore) return false;
      if (source) {
        const si = sourceInfo(d.source);
        if (si.key !== source) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!d.nftName.toLowerCase().includes(q) && !d.collectionName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [deals, priority, minScore, source, search]);

  const hasFilters = !!priority || minScore > 0 || !!search || !!source;

  return (
    <div className="space-y-3">

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="stat-card">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5" style={{ color: TG_BLUE }} />
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>Total</p>
          </div>
          <p className="text-2xl font-black">{statsLoading ? "…" : stats?.totalDeals ?? 0}</p>
        </div>

        <div className="stat-card" style={{ background: "rgba(255,69,58,0.08)", borderColor: "rgba(255,69,58,0.2)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Flame className="w-3.5 h-3.5 text-red-400" />
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>Prioritaires</p>
          </div>
          <p className="text-2xl font-black text-red-400">{statsLoading ? "…" : stats?.highPriorityDeals ?? 0}</p>
        </div>

        <div className="stat-card" style={{ background: "rgba(48,209,88,0.08)", borderColor: "rgba(48,209,88,0.2)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5" style={{ color: TG_GREEN }} />
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>Réduction moy.</p>
          </div>
          <p className="text-2xl font-black" style={{ color: TG_GREEN }}>-{statsLoading ? "…" : stats?.avgDiscount ?? 0}%</p>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5" style={{ color: TG_HINT }} />
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>Collections</p>
          </div>
          <p className="text-2xl font-black">{statsLoading ? "…" : stats?.totalCollections ?? 0}</p>
        </div>
      </div>

      {/* ── Barre recherche + filtres + snipe ── */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: TG_HINT }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un NFT..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
              style={{ color: "var(--tg-theme-text-color)" }}
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X className="w-3.5 h-3.5" style={{ color: TG_HINT }} />
              </button>
            )}
          </div>

          {/* Mode Snipe toggle */}
          <button
            onClick={() => { haptic.select(); setSnipeMode(!snipeMode); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all whitespace-nowrap"
            style={{
              background: snipeMode ? "rgba(255,69,58,0.2)" : "var(--tg-theme-secondary-bg-color)",
              color: snipeMode ? TG_RED : TG_HINT,
              border: snipeMode ? `1px solid ${TG_RED}66` : "1px solid transparent",
            }}
            title="Mode Snipe : vibration + flash rouge sur les deals extrêmes"
          >
            <Crosshair className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Snipe 🎯</span>
            {snipeMode && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: TG_RED }} />}
          </button>

          <button
            onClick={() => { haptic.select(); setShowFilters(!showFilters); }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
            style={{
              background: showFilters || hasFilters ? `${TG_BLUE}22` : "var(--tg-theme-secondary-bg-color)",
              color: showFilters || hasFilters ? TG_BLUE : TG_HINT,
              border: showFilters || hasFilters ? `1px solid ${TG_BLUE}44` : "1px solid transparent",
            }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtres {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
          </button>
        </div>

        {/* Panel filtres */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl p-3 space-y-3"
                style={{ background: "var(--tg-theme-secondary-bg-color)" }}>

                {/* Filtre source */}
                <div>
                  <p className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: TG_HINT }}>Source</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {SOURCES.map((s) => (
                      <button key={s.key}
                        onClick={() => { haptic.select(); setSource(s.key); }}
                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
                        style={{
                          background: source === s.key ? `${TG_BLUE}30` : "rgba(255,255,255,0.06)",
                          color: source === s.key ? TG_BLUE : TG_HINT,
                          border: source === s.key ? `1px solid ${TG_BLUE}60` : "1px solid transparent",
                        }}
                      >
                        {s.emoji} {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filtre priorité */}
                <div>
                  <p className="text-[10px] font-bold mb-2 uppercase tracking-wider" style={{ color: TG_HINT }}>Priorité</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRIORITIES.map((p) => (
                      <button key={p}
                        onClick={() => { haptic.select(); setPriority(p); }}
                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all"
                        style={{
                          background: priority === p ? `${TG_BLUE}30` : "rgba(255,255,255,0.06)",
                          color: priority === p ? TG_BLUE : TG_HINT,
                          border: priority === p ? `1px solid ${TG_BLUE}60` : "1px solid transparent",
                        }}
                      >
                        {PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filtre score minimum */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>Score minimum</p>
                    <p className="text-[10px] font-bold" style={{ color: TG_BLUE }}>{minScore > 0 ? `≥ ${minScore}` : "Tous"}</p>
                  </div>
                  <input
                    type="range" min={0} max={90} step={10}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="w-full accent-blue-500 h-1.5"
                  />
                  <div className="flex justify-between text-[9px] mt-0.5" style={{ color: TG_HINT }}>
                    <span>0</span><span>30</span><span>50</span><span>70</span><span>90</span>
                  </div>
                </div>

                {hasFilters && (
                  <button
                    onClick={() => { setPriority(""); setMinScore(0); setSearch(""); setSource(""); haptic.select(); }}
                    className="text-[10px] font-semibold"
                    style={{ color: TG_RED }}
                  >
                    ✕ Réinitialiser les filtres
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Snipe mode banner */}
        {snipeMode && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,69,58,0.12)", border: "1px solid rgba(255,69,58,0.3)" }}
          >
            <Crosshair className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TG_RED }} />
            <p className="text-[10px] font-semibold" style={{ color: TG_RED }}>
              Mode Snipe actif — vibration + flash rouge sur les deals extrêmes
            </p>
          </motion.div>
        )}
      </div>

      {/* ── En-tête liste + bouton refresh ── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-bold">
          {filtered.length} opportunité{filtered.length > 1 ? "s" : ""}
          {hasFilters ? " (filtrées)" : ""}
        </p>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-semibold transition-all active:scale-95"
          style={{ background: "rgba(48,209,88,0.15)", color: TG_GREEN, border: "1px solid rgba(48,209,88,0.3)" }}
        >
          <span className={isFetching ? "animate-spin inline-block" : ""}>⟳</span>
          {isFetching ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {/* ── Liste des deals ── */}
      <div className="tg-section">
        {dealsLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tg-row animate-pulse">
              <div className="w-12 h-12 rounded-xl flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
                <div className="h-3 w-36 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>
            </div>
          ))
        ) : !filtered.length ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <span className="text-4xl">{hasFilters ? "🔎" : "🔍"}</span>
            <p className="text-sm font-semibold">
              {hasFilters ? "Aucun deal correspondant" : "Aucun deal pour l'instant"}
            </p>
            <p className="text-xs text-center" style={{ color: TG_HINT }}>
              {hasFilters
                ? "Essayez d'élargir vos filtres ou de baisser le seuil minimum."
                : "Le bot scanne en continu. Les deals apparaissent dès détection."}
            </p>
            {!hasFilters && botStatus && (
              <div className="flex items-center gap-1.5 text-[10px] rounded-full px-3 py-1"
                style={{ background: "rgba(48,209,88,0.1)", color: TG_GREEN }}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {(botStatus as BotStatus).totalScans ?? 0} scans effectués
              </div>
            )}
            {!hasFilters && (
              <button
                onClick={handleRefresh}
                className="text-xs px-4 py-1.5 rounded-full font-semibold mt-1 transition-all active:scale-95"
                style={{ background: "var(--tg-theme-button-color)", color: "var(--tg-theme-button-text-color)" }}
              >
                Vérifier maintenant
              </button>
            )}
          </div>
        ) : (
          (filtered as DealEx[]).map((deal) => (
            <DealRow
              key={deal.id}
              deal={deal}
              snipeMode={snipeMode}
              isNew={newIds.has(deal.id)}
              onTap={() => setSelectedDeal(deal)}
            />
          ))
        )}
      </div>

      {/* ── Deal Drawer ── */}
      <AnimatePresence>
        {selectedDeal && (
          <DealDrawer deal={selectedDeal} onClose={() => { haptic.light(); setSelectedDeal(null); }} />
        )}
      </AnimatePresence>

    </div>
  );
}
