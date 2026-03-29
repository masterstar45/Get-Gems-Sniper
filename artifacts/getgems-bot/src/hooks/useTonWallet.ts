import { useEffect, useState, useCallback } from "react";
import TonConnect, { toUserFriendlyAddress } from "@tonconnect/sdk";
import { tg } from "./useTelegram";

const MANIFEST_URL =
  "https://get-gems-sniper-production.up.railway.app/tonconnect-manifest.json";

let _connector: TonConnect | null = null;

function getConnector(): TonConnect {
  if (!_connector) {
    _connector = new TonConnect({ manifestUrl: MANIFEST_URL });
  }
  return _connector;
}

interface WalletState {
  address: string | null;
  shortAddress: string | null;
  connected: boolean;
}

export function useTonWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    shortAddress: null,
    connected: false,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const connector = getConnector();

    connector.restoreConnection().catch(() => {});

    const unsubscribe = connector.onStatusChange((wallet) => {
      if (wallet?.account?.address) {
        const friendly = toUserFriendlyAddress(wallet.account.address);
        setState({
          address: friendly,
          shortAddress: friendly.slice(0, 4) + "…" + friendly.slice(-4),
          connected: true,
        });
      } else {
        setState({ address: null, shortAddress: null, connected: false });
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const connect = useCallback(async () => {
    const connector = getConnector();
    setLoading(true);
    try {
      const wallets = await connector.getWallets();

      // Priorité : Telegram Wallet (t.me/wallet) — natif dans Telegram
      const remote = wallets.filter((w): w is typeof w & { universalLink: string; bridgeUrl: string } =>
        "universalLink" in w && "bridgeUrl" in w
      );

      const telegramWallet = remote.find(
        (w) => w.universalLink.includes("t.me/wallet") || w.name.toLowerCase().includes("telegram")
      );

      const target = telegramWallet ?? remote[0];
      if (!target) {
        setLoading(false);
        return;
      }

      const url = connector.connect({
        universalLink: target.universalLink,
        bridgeUrl: target.bridgeUrl,
      });

      // Dans Telegram : ouvre via l'API native; sinon fenêtre standard
      if (tg) {
        try {
          tg.openTelegramLink(url);
        } catch {
          tg.openLink(url);
        }
      } else {
        window.open(url, "_blank");
      }
    } catch {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    getConnector().disconnect();
    setState({ address: null, shortAddress: null, connected: false });
  }, []);

  return { ...state, loading, connect, disconnect };
}
