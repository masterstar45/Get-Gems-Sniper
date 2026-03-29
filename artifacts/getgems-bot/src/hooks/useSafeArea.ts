/**
 * Hook qui lit les safe area insets depuis l'API Telegram WebApp
 * et les applique comme variables CSS sur <html> pour les utiliser partout.
 *
 * Telegram fournit :
 *   - window.Telegram.WebApp.safeAreaInset        (plein écran)
 *   - window.Telegram.WebApp.contentSafeAreaInset (zone de contenu)
 * Ces valeurs sont aussi disponibles via CSS :
 *   --tg-safe-area-inset-{top,bottom,left,right}
 *   --tg-content-safe-area-inset-{top,bottom,left,right}
 */

import { useState, useEffect } from "react";

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

function readFromTgApi(): Insets {
  try {
    const tgApp = (window as any).Telegram?.WebApp;
    if (!tgApp) return ZERO;

    const sa  = tgApp.safeAreaInset        ?? {};
    const csa = tgApp.contentSafeAreaInset ?? {};

    return {
      top:    Math.max(sa.top    ?? 0, csa.top    ?? 0),
      bottom: Math.max(sa.bottom ?? 0, csa.bottom ?? 0),
      left:   Math.max(sa.left   ?? 0, csa.left   ?? 0),
      right:  Math.max(sa.right  ?? 0, csa.right  ?? 0),
    };
  } catch {
    return ZERO;
  }
}

function applyCssVars(insets: Insets) {
  const root = document.documentElement;
  root.style.setProperty("--app-safe-top",    `${insets.top}px`);
  root.style.setProperty("--app-safe-bottom", `${insets.bottom}px`);
  root.style.setProperty("--app-safe-left",   `${insets.left}px`);
  root.style.setProperty("--app-safe-right",  `${insets.right}px`);
}

export function useSafeArea(): Insets {
  const [insets, setInsets] = useState<Insets>(ZERO);

  useEffect(() => {
    function update() {
      const values = readFromTgApi();
      setInsets(values);
      applyCssVars(values);
    }

    // Lecture initiale (parfois disponible immédiatement)
    update();

    // Lecture retardée pour laisser le temps au SDK d'initialiser
    const t1 = setTimeout(update, 100);
    const t2 = setTimeout(update, 500);

    // Écoute des événements Telegram de changement de safe area
    try {
      const tgApp = (window as any).Telegram?.WebApp;
      tgApp?.onEvent?.("safeAreaChanged",        update);
      tgApp?.onEvent?.("contentSafeAreaChanged", update);
      tgApp?.onEvent?.("viewportChanged",        update);
    } catch { /* SDK version trop ancienne */ }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      try {
        const tgApp = (window as any).Telegram?.WebApp;
        tgApp?.offEvent?.("safeAreaChanged",        update);
        tgApp?.offEvent?.("contentSafeAreaChanged", update);
        tgApp?.offEvent?.("viewportChanged",        update);
      } catch { /* ignore */ }
    };
  }, []);

  return insets;
}
