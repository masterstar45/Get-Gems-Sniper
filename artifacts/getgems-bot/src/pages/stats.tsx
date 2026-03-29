import { useGetDealStats, useGetDeals, useGetCollections } from "@workspace/api-client-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie
} from "recharts";
import { format, subHours, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { TrendingUp, TrendingDown, Zap, Activity } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TG_BLUE   = "var(--tg-theme-button-color)";
const TG_GREEN  = "#30d158";
const TG_RED    = "#ff453a";
const TG_ORANGE = "#ff9f0a";
const TG_HINT   = "var(--tg-theme-hint-color)";
const TG_BG2    = "var(--tg-theme-secondary-bg-color)";

function StatCard({ label, value, sub, color, icon: Icon, trend }: {
  label: string; value: string | number; sub?: string;
  color?: string; icon: React.ElementType; trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color: color ?? TG_HINT }} />
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>{label}</p>
        {trend === "up" && <TrendingUp className="w-3 h-3 ml-auto text-green-400" />}
        {trend === "down" && <TrendingDown className="w-3 h-3 ml-auto text-red-400" />}
      </div>
      <p className="text-2xl font-black" style={{ color: color ?? "inherit" }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: TG_HINT }}>{sub}</p>}
    </div>
  );
}

const customTooltipStyle = {
  background: "var(--tg-theme-secondary-bg-color)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  fontSize: 11,
  color: "var(--tg-theme-text-color)",
};

// ── Composant principal ───────────────────────────────────────────────────────

export default function StatsPage() {
  const { data: stats } = useGetDealStats({ query: { refetchInterval: 15000 } });
  const { data: deals }  = useGetDeals({}, { query: { refetchInterval: 15000 } });
  const { data: colls }  = useGetCollections();

  // Deals par heure (24 dernières heures)
  const dealsPerHour = (() => {
    const buckets: Record<string, number> = {};
    for (let i = 23; i >= 0; i--) {
      const h = format(subHours(new Date(), i), "HH:00");
      buckets[h] = 0;
    }
    deals?.forEach((d) => {
      try {
        const h = format(parseISO(d.detectedAt), "HH:00");
        if (h in buckets) buckets[h]++;
      } catch { /* ignore */ }
    });
    return Object.entries(buckets).map(([hour, count]) => ({ hour, count }));
  })();

  // Top 5 collections par nb de deals
  const collectionDeals = (() => {
    const cnt: Record<string, number> = {};
    deals?.forEach((d) => { cnt[d.collectionName] = (cnt[d.collectionName] ?? 0) + 1; });
    return Object.entries(cnt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name: name.replace("TON ", "").slice(0, 12), count }));
  })();

  // Répartition priorité
  const priorityData = (() => {
    const normal = deals?.filter(d => d.priority !== "high").length ?? 0;
    const high   = deals?.filter(d => d.priority === "high").length ?? 0;
    if (!normal && !high) return [];
    return [
      { name: "Deal",     value: normal, color: TG_GREEN  },
      { name: "Priorité", value: high,   color: TG_RED    },
    ];
  })();

  // Top floor collections
  const topCollections = colls
    ?.sort((a, b) => b.floorPrice - a.floorPrice)
    .slice(0, 5) ?? [];

  const normal = (deals?.length ?? 0) - (stats?.highPriorityDeals ?? 0);

  return (
    <div className="space-y-4">

      <p className="text-base font-bold px-1">Statistiques & Tendances</p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Deals totaux"   value={stats?.totalDeals ?? 0}        icon={Zap}         color={TG_BLUE}   trend="up" />
        <StatCard label="Haute priorité" value={stats?.highPriorityDeals ?? 0} icon={Activity}    color={TG_RED}    />
        <StatCard label="Réduction moy." value={`-${stats?.avgDiscount ?? 0}%`} icon={TrendingDown} color={TG_GREEN}  />
        <StatCard label="Collections"    value={stats?.totalCollections ?? 0}   icon={TrendingUp}  color={TG_ORANGE} />
      </div>

      {/* Graphique deals par heure */}
      <div className="tg-card p-3">
        <p className="text-xs font-bold mb-3" style={{ color: TG_HINT }}>DEALS / HEURE (24H)</p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={dealsPerHour} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={TG_BLUE} stopOpacity={0.4} />
                <stop offset="95%" stopColor={TG_BLUE} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "var(--tg-theme-hint-color)" }}
              interval={5} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "var(--tg-theme-hint-color)" }}
              tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={customTooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)" }}
              formatter={(v: number) => [`${v} deal${v > 1 ? "s" : ""}`, ""]} />
            <Area type="monotone" dataKey="count" stroke={TG_BLUE} strokeWidth={2}
              fill="url(#areaGrad)" dot={false} activeDot={{ r: 4, fill: TG_BLUE }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Top collections (deals) */}
      {collectionDeals.length > 0 && (
        <div className="tg-card p-3">
          <p className="text-xs font-bold mb-3" style={{ color: TG_HINT }}>TOP COLLECTIONS (NB DE DEALS)</p>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={collectionDeals} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
              barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--tg-theme-hint-color)" }}
                tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--tg-theme-hint-color)" }}
                tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={customTooltipStyle}
                formatter={(v: number) => [`${v} deal${v > 1 ? "s" : ""}`, ""]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {collectionDeals.map((_, i) => (
                  <Cell key={i} fill={[TG_BLUE, TG_GREEN, TG_ORANGE, "#bf5af2", "#5ac8fa"][i % 5]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Répartition priorités */}
      {priorityData.length > 0 && (
        <div className="tg-card p-3 flex items-center gap-4">
          <div>
            <p className="text-xs font-bold mb-2" style={{ color: TG_HINT }}>RÉPARTITION</p>
            <PieChart width={90} height={90}>
              <Pie data={priorityData} cx={40} cy={40} innerRadius={24} outerRadius={40}
                dataKey="value" paddingAngle={3} strokeWidth={0}>
                {priorityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: TG_GREEN }} />
                <span className="text-xs">Deal normal</span>
              </div>
              <span className="text-xs font-bold">{normal}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: TG_RED }} />
                <span className="text-xs">Haute priorité</span>
              </div>
              <span className="text-xs font-bold text-red-400">{stats?.highPriorityDeals ?? 0}</span>
            </div>
            <div className="tg-divider" />
            <p className="text-[10px]" style={{ color: TG_HINT }}>
              Taux priorité : <strong style={{ color: TG_RED }}>
                {stats?.totalDeals ? Math.round((stats.highPriorityDeals / stats.totalDeals) * 100) : 0}%
              </strong>
            </p>
          </div>
        </div>
      )}

      {/* Top floor prices */}
      {topCollections.length > 0 && (
        <div>
          <p className="text-xs font-bold px-1 mb-2" style={{ color: TG_HINT }}>TOP FLOOR PRICES</p>
          <div className="tg-section">
            {topCollections.map((c, i) => (
              <div key={c.slug} className="tg-row">
                <span className="text-base font-black w-5 text-center" style={{ color: TG_HINT }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  {c.volume24h > 0 && (
                    <p className="text-[10px]" style={{ color: TG_HINT }}>
                      Vol 24h: {c.volume24h.toFixed(0)} TON
                    </p>
                  )}
                </div>
                <p className="text-sm font-black" style={{ color: TG_BLUE }}>
                  💎 {c.floorPrice.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
