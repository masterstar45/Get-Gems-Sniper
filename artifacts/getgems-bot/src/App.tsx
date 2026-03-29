import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Layout } from "@/components/layout/Layout";
import DealsPage from "@/pages/deals";
import StatsPage from "@/pages/stats";
import TrendsPage from "@/pages/trends";
import MarketPage from "@/pages/market";
import CollectionsPage from "@/pages/collections";
import WatchlistPage from "@/pages/watchlist";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import { tg } from "@/hooks/useTelegram";
import { setBaseUrl } from "@workspace/api-client-react";

// Si VITE_API_BASE_URL est défini (ex: Railway URL), l'API s'y connecte
// Sinon, les appels API vont vers le serveur courant (Replit)
if (import.meta.env.VITE_API_BASE_URL) {
  setBaseUrl(import.meta.env.VITE_API_BASE_URL as string);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={DealsPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/trends" component={TrendsPage} />
        <Route path="/market" component={MarketPage} />
        <Route path="/collections" component={CollectionsPage} />
        <Route path="/watchlist" component={WatchlistPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

// Couleurs dark mode (synchronisées avec index.css fallbacks)
const DARK_BG = "#1c1c1e";

function App() {
  useEffect(() => {
    // Schéma de couleurs : dark si dans Telegram dark mode OU hors Telegram
    // tg.initData est vide hors Telegram → on force le dark par défaut
    const isRealTelegram = Boolean(tg?.initData);
    const scheme = isRealTelegram ? (tg!.colorScheme ?? "dark") : "dark";
    const isDark = scheme === "dark";

    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);

    // Applique les couleurs Telegram sur le chrome natif (header + bottom bar)
    const bgColor = isDark ? DARK_BG : "#f2f2f7";

    if (tg) {
      tg.ready();
      tg.expand();

      // Plein écran (Bot API 8.0+) — supprime le header Telegram
      try { (tg as any).requestFullscreen(); } catch {}

      // Synchronise header et bottom bar avec le fond de l'app
      try { tg.setHeaderColor(bgColor as `#${string}`); } catch {}
      try { (tg as any).setBottomBarColor(bgColor); } catch {}
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
