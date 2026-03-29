import { useState } from "react";
import { ExternalLink, RefreshCw, TrendingUp, Zap, Star, Layers, Rss } from "lucide-react";
import { tg, haptic } from "@/hooks/useTelegram";
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const TG_HINT  = "var(--tg-theme-hint-color)";
const TG_BLUE  = "var(--tg-theme-button-color)";
const TG_BG2   = "var(--tg-theme-secondary-bg-color)";

// ── Catégories ───────────────────────────────────────────────────────────────

const CATS: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  all:       { label: "Tout",       emoji: "🌐", color: "#ffffff",  bg: "rgba(255,255,255,0.12)" },
  milestone: { label: "Record",     emoji: "🏆", color: "#ffd60a",  bg: "rgba(255,214,10,0.15)"  },
  launch:    { label: "Lancement",  emoji: "🚀", color: "#30d158",  bg: "rgba(48,209,88,0.15)"   },
  feature:   { label: "Nouveauté", emoji: "⚡", color: "#64d2ff",  bg: "rgba(100,210,255,0.15)" },
  rumor:     { label: "Rumeur",     emoji: "🔮", color: "#ff9f0a",  bg: "rgba(255,159,10,0.15)"  },
  ecosystem: { label: "Écosystème", emoji: "🌱", color: "#bf5af2",  bg: "rgba(191,90,242,0.15)"  },
};

const SOURCE_COLORS: Record<string, string> = {
  "TON Foundation": "#0098ea",
  "Telegram":       "#0098ea",
  "GetGems":        "#30d158",
  "CoinTelegraph FR": "#f7931a",
  "Journal du Coin": "#e84393",
  "Cryptoast":       "#9b59b6",
};

// ── Hooks ────────────────────────────────────────────────────────────────────

function useNews(category: string) {
  const params = category && category !== "all" ? `&category=${category}` : "";
  return useQuery({
    queryKey: ["news", category],
    queryFn: () => fetch(`${API_BASE}/api/news?limit=30${params}`).then(r => r.json()),
    staleTime: 60000,
    refetchInterval: 120000,
  });
}

function useFeatured() {
  return useQuery({
    queryKey: ["featured"],
    queryFn: () => fetch(`${API_BASE}/api/featured`).then(r => r.json()),
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

// ── Composants ───────────────────────────────────────────────────────────────

function CategoryPill({
  cat, active, onClick,
}: { cat: string; active: boolean; onClick: () => void }) {
  const meta = CATS[cat];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all active:scale-95"
      style={active
        ? { background: meta.color, color: "#000" }
        : { background: "rgba(255,255,255,0.07)", color: TG_HINT }}
    >
      <span>{meta.emoji}</span>
      {meta.label}
    </button>
  );
}

function NewsCard({ item }: { item: any }) {
  const cat  = CATS[item.category] ?? CATS.ecosystem;
  const src  = item.source ?? "";
  const srcColor = SOURCE_COLORS[src] ?? TG_BLUE;

  const date = item.publishedAt
    ? (() => {
        const d = new Date(item.publishedAt);
        const now = new Date();
        const diff = (now.getTime() - d.getTime()) / 1000;
        if (diff < 3600)   return `Il y a ${Math.round(diff / 60)} min`;
        if (diff < 86400)  return `Il y a ${Math.round(diff / 3600)} h`;
        if (diff < 604800) return `Il y a ${Math.round(diff / 86400)} j`;
        return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      })()
    : null;

  const handleClick = () => {
    haptic.light();
    if (tg) {
      try { tg.openLink(item.url); } catch { window.open(item.url, "_blank"); }
    } else {
      window.open(item.url, "_blank");
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left rounded-2xl p-4 transition-opacity active:opacity-70 space-y-2"
      style={{ background: TG_BG2 }}
    >
      {/* Badges ligne 1 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: cat.bg, color: cat.color }}>
            {cat.emoji} {cat.label}
          </span>
          {src && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: `${srcColor}18`, color: srcColor }}>
              {src}
            </span>
          )}
        </div>
        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
      </div>

      {/* Titre */}
      <p className="text-sm font-bold leading-snug">
        {item.title}
      </p>

      {/* Résumé */}
      {item.summary && (
        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: TG_HINT }}>
          {item.summary}
        </p>
      )}

      {/* Date */}
      {date && (
        <p className="text-[10px]" style={{ color: TG_HINT }}>{date}</p>
      )}
    </button>
  );
}

function NewsCardSkeleton() {
  return (
    <div className="rounded-2xl p-4 space-y-2 animate-pulse" style={{ background: TG_BG2 }}>
      <div className="flex gap-2">
        <div className="h-4 w-16 rounded-full bg-white/10" />
        <div className="h-4 w-20 rounded-full bg-white/10" />
      </div>
      <div className="h-4 w-full rounded bg-white/10" />
      <div className="h-4 w-4/5 rounded bg-white/10" />
      <div className="h-3 w-2/3 rounded bg-white/08" />
    </div>
  );
}

function CollectionRow({ col, rank }: { col: any; rank: number }) {
  const handleClick = () => {
    haptic.light();
    if (tg) {
      try { tg.openLink(col.url); } catch { window.open(col.url, "_blank"); }
    } else {
      window.open(col.url, "_blank");
    }
  };

  return (
    <button onClick={handleClick} className="tg-row w-full text-left active:opacity-70">
      <span className="text-xs font-bold w-5 flex-shrink-0"
        style={{ color: rank <= 3 ? "#ffd60a" : TG_HINT }}>
        #{rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{col.name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs font-bold" style={{ color: "#30d158" }}>
            ◎ {col.floorTon} TON
          </span>
          <span className="text-xs" style={{ color: TG_HINT }}>
            {col.listings} listings
          </span>
        </div>
      </div>
      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-30" />
    </button>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function MarketPage() {
  const [activeCat, setActiveCat] = useState("all");
  const { data: news, isLoading: newsLoading, refetch: refetchNews } = useNews(activeCat);
  const { data: featured, refetch: refetchFeatured } = useFeatured();

  const handleRefresh = () => {
    haptic.medium();
    refetchNews();
    refetchFeatured();
  };

  const hasLive = featured?.live?.length > 0;

  return (
    <div className="space-y-4">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Actualités TON</p>
          <p className="text-xs mt-0.5" style={{ color: TG_HINT }}>
            NFT · Gifts · Écosystème Telegram
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 rounded-xl active:scale-95 transition-transform"
          style={{ background: TG_BG2 }}
        >
          <RefreshCw className="w-4 h-4" style={{ color: TG_BLUE }} />
        </button>
      </div>

      {/* ── Filtres catégories ── */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1"
        style={{ scrollbarWidth: "none" }}>
        {Object.keys(CATS).map(cat => (
          <CategoryPill
            key={cat}
            cat={cat}
            active={activeCat === cat}
            onClick={() => { haptic.select(); setActiveCat(cat); }}
          />
        ))}
      </div>

      {/* ── Collections actives (live) ── */}
      {activeCat === "all" && hasLive && (
        <div>
          <p className="px-1 text-[10px] font-bold uppercase tracking-wider mb-2"
            style={{ color: TG_HINT }}>
            🔥 Collections actives — live
          </p>
          <div className="tg-section">
            {featured.live.slice(0, 5).map((col: any, i: number) => (
              <CollectionRow key={col.slug} col={col} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* ── Fil d'actualités ── */}
      <div>
        {activeCat === "all" && (
          <p className="px-1 text-[10px] font-bold uppercase tracking-wider mb-2"
            style={{ color: TG_HINT }}>
            <Rss className="w-3 h-3 inline mr-1" />
            Dernières actualités
          </p>
        )}

        {newsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <NewsCardSkeleton key={i} />)}
          </div>
        ) : !news?.length ? (
          <div className="rounded-2xl p-10 flex flex-col items-center gap-3"
            style={{ background: TG_BG2 }}>
            <span className="text-4xl opacity-30">📰</span>
            <p className="text-sm font-semibold" style={{ color: TG_HINT }}>
              Aucune actualité dans cette catégorie
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {news.map((item: any) => <NewsCard key={item.id} item={item} />)}
          </div>
        )}
      </div>

      {/* ── Collections spotlight (bas de page) ── */}
      {activeCat === "all" && featured?.spotlight?.length > 0 && (
        <div>
          <p className="px-1 text-[10px] font-bold uppercase tracking-wider mb-2"
            style={{ color: TG_HINT }}>
            ⭐ Collections à surveiller
          </p>
          <div className="tg-section">
            {featured.spotlight.map((col: any, i: number) => {
              const catColor =
                col.category === "official"  ? "#64d2ff" :
                col.category === "celebrity" ? "#ff9f0a" :
                col.category === "premium"   ? "#bf5af2" : "#30d158";
              const catLabel =
                col.category === "official"  ? "Officiel" :
                col.category === "celebrity" ? "Célébrité" :
                col.category === "premium"   ? "Premium" : "OG";

              const handleClick = () => {
                haptic.light();
                if (tg) {
                  try { tg.openLink(col.url); } catch { window.open(col.url, "_blank"); }
                } else { window.open(col.url, "_blank"); }
              };

              return (
                <button key={i} onClick={handleClick} className="tg-row w-full text-left active:opacity-70">
                  <span className="text-2xl w-8 flex-shrink-0">{col.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{col.name}</p>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `${catColor}18`, color: catColor }}>
                        {catLabel}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: TG_HINT }}>
                      {col.description}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-30" />
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
