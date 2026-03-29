import { useState } from "react";
import { ExternalLink, Flame, Star, TrendingUp, Layers, RefreshCw } from "lucide-react";
import { haptic } from "@/hooks/useTelegram";
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function useFeatured() {
  return useQuery({
    queryKey: ["featured"],
    queryFn: () => fetch(`${API_BASE}/api/featured`).then((r) => r.json()),
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: () => fetch(`${API_BASE}/api/news?limit=20`).then((r) => r.json()),
    staleTime: 60000,
  });
}

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  milestone: { label: "Record",   color: "#ffd60a", bg: "rgba(255,214,10,0.12)" },
  launch:    { label: "Lancement",color: "#30d158", bg: "rgba(48,209,88,0.12)"  },
  feature:   { label: "Feature",  color: "#64d2ff", bg: "rgba(100,210,255,0.12)"},
  rumor:     { label: "Rumeur",   color: "#ff9f0a", bg: "rgba(255,159,10,0.12)" },
  ecosystem: { label: "Éco",      color: "#bf5af2", bg: "rgba(191,90,242,0.12)" },
};

export default function MarketPage() {
  const { data: featured, isLoading: featLoading, refetch: refetchFeatured } = useFeatured();
  const { data: news, isLoading: newsLoading, refetch: refetchNews } = useNews();
  const [tab, setTab] = useState<"market" | "news">("market");

  return (
    <div className="space-y-3">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Actus & Marché</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
            TON Gifts · GetGems · Ecosystem
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); refetchFeatured(); refetchNews(); }}
          className="p-2 rounded-xl"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}
        >
          <RefreshCw className="w-4 h-4" style={{ color: "var(--tg-theme-button-color)" }} />
        </button>
      </div>

      {/* ── Onglets internes ── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
        {([["market", "🎯 Produits", Layers], ["news", "📰 Actus", TrendingUp]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { haptic.select(); setTab(key as "market" | "news"); }}
            className="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all"
            style={
              tab === key
                ? { background: "var(--tg-theme-button-color)", color: "var(--tg-theme-button-text-color)" }
                : { color: "var(--tg-theme-hint-color)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* ══ VUE PRODUITS ══════════════════════════════════════════════════════ */}
      {tab === "market" && (
        <div className="space-y-3">

          {/* Spotlight curatées */}
          <div>
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--tg-theme-hint-color)" }}>
              ⭐ Collections à suivre
            </p>
            <div className="space-y-1 tg-section">
              {(featured?.spotlight ?? []).map((col: any, i: number) => (
                <a
                  key={i}
                  href={col.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => haptic.light()}
                  className="tg-row"
                >
                  <span className="text-2xl w-8 flex-shrink-0">{col.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold">{col.name}</p>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: col.category === "official" ? "rgba(100,210,255,0.15)" :
                                      col.category === "celebrity" ? "rgba(255,159,10,0.15)" :
                                      col.category === "premium" ? "rgba(191,90,242,0.15)" :
                                      "rgba(48,209,88,0.15)",
                          color: col.category === "official" ? "#64d2ff" :
                                 col.category === "celebrity" ? "#ff9f0a" :
                                 col.category === "premium" ? "#bf5af2" :
                                 "#30d158",
                        }}>
                        {col.category === "official" ? "Officiel" :
                         col.category === "celebrity" ? "Célébrité" :
                         col.category === "premium" ? "Premium" : "OG"}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
                      {col.description}
                    </p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--tg-theme-hint-color)" }} />
                </a>
              ))}
            </div>
          </div>

          {/* Top actives (live du scanner) */}
          <div>
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider mb-2"
              style={{ color: "var(--tg-theme-hint-color)" }}>
              🔥 Top collections actives (live)
            </p>
            {featLoading ? (
              <div className="tg-section">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="tg-row animate-pulse">
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-28 bg-white/10 rounded" />
                      <div className="h-3 w-20 bg-white/10 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !featured?.live?.length ? (
              <div className="tg-section">
                <div className="tg-row justify-center py-8 flex-col gap-2">
                  <Flame className="w-8 h-8 opacity-30" />
                  <p className="text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>
                    En attente du premier scan TonAPI…
                  </p>
                </div>
              </div>
            ) : (
              <div className="tg-section">
                {featured.live.map((col: any, i: number) => (
                  <a
                    key={col.slug}
                    href={col.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => haptic.light()}
                    className="tg-row"
                  >
                    <span className="text-xs font-bold w-5 flex-shrink-0"
                      style={{ color: i < 3 ? "#ffd60a" : "var(--tg-theme-hint-color)" }}>
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{col.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs font-bold" style={{ color: "#30d158" }}>
                          ◎ {col.floorTon} TON
                        </span>
                        <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                          {col.listings} listings
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--tg-theme-hint-color)" }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ VUE ACTUALITÉS ═══════════════════════════════════════════════════ */}
      {tab === "news" && (
        <div className="space-y-2">
          {newsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tg-section animate-pulse">
                <div className="tg-row flex-col items-start gap-2">
                  <div className="h-3 w-48 bg-white/10 rounded" />
                  <div className="h-3 w-36 bg-white/10 rounded" />
                </div>
              </div>
            ))
          ) : !news?.length ? (
            <div className="tg-section">
              <div className="tg-row justify-center py-10 flex-col gap-2">
                <p className="text-2xl">📰</p>
                <p className="text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>Aucune actualité</p>
              </div>
            </div>
          ) : (
            news.map((item: any) => {
              const cat = CATEGORY_META[item.category] ?? CATEGORY_META.ecosystem;
              const date = item.publishedAt
                ? new Date(item.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
                : null;
              return (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => haptic.light()}
                  className="block rounded-2xl p-4 transition-opacity active:opacity-70"
                  style={{ background: "var(--tg-theme-secondary-bg-color)" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: cat.bg, color: cat.color }}>
                      {cat.label}
                    </span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }} />
                  </div>
                  <p className="text-sm font-semibold leading-snug">{item.title}</p>
                  {item.summary && (
                    <p className="text-xs mt-1.5 leading-relaxed line-clamp-3"
                      style={{ color: "var(--tg-theme-hint-color)" }}>
                      {item.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {item.source && (
                      <span className="text-[10px] font-semibold" style={{ color: "var(--tg-theme-button-color)" }}>
                        {item.source}
                      </span>
                    )}
                    {date && (
                      <span className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
                        · {date}
                      </span>
                    )}
                  </div>
                </a>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
