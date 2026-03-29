import { useState, useMemo } from "react";
import {
  useGetWatchlist,
  useRemoveFromWatchlist,
  useAddToWatchlist,
  useGetCollections,
  getGetWatchlistQueryKey,
} from "@workspace/api-client-react";
import type { WatchlistItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Target, Zap, RefreshCw, Search, X, Plus, Edit2, Check } from "lucide-react";
import { haptic, tg } from "@/hooks/useTelegram";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

const TG_BLUE   = "var(--tg-theme-button-color)";
const TG_GREEN  = "#30d158";
const TG_RED    = "#ff453a";
const TG_YELLOW = "#ffd60a";
const TG_HINT   = "var(--tg-theme-hint-color)";

function slugDisplay(slug: string): string {
  if (slug.startsWith("0:") && slug.length > 20) {
    return `${slug.slice(0, 10)}…${slug.slice(-6)}`;
  }
  return slug;
}

// ── Per-item threshold editor ─────────────────────────────────────────────────

function ThresholdEditor({
  item,
  onSave,
  onCancel,
}: {
  item: WatchlistItem;
  onSave: (newThreshold: number) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(item.alertThreshold);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="mt-2 px-1 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>
            Seuil d'alerte
          </span>
          <span className="text-[10px] font-black" style={{ color: TG_YELLOW }}>≥ {val}% OFF</span>
        </div>
        <input
          type="range" min={5} max={80} step={5}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          className="w-full accent-yellow-400 h-1.5"
        />
        <div className="flex justify-between text-[9px]" style={{ color: TG_HINT }}>
          <span>5%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave(val)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
            style={{ background: `${TG_GREEN}20`, color: TG_GREEN, border: `1px solid ${TG_GREEN}40` }}
          >
            <Check className="w-3 h-3" /> Sauvegarder
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
            style={{ background: "rgba(255,255,255,0.06)", color: TG_HINT }}
          >
            <X className="w-3 h-3" /> Annuler
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Watchlist Row ─────────────────────────────────────────────────────────────

function WatchlistRow({
  item,
  onRemove,
  onUpdateThreshold,
  isPendingRemove,
}: {
  item: WatchlistItem;
  onRemove: () => void;
  onUpdateThreshold: (newThreshold: number, item: WatchlistItem) => void;
  isPendingRemove: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="py-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">{item.collectionName}</p>
            <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(48,209,88,0.15)", color: TG_GREEN }}>
              AUTO
            </span>
          </div>
          <p className="text-xs font-mono mt-0.5" style={{ color: TG_HINT }}>
            {slugDisplay(item.collectionSlug)}
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            <button
              className="flex items-center gap-1 text-xs font-bold transition-all active:scale-95"
              style={{ color: TG_YELLOW }}
              onClick={() => { haptic.select(); setEditing(!editing); }}
              title="Modifier le seuil"
            >
              <Target className="w-3 h-3" /> ≥ {item.alertThreshold}% OFF
              <Edit2 className="w-2.5 h-2.5 ml-0.5" />
            </button>
            <span className="text-xs" style={{ color: TG_HINT }}>
              · {formatDistanceToNow(new Date(item.addedAt), { addSuffix: true, locale: fr })}
            </span>
          </div>
        </div>
        <button
          onClick={onRemove}
          disabled={isPendingRemove}
          className="p-2 rounded-xl flex-shrink-0"
          style={{ color: "var(--tg-theme-destructive-text-color, #ff453a)" }}
          title="Retirer de la watchlist"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Threshold editor expandable */}
      <AnimatePresence>
        {editing && (
          <ThresholdEditor
            item={item}
            onSave={(newThreshold) => {
              setEditing(false);
              onUpdateThreshold(newThreshold, item);
            }}
            onCancel={() => setEditing(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Add Collection Panel ──────────────────────────────────────────────────────

function AddCollectionPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: collections } = useGetCollections();
  const addMutation = useAddToWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        haptic.success();
        onClose();
      },
    },
  });

  const [search, setSearch] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [customName, setCustomName] = useState("");
  const [threshold, setThreshold] = useState(20);
  const [mode, setMode] = useState<"search" | "manual">("search");

  const suggestions = useMemo(() => {
    if (!search || !collections) return [];
    const q = search.toLowerCase();
    return collections
      .filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q))
      .slice(0, 5);
  }, [search, collections]);

  const handleAdd = (slug: string, name: string) => {
    if (!slug || !name) return;
    haptic.medium();
    addMutation.mutate({ data: { collectionSlug: slug, collectionName: name, alertThreshold: threshold } });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden"
    >
      <div className="rounded-2xl p-4 space-y-3 mt-1"
        style={{ background: "var(--tg-theme-secondary-bg-color)", border: `1px solid ${TG_BLUE}30` }}>

        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Ajouter une collection</p>
          <button onClick={onClose}>
            <X className="w-4 h-4" style={{ color: TG_HINT }} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          {(["search", "manual"] as const).map((m) => (
            <button key={m}
              onClick={() => setMode(m)}
              className="flex-1 py-1.5 text-[10px] font-bold transition-all"
              style={{
                background: mode === m ? TG_BLUE : "transparent",
                color: mode === m ? "#fff" : TG_HINT,
              }}
            >
              {m === "search" ? "🔍 Depuis watchlist" : "✏️ Slug manuel"}
            </button>
          ))}
        </div>

        {mode === "search" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TG_HINT }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Chercher dans les collections scannées..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:opacity-50"
                style={{ color: "var(--tg-theme-text-color)" }}
                autoFocus
              />
              {search && <button onClick={() => setSearch("")}><X className="w-3 h-3" style={{ color: TG_HINT }} /></button>}
            </div>

            {suggestions.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleAdd(c.slug, c.name)}
                    disabled={addMutation.isPending}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/5 transition-colors border-b last:border-0"
                    style={{ borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div>
                      <p className="text-xs font-semibold">{c.name}</p>
                      <p className="text-[9px]" style={{ color: TG_HINT }}>@{c.slug}</p>
                    </div>
                    <span className="text-xs font-bold" style={{ color: TG_BLUE }}>
                      💎 {c.floorPrice.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {search && suggestions.length === 0 && (
              <p className="text-[10px] text-center py-2" style={{ color: TG_HINT }}>
                Aucune collection correspondante
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value.trim())}
              placeholder="Slug (ex: notcoin)"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--tg-theme-text-color)" }}
            />
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Nom affiché"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--tg-theme-text-color)" }}
            />
          </div>
        )}

        {/* Threshold slider (always visible) */}
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TG_HINT }}>
              Seuil d'alerte
            </span>
            <span className="text-[10px] font-black" style={{ color: TG_YELLOW }}>
              ≥ {threshold}% OFF
            </span>
          </div>
          <input
            type="range" min={5} max={80} step={5}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-yellow-400 h-1.5"
          />
          <div className="flex justify-between text-[9px]" style={{ color: TG_HINT }}>
            <span>5%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span>
          </div>
        </div>

        {/* Add button for manual mode */}
        {mode === "manual" && (
          <button
            onClick={() => handleAdd(customSlug, customName || customSlug)}
            disabled={!customSlug || addMutation.isPending}
            className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: TG_BLUE, color: "#fff" }}
          >
            {addMutation.isPending ? "Ajout…" : "➕ Ajouter à la Watchlist"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const { data: watchlist, isLoading, refetch } = useGetWatchlist({
    query: { refetchInterval: 15000 },
  });

  const [searchWl, setSearchWl]     = useState("");
  const [showAdd, setShowAdd]       = useState(false);

  const removeMutation = useRemoveFromWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        haptic.success();
      },
    },
  });

  const addMutation = useAddToWatchlist({
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

  // Update threshold: POST new entry first, THEN delete old — safe order prevents data loss
  const handleUpdateThreshold = (newThreshold: number, item: WatchlistItem) => {
    haptic.medium();
    // 1. Add new entry with updated threshold
    addMutation.mutate(
      {
        data: {
          collectionSlug: item.collectionSlug,
          collectionName: item.collectionName,
          alertThreshold: newThreshold,
        },
      },
      {
        onSuccess: () => {
          // 2. Only remove old entry once new one is confirmed created
          removeMutation.mutate({ id: item.id! });
        },
      }
    );
  };

  const filtered = useMemo(() => {
    if (!watchlist) return [];
    if (!searchWl) return watchlist;
    const q = searchWl.toLowerCase();
    return watchlist.filter(
      (w) =>
        w.collectionName.toLowerCase().includes(q) ||
        w.collectionSlug.toLowerCase().includes(q)
    );
  }, [watchlist, searchWl]);

  return (
    <div className="space-y-3">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-bold">Watchlist</p>
          <p className="text-xs mt-0.5" style={{ color: TG_HINT }}>
            {watchlist?.length ?? 0} collection{(watchlist?.length ?? 0) > 1 ? "s" : ""} surveillée{(watchlist?.length ?? 0) > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { haptic.select(); setShowAdd(!showAdd); }}
            className="flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all active:scale-95"
            style={{
              background: showAdd ? `${TG_BLUE}30` : `${TG_BLUE}18`,
              color: TG_BLUE,
              border: `1px solid ${TG_BLUE}40`,
            }}
          >
            <Plus className="w-3 h-3" /> Ajouter
          </button>
          <button
            onClick={() => { haptic.light(); refetch(); }}
            className="p-2 rounded-xl"
            style={{ background: "var(--tg-theme-secondary-bg-color)" }}
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" style={{ color: TG_BLUE }} />
          </button>
        </div>
      </div>

      {/* ── Add Collection Panel ── */}
      <AnimatePresence>
        {showAdd && <AddCollectionPanel onClose={() => setShowAdd(false)} />}
      </AnimatePresence>

      {/* ── Bannière info ── */}
      <div className="rounded-2xl px-4 py-3 flex items-start gap-3"
        style={{ background: "rgba(0,122,255,0.1)", border: "1px solid rgba(0,122,255,0.2)" }}>
        <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: TG_BLUE }} />
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--tg-theme-text-color)" }}>
          Les collections GetGems sont <strong>ajoutées automatiquement</strong> dès que le scanner détecte des listings actifs. Vous pouvez aussi en ajouter manuellement ou modifier le seuil d'alerte.
        </p>
      </div>

      {/* ── Search bar ── */}
      {(watchlist?.length ?? 0) > 3 && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: "var(--tg-theme-secondary-bg-color)" }}>
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: TG_HINT }} />
          <input
            value={searchWl}
            onChange={(e) => setSearchWl(e.target.value)}
            placeholder="Rechercher dans la watchlist..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
            style={{ color: "var(--tg-theme-text-color)" }}
          />
          {searchWl && (
            <button onClick={() => setSearchWl("")}>
              <X className="w-3.5 h-3.5" style={{ color: TG_HINT }} />
            </button>
          )}
        </div>
      )}

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
        ) : !filtered.length ? (
          <div className="tg-row justify-center py-12 flex-col gap-3 text-center">
            <span className="text-5xl">{searchWl ? "🔎" : "🔔"}</span>
            <p className="text-sm font-semibold">
              {searchWl ? "Aucune collection trouvée" : "En attente du premier scan"}
            </p>
            <p className="text-xs" style={{ color: TG_HINT }}>
              {searchWl
                ? "Essayez un autre terme."
                : "Dès que le bot détecte des collections GetGems avec des listings actifs, elles apparaissent ici automatiquement."}
            </p>
            {!searchWl && (
              <button
                onClick={() => { haptic.select(); setShowAdd(true); }}
                className="text-xs px-4 py-1.5 rounded-full font-semibold mt-1 transition-all active:scale-95"
                style={{ background: TG_BLUE, color: "#fff" }}
              >
                Ajouter manuellement
              </button>
            )}
          </div>
        ) : (
          filtered.map((item) => (
            <WatchlistRow
              key={item.id}
              item={item}
              onRemove={() => confirmRemove(item.id!, item.collectionName!)}
              onUpdateThreshold={handleUpdateThreshold}
              isPendingRemove={removeMutation.isPending}
            />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-center text-[10px] pb-1" style={{ color: TG_HINT }}>
          {filtered.length} collection{filtered.length > 1 ? "s" : ""} · Scan auto via TonAPI
        </p>
      )}
    </div>
  );
}
