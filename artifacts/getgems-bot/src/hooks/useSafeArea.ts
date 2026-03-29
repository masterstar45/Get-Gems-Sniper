/**
 * Hook qui lit les safe area insets depuis l'API Telegram WebApp.
 *
 * Telegram fournit TWO types of insets :
 *   safeAreaInset        = zone couverte par le système (status bar, home indicator)
 *   contentSafeAreaInset = zone couverte par l'UI Telegram (bouton "× Fermer", etc.)
 *
 * Le padding final en HAUT  = safeAreaInset.top    + contentSafeAreaInset.top
 * Le padding final en BAS   = safeAreaInset.bottom + contentSafeAreaInset.bottom
 *
 * On lit aussi les CSS variables Telegram (--tg-safe-area-inset-*)
 * et les env() natifs comme fallback.
 */

import { useState, useEffect } from "react";

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** Lit une CSS variable en px (ex. "44px" → 44) */
function readCssVar(name: string): number {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  } catch { return 0; }
}

function compute(): SafeInsets {
  try {
    const tg = (window as any).Telegram?.WebApp;

    // 1. JS API (le plus fiable)
    const sa  = tg?.safeAreaInset        ?? {};
    const csa = tg?.contentSafeAreaInset ?? {};

    const apiTop    = (sa.top    ?? 0) + (csa.top    ?? 0);
    const apiBottom = (sa.bottom ?? 0) + (csa.bottom ?? 0);
    const apiLeft   = (sa.left   ?? 0) + (csa.left   ?? 0);
    const apiRight  = (sa.right  ?? 0) + (csa.right  ?? 0);

    // 2. CSS variables posées par le SDK Telegram sur <html>
    const cssTop    = readCssVar("--tg-safe-area-inset-top")
                    + readCssVar("--tg-content-safe-area-inset-top");
    const cssBottom = readCssVar("--tg-safe-area-inset-bottom")
                    + readCssVar("--tg-content-safe-area-inset-bottom");
    const cssLeft   = readCssVar("--tg-safe-area-inset-left")
                    + readCssVar("--tg-content-safe-area-inset-left");
    const cssRight  = readCssVar("--tg-safe-area-inset-right")
                    + readCssVar("--tg-content-safe-area-inset-right");

    return {
      top:    Math.max(apiTop,    cssTop),
      bottom: Math.max(apiBottom, cssBottom),
      left:   Math.max(apiLeft,   cssLeft),
      right:  Math.max(apiRight,  cssRight),
    };
  } catch {
    return ZERO;
  }
}

function apply(insets: SafeInsets) {
  const root = document.documentElement;
  root.style.setProperty("--app-safe-top",    `${insets.top}px`);
  root.style.setProperty("--app-safe-bottom", `${insets.bottom}px`);
  root.style.setProperty("--app-safe-left",   `${insets.left}px`);
  root.style.setProperty("--app-safe-right",  `${insets.right}px`);
}

export function useSafeArea(): SafeInsets {
  const [insets, setInsets] = useState<SafeInsets>(ZERO);

  useEffect(() => {
    let mounted = true;

    function update() {
      if (!mounted) return;
      const v = compute();
      setInsets(v);
      apply(v);
    }

    // Lectures étalées dans le temps — le SDK Telegram initialise de façon asynchrone
    update();
    const t1 = setTimeout(update, 100);
    const t2 = setTimeout(update, 400);
    const t3 = setTimeout(update, 900);
    const t4 = setTimeout(update, 2000);

    // Écoute des événements Telegram
    try {
      const tg = (window as any).Telegram?.WebApp;
      tg?.onEvent?.("safeAreaChanged",        update);
      tg?.onEvent?.("contentSafeAreaChanged", update);
      tg?.onEvent?.("viewportChanged",        update);
    } catch { /* SDK trop ancien */ }

    return () => {
      mounted = false;
      clearTimeout(t1); clearTimeout(t2);
      clearTimeout(t3); clearTimeout(t4);
      try {
        const tg = (window as any).Telegram?.WebApp;
        tg?.offEvent?.("safeAreaChanged",        update);
        tg?.offEvent?.("contentSafeAreaChanged", update);
        tg?.offEvent?.("viewportChanged",        update);
      } catch { /* ignore */ }
    };
  }, []);

  return insets;
}
