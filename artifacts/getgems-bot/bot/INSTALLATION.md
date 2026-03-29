# Guide d'Installation — GetGems NFT Sniper Bot

## Architecture du bot

```
bot.py
├── GraphQL client (aiohttp)        → Récupère données GetGems
├── Boucle sniper (asyncio)         → Scan toutes les 5–10s
├── Anti-spam (aiosqlite)           → Évite les doublons d'alertes
├── Bot Telegram (aiogram v3)       → Commandes + alertes instantanées
└── Serveur keep-alive (aiohttp.web) → Empêche Replit de s'endormir
```

---

## 1. Obtenir votre Token Telegram Bot

1. Ouvrez Telegram → cherchez **@BotFather**
2. Envoyez `/newbot` et suivez les instructions
3. Copiez le token (format : `1234567890:ABCdef...`)

## 2. Obtenir votre Chat ID

1. Cherchez **@userinfobot** sur Telegram → envoyez `/start`
2. Il affiche votre Chat ID (ex: `123456789`)

---

## 3. Installation locale (test rapide)

```bash
cd bot/

# Installer les dépendances
pip install -r requirements.txt

# Variables d'environnement
export TELEGRAM_BOT_TOKEN="votre_token"
export TELEGRAM_CHAT_ID="votre_chat_id"
export SCAN_INTERVAL=7          # secondes entre chaque scan
export DEAL_THRESHOLD=30        # % réduction → bon deal
export PRIORITY_THRESHOLD=50    # % réduction → alerte prioritaire

# Lancer
python bot.py
```

---

## 4. Déploiement 24/7 GRATUIT

### Option A — Railway.app ⭐ (le plus simple)

1. Créez un compte sur [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub repo**
3. Uploadez vos fichiers (bot.py, requirements.txt)
4. Dans l'onglet **Variables**, ajoutez :
   ```
   TELEGRAM_BOT_TOKEN = votre_token
   TELEGRAM_CHAT_ID   = votre_chat_id
   SCAN_INTERVAL      = 7
   DEAL_THRESHOLD     = 30
   PRIORITY_THRESHOLD = 50
   ```
5. Créez un fichier `Procfile` :
   ```
   worker: python bot.py
   ```
6. Déployez → c'est en ligne !

---

### Option B — Render.com

1. Compte sur [render.com](https://render.com)
2. **New → Background Worker**
3. **Build Command** : `pip install -r requirements.txt`
4. **Start Command** : `python bot.py`
5. Ajoutez les variables d'environnement
6. Déployez

---

### Option C — Replit (avec UptimeRobot)

> Le bot intègre un serveur keep-alive sur le port `$PORT`.
> Replit met en veille les projets gratuits après 5 min d'inactivité.
> UptimeRobot va pinger votre bot toutes les 5 minutes pour le garder éveillé.

**Étapes :**

1. Lancez le bot sur Replit (via le bouton Run)
2. Copiez l'URL publique de votre Repl (ex: `https://mon-bot.username.repl.co`)
3. Allez sur [uptimerobot.com](https://uptimerobot.com) → créez un compte gratuit
4. **Add New Monitor** :
   - Monitor Type : `HTTP(s)`
   - URL : `https://mon-bot.username.repl.co/health`
   - Monitoring Interval : `5 minutes`
5. Sauvegardez → votre bot reste actif 24/7 gratuitement !

---

### Option D — Oracle Cloud Free Tier (VPS illimité)

1. Compte sur [oracle.com/cloud/free](https://oracle.com/cloud/free)
2. Créez une VM **Always Free** (Ampere A1 : 4 CPU, 24GB RAM)
3. SSH dans votre VM et installez Python :
   ```bash
   sudo apt update && sudo apt install python3 python3-pip -y
   pip3 install -r requirements.txt
   ```
4. Créez un service systemd :
   ```bash
   sudo nano /etc/systemd/system/nft_sniper.service
   ```
   ```ini
   [Unit]
   Description=GetGems NFT Sniper Bot
   After=network.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/home/ubuntu/bot
   Environment="TELEGRAM_BOT_TOKEN=votre_token"
   Environment="TELEGRAM_CHAT_ID=votre_chat_id"
   ExecStart=/usr/bin/python3 bot.py
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl enable nft_sniper
   sudo systemctl start nft_sniper
   ```

---

## 5. Commandes Telegram

| Commande | Description |
|----------|-------------|
| `/start` | Message de bienvenue |
| `/deals` | 3 derniers deals détectés |
| `/watchlist` | Collections surveillées |
| `/stats` | Scans & alertes totaux |
| `/floor ton-gifts` | Floor price d'une collection |

---

## 6. Format des alertes Telegram

```
🚨 ALERTE PRIORITAIRE 🚨

🎁 TON Gift #4521
📂 Collection: TON Gifts

💎 Prix actuel: 5.2000 TON
📊 Floor price: 12.5000 TON
🔥 Réduction: -58.4%
⭐ Score: ████████░░ (78/100)

👉 Acheter maintenant

⏰ 14:23:45
```

---

## 7. Personnalisation

### Ajouter des collections

Dans `bot.py`, éditez la liste `COLLECTIONS` :

```python
COLLECTIONS = [
    "ton-gifts",
    "votre-collection-slug",  # ← ajoutez ici
]
```

Le slug se trouve dans l'URL GetGems :
`https://getgems.io/collection/TON-SLUG-ICI`

### Ajuster les seuils

```bash
export DEAL_THRESHOLD=20        # Plus sensible
export PRIORITY_THRESHOLD=40    # Priorité plus tôt
export SCAN_INTERVAL=5          # Plus rapide
```

---

## 8. Endpoint keep-alive (pour UptimeRobot)

Le bot expose un endpoint JSON sur `/health` :

```json
{
  "status": "OK",
  "scans": 247,
  "alerts": 8,
  "last_scan": "2024-01-15 14:23:45"
}
```

Pinguez `https://votre-url/health` avec UptimeRobot toutes les 5 minutes.

---

## 9. Dépannage

| Problème | Solution |
|----------|----------|
| Bot ne démarre pas | Vérifiez `TELEGRAM_BOT_TOKEN` |
| Aucune alerte | Baissez `DEAL_THRESHOLD` à 20% |
| Rate limited | Augmentez `SCAN_INTERVAL` à 10–15s |
| Bot s'endort (Replit) | Configurez UptimeRobot sur `/health` |
| Collection introuvable | Vérifiez le slug dans l'URL GetGems |
