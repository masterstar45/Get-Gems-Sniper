/**
 * Hook pour utiliser l'API Telegram Mini App (WebApp SDK)
 * Doc : https://core.telegram.org/bots/webapps
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  isExpanded: boolean;
  colorScheme: "light" | "dark";
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback: (ok: boolean) => void) => void;
  version: string;
  platform: string;
}

// Instance globale (null si hors Telegram)
export const tg: TelegramWebApp | null =
  typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;

// Indique si on est dans Telegram
export const isInTelegram = (): boolean => !!tg && !!tg.initData;

// Retourne le user Telegram connecté (si disponible)
export const getTelegramUser = () => tg?.initDataUnsafe?.user ?? null;

// Schéma de couleurs actuel
export const getColorScheme = (): "light" | "dark" => tg?.colorScheme ?? "dark";

// Retour haptique (ne fait rien hors Telegram)
export const haptic = {
  light:   () => tg?.HapticFeedback.impactOccurred("light"),
  medium:  () => tg?.HapticFeedback.impactOccurred("medium"),
  success: () => tg?.HapticFeedback.notificationOccurred("success"),
  error:   () => tg?.HapticFeedback.notificationOccurred("error"),
  select:  () => tg?.HapticFeedback.selectionChanged(),
};

// Ouvrir un lien (dans Telegram ou navigateur standard)
export const openLink = (url: string) => {
  if (tg) {
    tg.openLink(url);
  } else {
    window.open(url, "_blank");
  }
};
