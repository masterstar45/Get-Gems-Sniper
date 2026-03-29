import { useGetCollections } from "@workspace/api-client-react";
import { openLink, haptic } from "@/hooks/useTelegram";
import { Image as ImageIcon, ExternalLink } from "lucide-react";

export default function CollectionsPage() {
  const { data: collections, isLoading } = useGetCollections();

  return (
    <div className="space-y-3">

      <div className="px-1">
        <p className="text-base font-bold">Collections surveillées</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
          Données de marché en temps réel
        </p>
      </div>

      <div className="tg-section">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="tg-row animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 bg-white/10 rounded" />
                <div className="h-3 w-16 bg-white/10 rounded" />
              </div>
            </div>
          ))
        ) : !collections?.length ? (
          <div className="tg-row justify-center py-10 flex-col gap-3">
            <span className="text-4xl">📭</span>
            <p className="text-sm font-semibold">Aucune collection</p>
            <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
              Ajoutez des collections dans la Watchlist
            </p>
          </div>
        ) : (
          collections.map((c) => (
            <div key={c.id} className="tg-row">
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden bg-white/5 flex items-center justify-center">
                <ImageIcon className="w-4 h-4" style={{ color: "var(--tg-theme-hint-color)" }} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-xs truncate" style={{ color: "var(--tg-theme-hint-color)" }}>
                  @{c.slug}
                </p>
              </div>

              {/* Price + link */}
              <div className="flex flex-col items-end gap-1">
                <p className="text-sm font-bold" style={{ color: "var(--tg-theme-button-color)" }}>
                  💎 {c.floorPrice.toFixed(2)}
                </p>
                {c.volume24h ? (
                  <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
                    Vol: {c.volume24h.toFixed(0)} TON
                  </p>
                ) : null}
                <button
                  onClick={() => {
                    haptic.light();
                    openLink(`https://getgems.io/collection/${c.slug}`);
                  }}
                  className="flex items-center gap-1 text-[10px] font-semibold"
                  style={{ color: "var(--tg-theme-link-color)" }}
                >
                  GetGems <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
