import { useEffect, useState } from "react";
import { useGetBotStatus, useUpdateBotConfig, getGetBotStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TerminalSquare, Settings2, Save, CheckCircle } from "lucide-react";
import { haptic } from "@/hooks/useTelegram";

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
