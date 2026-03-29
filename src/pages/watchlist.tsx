import { useGetWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Target, Zap, RefreshCw } from "lucide-react";
import { haptic, tg } from "@/hooks/useTelegram";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

function slugDisplay(slug: string): string {
  if (slug.startsWith("0:") && slug.length > 20) {
    return `${slug.slice(0, 10)}…${slug.slice(-6)}`;
  }
  return slug;
}

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const { data: watchlist, isLoading, refetch } = useGetWatchlist({
    query: { refetchInterval: 15000 },
  });

  const removeMutation = useRemoveFromWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        haptic.success();
      },
    },
  });

  const confirmRemove = (id: number, name: string) => {
    haptic.medium();
    if (tg) {
      tg.showConfirm(`Retirer "${name}" de la watchlist ?`, (ok) => {
        if (ok) removeMutation.mutate({ id });
      });
    } else {
      if (confirm(`Retirer "${name}" ?`)) removeMutation.mutate({ id });
    }
  };

  return (
    <div className="space-y-3">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Watchlist</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
            Mise à jour automatique par le bot
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); refetch(); }}
          className="p-2 rounded-xl"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}
          title="Rafraîchir"
        >
          <RefreshCw className="w-4 h-4" style={{ color: "var(--tg-theme-button-color)" }} />
        </button>
      </div>

      {/* ── Bannière info ── */}
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: "rgba(var(--tg-theme-button-color-rgb, 0,122,255), 0.1)", border: "1px solid rgba(var(--tg-theme-button-color-rgb, 0,122,255), 0.2)" }}>
        <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--tg-theme-button-color)" }} />
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--tg-theme-text-color)" }}>
          Les collections GetGems sont <strong>ajoutées automatiquement</strong> dès que le scanner détecte des listings actifs via TonAPI.
        </p>
      </div>

      {/* ── Liste ── */}
      <div className="tg-section">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tg-row animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 w-28 bg-white/10 rounded" />
                <div className="h-3 w-20 bg-white/10 rounded" />
              </div>
            </div>
          ))
        ) : !watchlist?.length ? (
          <div className="tg-row justify-center py-12 flex-col gap-3 text-center">
            <span className="text-5xl">🔔</span>
            <p className="text-sm font-semibold">En attente du premier scan</p>
            <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
              Dès que le bot détecte des collections GetGems avec des listings actifs, elles apparaissent ici automatiquement.
            </p>
          </div>
        ) : (
          watchlist.map((item) => (
            <div key={item.id} className="tg-row">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{item.collectionName}</p>
                  <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(48,209,88,0.15)", color: "#30d158" }}>
                    AUTO
                  </span>
                </div>
                <p className="text-xs font-mono mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
                  {slugDisplay(item.collectionSlug)}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-xs font-bold" style={{ color: "#ffd60a" }}>
                    <Target className="w-3 h-3" /> ≥ {item.alertThreshold}% OFF
                  </span>
                  <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                    · {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
              <button
                onClick={() => confirmRemove(item.id!, item.collectionName!)}
                disabled={removeMutation.isPending}
                className="p-2 rounded-xl"
                style={{ color: "var(--tg-theme-destructive-text-color, #ff453a)" }}
                title="Retirer de la watchlist"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {watchlist && watchlist.length > 0 && (
        <p className="text-center text-[10px] pb-1" style={{ color: "var(--tg-theme-hint-color)" }}>
          {watchlist.length} collection{watchlist.length > 1 ? "s" : ""} surveillée{watchlist.length > 1 ? "s" : ""} · Scan automatique via TonAPI
        </p>
      )}
    </div>
  );
}
