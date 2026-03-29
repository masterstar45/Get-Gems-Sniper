import { useEffect, useRef, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/hooks/useTelegram";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

interface DealBrief {
  id: number;
  nftName: string;
  collectionName: string;
  discountPercent: number;
  score: number;
  priority: string;
  detectedAt: string;
}

// Persiste la dernière deal vue entre sessions
const LS_KEY = "getgems_last_deal_at";

export function useDealsNotifier() {
  const { toast } = useToast();
  const [newCount, setNewCount] = useState(0);

  // On stocke le dernier timestamp vu (initialisé au démarrage de session)
  const lastAtRef = useRef<string>(
    localStorage.getItem(LS_KEY) ?? new Date().toISOString()
  );

  // Initialise à maintenant si jamais vu (première ouverture)
  useEffect(() => {
    if (!localStorage.getItem(LS_KEY)) {
      localStorage.setItem(LS_KEY, lastAtRef.current);
    }
  }, []);

  const checkNewDeals = useCallback(async () => {
    try {
      const url = `${API_BASE}/api/deals?limit=20`;
      const res = await fetch(url);
      if (!res.ok) return;
      const deals: DealBrief[] = await res.json();
      if (!deals.length) return;

      const lastAt = lastAtRef.current;
      const newDeals = deals.filter((d) => d.detectedAt > lastAt);
      if (!newDeals.length) return;

      // Mise à jour du dernier timestamp
      const newest = newDeals[0].detectedAt;
      lastAtRef.current = newest;
      localStorage.setItem(LS_KEY, newest);

      setNewCount((c) => c + newDeals.length);

      // Vibration haptic
      try { haptic.success?.(); } catch {}

      // Toast pour le meilleur deal
      const best = newDeals[0];
      const priority = best.priority;
      const emoji =
        priority === "extreme" ? "🔴" : priority === "high" ? "🟠" : "🟢";

      toast({
        title: `${emoji} Nouveau deal — ${best.nftName}`,
        description: `${best.collectionName} · -${best.discountPercent}% · score ${best.score}/100`,
        duration: 6000,
      });

      // Toasts supplémentaires si plusieurs deals d'un coup (max 2 de plus)
      for (const deal of newDeals.slice(1, 3)) {
        const e =
          deal.priority === "extreme"
            ? "🔴"
            : deal.priority === "high"
            ? "🟠"
            : "🟢";
        toast({
          title: `${e} ${deal.nftName}`,
          description: `${deal.collectionName} · -${deal.discountPercent}%`,
          duration: 5000,
        });
      }
    } catch {
      // Silencieux
    }
  }, [toast]);

  useEffect(() => {
    // Premier check après 5s (laisser le temps au bot de scanner)
    const first = setTimeout(checkNewDeals, 5000);
    // Puis toutes les 15s
    const interval = setInterval(checkNewDeals, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [checkNewDeals]);

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString();
    lastAtRef.current = now;
    localStorage.setItem(LS_KEY, now);
    setNewCount(0);
  }, []);

  return { newCount, markAllSeen };
}
