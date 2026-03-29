import { useState } from "react";
import { useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Target, X } from "lucide-react";
import { haptic, tg } from "@/hooks/useTelegram";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

function AddModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ slug: "", name: "", threshold: "40" });

  const addMutation = useAddToWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        haptic.success();
        onClose();
      },
      onError: () => haptic.error(),
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.slug || !form.name) return;
    addMutation.mutate({
      data: { collectionSlug: form.slug, collectionName: form.name, alertThreshold: Number(form.threshold) },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        className="w-full rounded-t-2xl p-5 pb-8 space-y-4"
        style={{ background: "var(--tg-theme-secondary-bg-color)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-base font-bold">Ajouter une collection</p>
          <button onClick={onClose} className="p-1" style={{ color: "var(--tg-theme-hint-color)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
              Slug GetGems
            </label>
            <input
              className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm border-none outline-none"
              style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)" }}
              placeholder="ex: ton-punks"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              required
              autoFocus
            />
            <p className="text-[10px] mt-1" style={{ color: "var(--tg-theme-hint-color)" }}>
              Partie après getgems.io/collection/…
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
              Nom affiché
            </label>
            <input
              className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm border-none outline-none"
              style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)" }}
              placeholder="TON Punks"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
              Seuil d'alerte (% de réduction)
            </label>
            <input
              type="number"
              min="1"
              max="99"
              className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm border-none outline-none"
              style={{ background: "var(--tg-theme-bg-color)", color: "var(--tg-theme-text-color)" }}
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              required
            />
          </div>

          <button
            type="submit"
            className="tg-btn mt-2"
            disabled={addMutation.isPending}
          >
            {addMutation.isPending ? "Ajout en cours…" : "Ajouter"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const { data: watchlist, isLoading } = useGetWatchlist();
  const [showAdd, setShowAdd] = useState(false);

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

      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Watchlist</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>
            Collections surveillées par le bot
          </p>
        </div>
        <button
          onClick={() => { haptic.light(); setShowAdd(true); }}
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl"
          style={{ background: "var(--tg-theme-button-color)", color: "var(--tg-theme-button-text-color)" }}
        >
          <Plus className="w-4 h-4" /> Ajouter
        </button>
      </div>

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
          <div className="tg-row justify-center py-12 flex-col gap-3">
            <span className="text-5xl">🔔</span>
            <p className="text-sm font-semibold">Watchlist vide</p>
            <p className="text-xs text-center" style={{ color: "var(--tg-theme-hint-color)" }}>
              Ajoutez des collections pour que le bot commence à les surveiller
            </p>
            <button
              onClick={() => { haptic.light(); setShowAdd(true); }}
              className="tg-btn mt-2 py-2.5 text-sm"
              style={{ width: "auto", padding: "10px 24px" }}
            >
              Ajouter une collection
            </button>
          </div>
        ) : (
          watchlist.map((item) => (
            <div key={item.id} className="tg-row">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{item.collectionName}</p>
                <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                  @{item.collectionSlug}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-xs font-bold" style={{ color: "#ffd60a" }}>
                    <Target className="w-3 h-3" /> &gt; {item.alertThreshold}% OFF
                  </span>
                  <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                    · ajouté {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
              <button
                onClick={() => confirmRemove(item.id, item.collectionName)}
                disabled={removeMutation.isPending}
                className="p-2 rounded-xl"
                style={{ color: "var(--tg-theme-destructive-text-color, #ff453a)" }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
