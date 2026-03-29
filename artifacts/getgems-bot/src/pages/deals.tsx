import { useGetDeals, useGetDealStats } from "@workspace/api-client-react";
import type { Deal } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { openLink, haptic } from "@/hooks/useTelegram";
import { Flame, Target, TrendingDown, Layers } from "lucide-react";

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70 ? "score-high" : score >= 40 ? "score-mid" : "score-low";
  return (
    <span className={`${cls} rounded-lg text-xs font-bold px-2 py-0.5 whitespace-nowrap`}>
      {score}/100
    </span>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  const isHigh = deal.priority === "high";

  const handleBuy = () => {
    haptic.medium();
    openLink(deal.link);
  };

  return (
    <div className="tg-row items-start">
      {/* Image ou icône */}
      <div className="w-12 h-12 rounded-xl flex-shrink-0 overflow-hidden bg-white/5 flex items-center justify-center">
        {deal.imageUrl ? (
          <img src={deal.imageUrl} alt={deal.nftName} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl">🎁</span>
        )}
      </div>

      {/* Infos */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {isHigh ? (
            <span className="badge-high">🔥 PRIORITAIRE</span>
          ) : (
            <span className="badge-normal">✅ SNIPE</span>
          )}
          <ScoreBadge score={deal.score} />
        </div>
        <p className="text-sm font-semibold truncate" style={{ color: "var(--tg-theme-text-color)" }}>
          {deal.nftName}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--tg-theme-hint-color)" }}>
          {deal.collectionName}
        </p>

        {/* Prix */}
        <div className="flex items-center gap-3 mt-2">
          <div>
            <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>Prix</p>
            <p className="text-sm font-bold" style={{ color: "var(--tg-theme-button-color)" }}>
              💎 {deal.currentPrice.toFixed(2)} TON
            </p>
          </div>
          <div>
            <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>Floor</p>
            <p className="text-sm font-medium text-white/70">
              {deal.floorPrice.toFixed(2)} TON
            </p>
          </div>
          <div className="ml-auto">
            <span className="text-lg font-black" style={{ color: "#30d158" }}>
              -{deal.discountPercent}%
            </span>
          </div>
        </div>

        {/* Bouton acheter */}
        <button
          onClick={handleBuy}
          className="tg-btn mt-3 text-sm py-2.5"
        >
          Acheter sur GetGems ↗
        </button>

        <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--tg-theme-hint-color)" }}>
          Détecté {formatDistanceToNow(new Date(deal.detectedAt), { addSuffix: true, locale: fr })}
        </p>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const { data: stats, isLoading: statsLoading } = useGetDealStats({ query: { refetchInterval: 10000 } });
  const { data: deals, isLoading: dealsLoading } = useGetDeals({}, { query: { refetchInterval: 8000 } });

  return (
    <div className="space-y-3">

      {/* Stats en 4 cases */}
      <div className="grid grid-cols-2 gap-2">
        <div className="stat-card">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3.5 h-3.5" style={{ color: "var(--tg-theme-button-color)" }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>Total Deals</p>
          </div>
          <p className="text-2xl font-black">{statsLoading ? "…" : stats?.totalDeals ?? 0}</p>
        </div>

        <div className="stat-card" style={{ background: "rgba(255,69,58,0.1)", borderColor: "rgba(255,69,58,0.2)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Flame className="w-3.5 h-3.5 text-red-400" />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>Prioritaires</p>
          </div>
          <p className="text-2xl font-black text-red-400">{statsLoading ? "…" : stats?.highPriorityDeals ?? 0}</p>
        </div>

        <div className="stat-card" style={{ background: "rgba(48,209,88,0.1)", borderColor: "rgba(48,209,88,0.2)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5" style={{ color: "#30d158" }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>Moy. Réduction</p>
          </div>
          <p className="text-2xl font-black" style={{ color: "#30d158" }}>-{statsLoading ? "…" : stats?.avgDiscount ?? 0}%</p>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5" style={{ color: "var(--tg-theme-hint-color)" }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>Collections</p>
          </div>
          <p className="text-2xl font-black">{statsLoading ? "…" : stats?.totalCollections ?? 0}</p>
        </div>
      </div>

      {/* Titre */}
      <div className="flex items-center justify-between px-1 pt-1">
        <p className="text-base font-bold">Dernières Opportunités</p>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(48,209,88,0.15)", color: "#30d158" }}>
          ⟳ Auto-refresh
        </span>
      </div>

      {/* Liste des deals */}
      <div className="tg-section">
        {dealsLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tg-row animate-pulse">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-white/10 rounded" />
                <div className="h-3 w-36 bg-white/10 rounded" />
              </div>
            </div>
          ))
        ) : !deals?.length ? (
          <div className="tg-row justify-center py-10 flex-col gap-3">
            <span className="text-4xl">🔍</span>
            <p className="text-sm font-semibold">Aucun deal pour l'instant</p>
            <p className="text-xs text-center" style={{ color: "var(--tg-theme-hint-color)" }}>
              Le bot scanne en continu. Les deals apparaîtront ici dès détection.
            </p>
          </div>
        ) : (
          deals.map((deal) => <DealRow key={deal.id} deal={deal} />)
        )}
      </div>

    </div>
  );
}
