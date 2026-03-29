import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Layout } from "@/components/layout/Layout";
import DealsPage from "@/pages/deals";
import StatsPage from "@/pages/stats";
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
        <Route path="/collections" component={CollectionsPage} />
        <Route path="/watchlist" component={WatchlistPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    if (tg) {
      // Signale à Telegram que l'app est prête
      tg.ready();
      // Ouvre l'app en plein écran
      tg.expand();
    }

    // Applique le schéma de couleurs Telegram (dark/light auto)
    const scheme = tg?.colorScheme ?? "dark";
    document.documentElement.classList.toggle("dark", scheme === "dark");
    document.documentElement.classList.toggle("light", scheme === "light");
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
