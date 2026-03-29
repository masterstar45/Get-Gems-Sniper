import { useEffect, useState } from "react";
import { useGetBotStatus, useUpdateBotConfig, getGetBotStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TerminalSquare, Settings2, Save, CheckCircle, Key, ExternalLink, Zap, Activity, AlertCircle, SlidersHorizontal, Trophy } from "lucide-react";
import { haptic } from "@/hooks/useTelegram";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

type ScanDiag = {
  cycle: number;
  collections_total: number;
  collections_scanned: number;
  collections_with_listings: number;
  items_getgems: number;
  items_below_floor: number;
  items_qualifying: number;
  deals_found: number;
  tonapi_errors: number;
  tonapi_rate_limited: boolean;
  tonapi_key_set: boolean;
  deal_threshold: number;
  last_collection_scanned: string;
  sample_prices: number[];
  sample_floor: number;
  age_seconds: number | null;
  rate_limit_remaining_s: number;
};

function ScanDiagPanel() {
  const [diag, setDiag] = useState<ScanDiag | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/debug/scan`);
      if (r.ok) setDiag(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  if (loading) return null;
  if (!diag || diag.cycle === 0) return (
    <div className="px-4 py-3 rounded-xl text-xs" style={{ background: "rgba(255,255,255,0.05)", color: "var(--tg-theme-hint-color)" }}>
      ⏳ Diagnostic scan en attente du premier cycle…
    </div>
  );

  const hasIssue = diag.collections_with_listings === 0 || diag.tonapi_rate_limited;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${hasIssue ? "rgba(255,69,58,0.3)" : "rgba(255,255,255,0.08)"}` }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" style={{ color: hasIssue ? "#ff453a" : "#30d158" }} />
          <span className="text-xs font-bold">Diagnostic scan #{diag.cycle}</span>
          {diag.age_seconds !== null && (
            <span className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
              il y a {diag.age_seconds}s
            </span>
          )}
        </div>
        <button onClick={() => { refresh(); haptic.light?.(); }} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "var(--tg-theme-button-color)" }}>
          ↻
        </button>
      </div>

      <div className="grid grid-cols-3 gap-px" style={{ background: "rgba(255,255,255,0.06)" }}>
        {[
          { label: "Cols scannées", value: `${diag.collections_with_listings}/${diag.collections_scanned}`, ok: diag.collections_with_listings > 0 },
          { label: "Items GetGems", value: diag.items_getgems, ok: diag.items_getgems > 0 },
          { label: "Sous floor", value: diag.items_below_floor, ok: true },
          { label: "Qualifiés", value: diag.items_qualifying, ok: true, highlight: diag.items_qualifying > 0 },
          { label: "Deals trouvés", value: diag.deals_found, ok: true, highlight: diag.deals_found > 0 },
          { label: "Erreurs", value: diag.tonapi_errors, ok: diag.tonapi_errors === 0, warn: diag.tonapi_errors > 0 },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center py-2 px-1" style={{ background: "var(--tg-theme-section-bg-color, #1c1c1e)" }}>
            <span className="text-sm font-black" style={{ color: s.warn ? "#ff453a" : s.highlight ? "#30d158" : !s.ok ? "#ff453a" : "var(--tg-theme-text-color)" }}>
              {String(s.value)}
            </span>
            <span className="text-[9px] text-center mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {diag.tonapi_rate_limited && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: "#ff9f0a" }}>
          <AlertCircle className="w-3 h-3" />
          Rate limit TonAPI actif encore {diag.rate_limit_remaining_s}s
        </div>
      )}

      {diag.collections_with_listings === 0 && !diag.tonapi_rate_limited && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: "#ff453a" }}>
          <AlertCircle className="w-3 h-3" />
          0 collection avec listings — TonAPI ne retourne pas d'items GetGems
        </div>
      )}

      {diag.last_collection_scanned && diag.collections_with_listings > 0 && (
        <div className="px-3 py-2 text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
          Ex: <b style={{ color: "var(--tg-theme-text-color)" }}>{diag.last_collection_scanned}</b>
          {diag.sample_prices.length > 0 && (
            <> — floor {diag.sample_floor.toFixed(2)} TON | prix: {diag.sample_prices.slice(0, 5).map(p => p.toFixed(2)).join(", ")} TON</>
          )}
        </div>
      )}
    </div>
  );
}

type ScanConfig = {
  scanTypes: string[];
  maxPriceTon: number;
  topGiftsCount: number;
};

const SCAN_TYPE_OPTIONS = [
  { key: "tg_gifts",  label: "Telegram Gifts", emoji: "🎁", desc: "Top collections Gift TG" },
  { key: "fragment",  label: "Fragment",        emoji: "💫", desc: "Fragment.com (best effort)" },
  { key: "getgems",   label: "GetGems",         emoji: "💎", desc: "Collections via TonAPI" },
];

function ScanConfigPanel() {
  const [cfg, setCfg]       = useState<ScanConfig>({ scanTypes: ["getgems", "tg_gifts", "fragment"], maxPriceTon: 0, topGiftsCount: 20 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/scan/config`);
      if (r.ok) setCfg(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    haptic.medium?.();
    try {
      const r = await fetch(`${API_BASE}/api/scan/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (r.ok) {
        haptic.success?.();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        haptic.error?.();
      }
    } catch { haptic.error?.(); }
    setSaving(false);
  };

  const toggleType = (key: string) => {
    const types = cfg.scanTypes.includes(key)
      ? cfg.scanTypes.filter(t => t !== key)
      : [...cfg.scanTypes, key];
    // Toujours au moins un type actif
    if (types.length === 0) return;
    setCfg({ ...cfg, scanTypes: types });
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      {/* Types de scan */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <SlidersHorizontal className="w-4 h-4" style={{ color: "var(--tg-theme-hint-color)" }} />
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
            Types de scan
          </p>
        </div>
        <div className="tg-section">
          {SCAN_TYPE_OPTIONS.map((opt, i) => {
            const active = cfg.scanTypes.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleType(opt.key)}
                className={`tg-row w-full text-left ${i < SCAN_TYPE_OPTIONS.length - 1 ? "" : ""}`}
                style={{ opacity: active ? 1 : 0.45 }}
              >
                <div className="flex-1 flex items-center gap-3">
                  <span className="text-base">{opt.emoji}</span>
                  <div>
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>{opt.desc}</p>
                  </div>
                </div>
                {/* Toggle pill */}
                <div
                  className="relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0"
                  style={{
                    width: 40, height: 22,
                    background: active ? "var(--tg-theme-button-color, #0088cc)" : "rgba(120,120,128,0.36)",
                  }}
                >
                  <span
                    className="absolute top-0.5 rounded-full bg-white transition-transform duration-200"
                    style={{
                      width: 18, height: 18,
                      left: 2,
                      transform: active ? "translateX(18px)" : "translateX(0)",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Top Gifts Count */}
      {cfg.scanTypes.includes("tg_gifts") && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Trophy className="w-4 h-4" style={{ color: "var(--tg-theme-hint-color)" }} />
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
              Top Gifts
            </p>
          </div>
          <div className="tg-section">
            <div className="tg-row flex-col items-start gap-2">
              <div className="flex items-center justify-between w-full">
                <p className="text-sm font-medium">Top {cfg.topGiftsCount} collections</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,159,10,0.15)", color: "#ff9f0a" }}>
                  {cfg.topGiftsCount} cols
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                className="w-full"
                style={{ accentColor: "#ff9f0a" }}
                value={cfg.topGiftsCount}
                onChange={(e) => setCfg({ ...cfg, topGiftsCount: Number(e.target.value) })}
              />
              <div className="flex justify-between w-full text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
                <span>5 (rapide)</span><span>50 (équilibré)</span><span>100 (exhaustif)</span>
              </div>
              <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
                Scanne les {cfg.topGiftsCount} collections Gift les plus actives par volume de transactions
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Prix TON max */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Settings2 className="w-4 h-4" style={{ color: "var(--tg-theme-hint-color)" }} />
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
            Filtre prix
          </p>
        </div>
        <div className="tg-section">
          <div className="tg-row flex-col items-start gap-2">
            <div className="flex items-center justify-between w-full">
              <p className="text-sm font-medium">Prix TON maximum</p>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{
                background: cfg.maxPriceTon === 0 ? "rgba(48,209,88,0.15)" : "rgba(0,122,255,0.15)",
                color: cfg.maxPriceTon === 0 ? "#30d158" : "#0a84ff",
              }}>
                {cfg.maxPriceTon === 0 ? "Illimité" : `≤ ${cfg.maxPriceTon} TON`}
              </span>
            </div>
            <div className="flex items-center gap-2 w-full">
              <input
                type="number"
                min={0}
                step={10}
                className="flex-1"
                style={{
                  background: "var(--tg-theme-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  border: "none",
                  outline: "none",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 14,
                }}
                placeholder="0 = pas de limite"
                value={cfg.maxPriceTon === 0 ? "" : cfg.maxPriceTon}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setCfg({ ...cfg, maxPriceTon: isNaN(v) ? 0 : Math.max(0, v) });
                }}
              />
              {cfg.maxPriceTon > 0 && (
                <button
                  type="button"
                  onClick={() => setCfg({ ...cfg, maxPriceTon: 0 })}
                  className="text-xs px-3 py-2 rounded-xl"
                  style={{ background: "rgba(255,69,58,0.15)", color: "#ff453a" }}
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
              Ignore les deals dont le prix dépasse ce montant. 0 = aucune limite.
            </p>
          </div>
        </div>
      </div>

      {/* Bouton sauvegarder */}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="tg-btn flex items-center justify-center gap-2 w-full"
      >
        {saved ? (
          <><CheckCircle className="w-4 h-4" /> Paramètres appliqués !</>
        ) : saving ? "Application…" : (
          <><Save className="w-4 h-4" /> Appliquer les paramètres de scan</>
        )}
      </button>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className="w-4 h-4" style={{ color: "var(--tg-theme-hint-color)" }} />
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--tg-theme-hint-color)" }}>
          {title}
        </p>
      </div>
      <div className="tg-section">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="tg-row flex-col items-start gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useGetBotStatus();
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    telegramToken: "",
    chatId: "",
    scanInterval: 5,
    dealThreshold: 40,
    priorityThreshold: 70,
  });

  useEffect(() => {
    if (status) {
      setForm({
        telegramToken: status.telegramToken || "",
        chatId: status.chatId || "",
        scanInterval: status.scanInterval || 5,
        dealThreshold: status.dealThreshold || 40,
        priorityThreshold: status.priorityThreshold || 70,
      });
    }
  }, [status]);

  const updateMutation = useUpdateBotConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        haptic.success();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      },
      onError: () => haptic.error(),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    haptic.medium();
    updateMutation.mutate({
      data: {
        telegramToken: form.telegramToken,
        chatId: form.chatId,
        scanInterval: Number(form.scanInterval),
        dealThreshold: Number(form.dealThreshold),
        priorityThreshold: Number(form.priorityThreshold),
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm animate-pulse" style={{ color: "var(--tg-theme-hint-color)" }}>
          Chargement…
        </p>
      </div>
    );
  }

  const inputStyle = {
    width: "100%",
    background: "var(--tg-theme-bg-color)",
    color: "var(--tg-theme-text-color)",
    border: "none",
    outline: "none",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "14px",
  } satisfies React.CSSProperties;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Statut du bot */}
      <div
        className="flex items-center justify-between px-4 py-3 rounded-xl"
        style={{
          background: status?.isRunning ? "rgba(48,209,88,0.1)" : "rgba(255,69,58,0.1)",
          border: `1px solid ${status?.isRunning ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.25)"}`,
        }}
      >
        <div>
          <p className="text-sm font-bold">Moteur de scan</p>
          <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
            Cycle : {status?.lastActivity ? new Date(status.lastActivity).toLocaleTimeString("fr") : "jamais"}
          </p>
        </div>
        <span
          className="text-xs font-bold px-3 py-1.5 rounded-full"
          style={{
            background: status?.isRunning ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)",
            color: status?.isRunning ? "#30d158" : "#ff453a",
          }}
        >
          {status?.isRunning ? "🟢 ACTIF" : "🔴 ARRÊTÉ"}
        </span>
      </div>

      {/* Stats rapides */}
      <div className="grid grid-cols-2 gap-2">
        <div className="stat-card text-center">
          <p className="text-2xl font-black">{status?.totalScans?.toLocaleString("fr") ?? 0}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>Scans effectués</p>
        </div>
        <div className="stat-card text-center">
          <p className="text-2xl font-black" style={{ color: "var(--tg-theme-button-color)" }}>
            {status?.totalAlertsSet?.toLocaleString("fr") ?? 0}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--tg-theme-hint-color)" }}>Alertes envoyées</p>
        </div>
      </div>

      {/* Diagnostic scan */}
      <ScanDiagPanel />

      {/* Bloc TonAPI Key */}
      {(status as any)?.tonapiKeySet === false && (
        <div
          className="px-4 py-3 rounded-xl space-y-2"
          style={{
            background: "rgba(255,159,10,0.10)",
            border: "1px solid rgba(255,159,10,0.30)",
          }}
        >
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4" style={{ color: "#ff9f0a" }} />
            <p className="text-sm font-bold" style={{ color: "#ff9f0a" }}>Clé TonAPI manquante</p>
          </div>
          <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
            Sans clé, TonAPI limite à ~1 req/s depuis Railway — les scans peuvent être bloqués.
          </p>
          <p className="text-xs" style={{ color: "var(--tg-theme-text-color)" }}>
            Ajoutez <code className="px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.1)", fontFamily: "monospace" }}>TONAPI_KEY</code> dans les variables Railway :
          </p>
          <a
            href="https://tonconsole.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: "var(--tg-theme-button-color)" }}
          >
            <ExternalLink className="w-3 h-3" />
            Obtenir une clé gratuite sur tonconsole.com
          </a>
        </div>
      )}
      {(status as any)?.tonapiKeySet === true && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{
            background: "rgba(48,209,88,0.08)",
            border: "1px solid rgba(48,209,88,0.25)",
          }}
        >
          <Zap className="w-4 h-4" style={{ color: "#30d158" }} />
          <div>
            <p className="text-sm font-bold" style={{ color: "#30d158" }}>TonAPI Key active</p>
            <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
              Rate limits augmentés — scans optimaux · {(status as any)?.collectionsKnown ?? 0} collections connues
            </p>
          </div>
        </div>
      )}

      {/* Paramètres de scan (types + prix max + top gifts) */}
      <ScanConfigPanel />

      {/* Telegram */}
      <Section title="Intégration Telegram" icon={TerminalSquare}>
        <FieldRow label="Token du bot" hint="Obtenu via @BotFather">
          <input
            type="password"
            style={inputStyle}
            placeholder="1234567890:ABC…"
            value={form.telegramToken}
            onChange={(e) => setForm({ ...form, telegramToken: e.target.value })}
          />
        </FieldRow>
        <FieldRow label="Chat ID cible" hint="ID du canal ou groupe pour les alertes">
          <input
            style={inputStyle}
            placeholder="-100123456789"
            value={form.chatId}
            onChange={(e) => setForm({ ...form, chatId: e.target.value })}
          />
        </FieldRow>
      </Section>

      {/* Scanner */}
      <Section title="Paramètres du scanner" icon={Settings2}>
        <FieldRow label={`Intervalle de scan : ${form.scanInterval}s`}>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            className="w-full accent-blue-500"
            value={form.scanInterval}
            onChange={(e) => setForm({ ...form, scanInterval: Number(e.target.value) })}
          />
          <div className="flex justify-between w-full text-[10px]" style={{ color: "var(--tg-theme-hint-color)" }}>
            <span>1s</span><span>30s</span><span>60s</span>
          </div>
        </FieldRow>

        <FieldRow label={`Seuil deal normal : -${form.dealThreshold}%`}>
          <input
            type="range"
            min={5}
            max={95}
            step={5}
            className="w-full accent-blue-500"
            value={form.dealThreshold}
            onChange={(e) => setForm({ ...form, dealThreshold: Number(e.target.value) })}
          />
        </FieldRow>

        <FieldRow label={`Seuil haute priorité 🔥 : -${form.priorityThreshold}%`}>
          <input
            type="range"
            min={5}
            max={95}
            step={5}
            className="w-full accent-red-500"
            value={form.priorityThreshold}
            onChange={(e) => setForm({ ...form, priorityThreshold: Number(e.target.value) })}
          />
        </FieldRow>
      </Section>

      <button
        type="submit"
        className="tg-btn flex items-center justify-center gap-2"
        disabled={updateMutation.isPending}
      >
        {saved ? (
          <>
            <CheckCircle className="w-4 h-4" /> Sauvegardé !
          </>
        ) : updateMutation.isPending ? (
          "Sauvegarde…"
        ) : (
          <>
            <Save className="w-4 h-4" /> Sauvegarder la configuration
          </>
        )}
      </button>

    </form>
  );
}
