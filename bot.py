#!/usr/bin/env python3
"""
GetGems NFT Sniper Bot — v2.0 Amélioré
=========================================
Stack  : aiogram 3.x | aiohttp | aiosqlite | aiohttp.web
API    : GraphQL public GetGems (https://api.getgems.io/graphql)
Scoring: réduction + volume + tendance floor + stabilité
Priority: normal (30-50%) | high (50-70%) | extreme (70%+)
"""

import asyncio
import logging
import os
import random
import time
import psutil
from datetime import datetime, timezone

import aiohttp
import aiohttp.web
import aiosqlite
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.enums import ParseMode
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from fake_useragent import UserAgent

# ─── CONFIG ──────────────────────────────────────────────────────────────────

TELEGRAM_TOKEN     = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")
SCAN_INTERVAL      = int(os.getenv("SCAN_INTERVAL", "60"))         # secondes entre scans
DEAL_THRESHOLD     = float(os.getenv("DEAL_THRESHOLD", "15"))      # % réduction → deal normal
PRIORITY_THRESHOLD = float(os.getenv("PRIORITY_THRESHOLD", "40"))  # % réduction → deal hot
EXTREME_THRESHOLD  = float(os.getenv("EXTREME_THRESHOLD", "60"))   # % réduction → deal extrême
DB_PATH            = os.getenv("DB_PATH", "sniper.db")
KEEPALIVE_PORT     = int(os.getenv("PORT", "8080"))
MINI_APP_URL       = os.getenv("MINI_APP_URL", "")

# Clé TonAPI optionnelle (https://tonconsole.com → rate limits bien supérieurs)
TONAPI_KEY = os.getenv("TONAPI_KEY", "")

# Nombre max de collections scannées par cycle (évite le rate-limit TonAPI)
MAX_COLLECTIONS_PER_CYCLE = int(os.getenv("MAX_COLLECTIONS_PER_CYCLE", "30"))

# Timestamp de démarrage (pour uptime)
_BOT_START_TIME = time.time()

# TonAPI — source officielle recommandée par GetGems pour l'accès programmatique
TONAPI_BASE = "https://tonapi.io/v2"

# Adresses de collections GetGems connues (seed manuel, complétées automatiquement)
# Format: adresses TON 0:xxx ou EQxxx
KNOWN_COLLECTION_ADDRESSES: list[str] = [
    addr.strip()
    for addr in os.getenv("EXTRA_COLLECTIONS", "").split(",")
    if addr.strip()
]

# Cache des collections découvertes dynamiquement (mis à jour toutes les 30 min)
_discovered_collections: list[dict] = []
_last_discovery: float = 0.0

# ─── LOGGING ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("sniper")

# ─── USER-AGENT ROTATIF ──────────────────────────────────────────────────────

try:
    ua = UserAgent()
    def get_ua() -> str:
        return ua.random
except Exception:
    _UAS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ]
    def get_ua() -> str:
        return random.choice(_UAS)

# ─── BASE DE DONNÉES (aiosqlite) ──────────────────────────────────────────────

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS alerted_nfts (
                nft_address TEXT PRIMARY KEY,
                nft_name    TEXT,
                collection  TEXT,
                price_ton   REAL,
                floor_ton   REAL,
                discount    REAL,
                score       INTEGER DEFAULT 0,
                priority    TEXT DEFAULT 'normal',
                alerted_at  TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS floor_cache (
                slug        TEXT PRIMARY KEY,
                name        TEXT,
                floor_ton   REAL,
                volume_24h  REAL,
                item_count  INTEGER,
                updated_at  TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS floor_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                slug        TEXT NOT NULL,
                floor_ton   REAL NOT NULL,
                recorded_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_floor_history_slug ON floor_history(slug, recorded_at);

            CREATE TABLE IF NOT EXISTS stats (
                id           INTEGER PRIMARY KEY DEFAULT 1,
                total_scans  INTEGER DEFAULT 0,
                total_alerts INTEGER DEFAULT 0,
                last_scan    TEXT
            );

            CREATE TABLE IF NOT EXISTS watchlist (
                collection_slug  TEXT UNIQUE,
                collection_name  TEXT,
                alert_threshold  INTEGER DEFAULT 40,
                added_at         TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS news (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL,
                url          TEXT UNIQUE,
                summary      TEXT,
                source       TEXT,
                category     TEXT DEFAULT 'ecosystem',
                published_at TEXT,
                fetched_at   TEXT DEFAULT (datetime('now'))
            );
        """)
        # Migrations sans-casse (colonnes ajoutées si absentes)
        for col_def in [
            ("alerted_nfts", "score",    "INTEGER DEFAULT 0"),
            ("alerted_nfts", "priority", "TEXT DEFAULT 'normal'"),
        ]:
            try:
                await db.execute(f"ALTER TABLE {col_def[0]} ADD COLUMN {col_def[1]} {col_def[2]}")
            except Exception:
                pass  # Colonne existe déjà

        await db.execute("INSERT OR IGNORE INTO stats (id) VALUES (1)")
        await db.commit()
    log.info("✅ Base de données initialisée (v2)")

async def is_already_alerted(address: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM alerted_nfts WHERE nft_address = ?", (address,)
        ) as cursor:
            return await cursor.fetchone() is not None

async def mark_as_alerted(address: str, name: str, collection: str,
                           price: float, floor: float, discount: float,
                           score: int = 0, priority: str = "normal"):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR IGNORE INTO alerted_nfts
            (nft_address, nft_name, collection, price_ton, floor_ton, discount, score, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (address, name, collection, price, floor, discount, score, priority))
        await db.execute(
            "UPDATE stats SET total_alerts = total_alerts + 1 WHERE id = 1"
        )
        await db.commit()

async def save_floor_history(slug: str, floor_ton: float):
    """Enregistre le floor price actuel (max 1 entrée par heure par collection)."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Vérifie si on a déjà une entrée dans la dernière heure
        async with db.execute("""
            SELECT 1 FROM floor_history
            WHERE slug = ? AND recorded_at > datetime('now', '-1 hour')
        """, (slug,)) as cur:
            if await cur.fetchone():
                return
        await db.execute(
            "INSERT INTO floor_history (slug, floor_ton) VALUES (?, ?)",
            (slug, floor_ton)
        )
        # Garde seulement 30 jours d'historique
        await db.execute("""
            DELETE FROM floor_history
            WHERE slug = ? AND recorded_at < datetime('now', '-30 days')
        """, (slug,))
        await db.commit()

async def auto_add_to_watchlist(slug: str, name: str, threshold: int = 0) -> None:
    """Ajoute automatiquement une collection à la watchlist si elle n'y est pas déjà."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT OR IGNORE INTO watchlist
               (collection_slug, collection_name, alert_threshold, added_at)
               VALUES (?, ?, ?, datetime('now'))""",
            (slug, name, threshold or int(DEAL_THRESHOLD)),
        )
        await db.commit()


async def get_floor_trend(slug: str) -> float:
    """Retourne le % de variation du floor vs il y a 24h (positif = hausse, négatif = baisse)."""
    async with aiosqlite.connect(DB_PATH) as db:
        # Floor actuel (dernière heure)
        async with db.execute("""
            SELECT AVG(floor_ton) FROM floor_history
            WHERE slug = ? AND recorded_at > datetime('now', '-2 hours')
        """, (slug,)) as cur:
            row = await cur.fetchone()
            current = row[0] if row and row[0] else None

        # Floor d'hier (entre 22h et 26h)
        async with db.execute("""
            SELECT AVG(floor_ton) FROM floor_history
            WHERE slug = ? AND recorded_at BETWEEN datetime('now', '-26 hours') AND datetime('now', '-22 hours')
        """, (slug,)) as cur:
            row = await cur.fetchone()
            yesterday = row[0] if row and row[0] else None

    if current and yesterday and yesterday > 0:
        return (current - yesterday) / yesterday * 100
    return 0.0

async def get_cached_floor(slug: str) -> float | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT floor_ton FROM floor_cache
            WHERE slug = ? AND updated_at > datetime('now', '-5 minutes')
        """, (slug,)) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None

async def cache_floor(slug: str, name: str, floor: float, volume: float, count: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR REPLACE INTO floor_cache (slug, name, floor_ton, volume_24h, item_count, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        """, (slug, name, floor, volume, count))
        await db.commit()
    # Sauvegarde dans l'historique (1x/heure max)
    await save_floor_history(slug, floor)

async def increment_scan():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE stats SET total_scans = total_scans + 1, last_scan = datetime('now') WHERE id = 1"
        )
        await db.commit()

async def get_stats() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT total_scans, total_alerts, last_scan FROM stats WHERE id = 1"
        ) as cursor:
            row = await cursor.fetchone()
            return {"scans": row[0], "alerts": row[1], "last_scan": row[2]} if row else {}

async def get_recent_alerts(limit: int = 5) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT nft_name, collection, price_ton, floor_ton, discount, nft_address, alerted_at
            FROM alerted_nfts ORDER BY alerted_at DESC LIMIT ?
        """, (limit,)) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "name": r[0], "collection": r[1], "price": r[2],
                    "floor": r[3], "discount": r[4], "address": r[5], "at": r[6]
                }
                for r in rows
            ]

# ─── TONAPI CLIENT (source officielle recommandée par GetGems) ────────────────

_tonapi_rate_limited_until: float = 0.0  # timestamp jusqu'auquel on attend

async def tonapi_get(session: aiohttp.ClientSession, path: str) -> dict | None:
    """GET vers TonAPI avec clé optionnelle et gestion fine du rate-limit."""
    global _tonapi_rate_limited_until

    # Si on sait qu'on est rate-limité, on ne fait pas de requête inutile
    if time.time() < _tonapi_rate_limited_until:
        return None

    url = f"{TONAPI_BASE}{path}"
    headers = {"Accept": "application/json", "User-Agent": get_ua()}
    if TONAPI_KEY:
        headers["Authorization"] = f"Bearer {TONAPI_KEY}"

    # Délai poli entre requêtes (réduit avec clé API)
    await asyncio.sleep(0.3 if TONAPI_KEY else 1.1)

    for attempt in range(2):
        try:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 429:
                    # Backoff sans bloquer tout le scan : on marque 60s d'attente
                    wait = 60 if not TONAPI_KEY else 15
                    log.warning(f"⏳ TonAPI 429 — pause {wait}s (ajoutez TONAPI_KEY pour lever la limite)")
                    _tonapi_rate_limited_until = time.time() + wait
                    return None
                if resp.status == 403:
                    log.warning("🔒 TonAPI 403 — vérifiez TONAPI_KEY ou IP bloquée")
                    return None
                if resp.status != 200:
                    log.debug(f"TonAPI {path} → HTTP {resp.status}")
                    return None
                return await resp.json()
        except asyncio.TimeoutError:
            log.debug(f"TonAPI timeout (essai {attempt + 1}): {path}")
            if attempt == 0:
                await asyncio.sleep(3)
        except Exception as e:
            log.debug(f"TonAPI erreur: {e}")
            break
    return None

# ─── DÉCOUVERTE DES COLLECTIONS GETGEMS VIA TONAPI ───────────────────────────

async def discover_getgems_collections(session: aiohttp.ClientSession, pages: int = 5) -> list[dict]:
    """
    Parcourt TonAPI pour trouver toutes les collections GetGems.
    Filtre sur metadata.marketplace == 'getgems.io'.
    """
    global _discovered_collections, _last_discovery
    found: list[dict] = []

    for page in range(pages):
        offset = page * 200
        data = await tonapi_get(session, f"/nfts/collections?limit=200&offset={offset}")
        if not data:
            break
        batch = data.get("nft_collections", [])
        if not batch:
            break

        for col in batch:
            marketplace = (col.get("metadata") or {}).get("marketplace", "")
            if "getgems" in marketplace.lower():
                found.append(col)

        if len(batch) < 200:
            break  # Dernière page

    # Ajoute aussi les collections connues (env EXTRA_COLLECTIONS)
    for addr in KNOWN_COLLECTION_ADDRESSES:
        if not any(c.get("address") == addr for c in found):
            found.append({"address": addr, "metadata": {"name": addr[:16]}})

    _discovered_collections = found
    _last_discovery = time.time()
    log.info(f"📦 {len(found)} collections GetGems découvertes via TonAPI")
    return found

async def get_collection_listings(session: aiohttp.ClientSession, col_address: str) -> list[dict]:
    """
    Récupère tous les NFTs en vente sur GetGems pour une collection donnée.
    Utilise la pagination TonAPI. Filtre sur sale.market.name contenant 'getgems'.
    """
    listings: list[dict] = []
    offset = 0
    limit  = 200

    while True:
        data = await tonapi_get(
            session, f"/nfts/collections/{col_address}/items?limit={limit}&offset={offset}"
        )
        if not data:
            break

        items = data.get("nft_items", [])
        if not items:
            break

        for item in items:
            sale = item.get("sale")
            if not sale:
                continue

            # Filtre GetGems uniquement
            market_name = (sale.get("market") or {}).get("name", "")
            if "getgems" not in market_name.lower():
                continue

            price_nano = int((sale.get("price") or {}).get("value", 0) or 0)
            if price_nano <= 0:
                continue

            price_ton = price_nano / 1e9
            previews  = item.get("previews") or []
            image_url = previews[-1]["url"] if previews else ""

            listings.append({
                "address":   item.get("address", ""),
                "name":      (item.get("metadata") or {}).get("name", "NFT"),
                "price_ton": price_ton,
                "image_url": image_url,
                "link":      f"https://getgems.io/nft/{item.get('address', '')}",
            })

        if len(items) < limit:
            break
        offset += limit

    return listings

def compute_virtual_floor(listings: list[dict]) -> float:
    """
    Calcule un floor price 'réel' à partir des listings d'une collection.
    Stratégie: médiane des prix → évite les outliers bas isolés.
    Un item est un deal s'il est X% sous la médiane.
    """
    if not listings:
        return 0.0
    prices = sorted(l["price_ton"] for l in listings)
    n = len(prices)
    # Médiane
    if n % 2 == 0:
        return (prices[n // 2 - 1] + prices[n // 2]) / 2
    return prices[n // 2]

# ─── SCORING v2 (0–100) ──────────────────────────────────────────────────────

def compute_score(discount: float, floor: float, volume: float,
                  trend: float = 0.0) -> int:
    """
    Score 0-100 multi-critères :
    - Réduction      : 40 pts max  (critère principal)
    - Volume 24h     : 25 pts max  (liquidité = revente facile)
    - Tendance floor : 20 pts max  (floor qui monte = meilleure opportunité)
    - Floor price    : 15 pts max  (valeur absolue de l'actif)
    """
    # ── Réduction (40 pts) ────────────────────────────────
    if discount >= 80:   s_disc = 40
    elif discount >= 70: s_disc = 36
    elif discount >= 60: s_disc = 32
    elif discount >= 50: s_disc = 27
    elif discount >= 40: s_disc = 20
    elif discount >= 30: s_disc = 13
    elif discount >= 20: s_disc = 7
    else:                s_disc = max(0, int(discount / 4))

    # ── Volume 24h (25 pts) ───────────────────────────────
    if volume >= 5000:   s_vol = 25
    elif volume >= 1000: s_vol = 22
    elif volume >= 500:  s_vol = 18
    elif volume >= 100:  s_vol = 14
    elif volume >= 10:   s_vol = 8
    elif volume >= 1:    s_vol = 4
    else:                s_vol = 0

    # ── Tendance floor vs hier (20 pts) ───────────────────
    # Si le floor monte → l'actif est valorisé → deal encore meilleur
    # Si le floor baisse → attention, actif en dépréciation
    if trend >= 10:    s_trend = 20
    elif trend >= 5:   s_trend = 16
    elif trend >= 0:   s_trend = 10   # Stable ou légère hausse
    elif trend >= -5:  s_trend = 5    # Légère baisse
    elif trend >= -15: s_trend = 2    # Baisse modérée
    else:              s_trend = 0    # Chute → risque élevé

    # ── Floor price absolu (15 pts) ───────────────────────
    if floor >= 500:    s_floor = 15
    elif floor >= 100:  s_floor = 13
    elif floor >= 50:   s_floor = 11
    elif floor >= 10:   s_floor = 8
    elif floor >= 1:    s_floor = 5
    elif floor >= 0.1:  s_floor = 2
    else:               s_floor = 0

    return min(s_disc + s_vol + s_trend + s_floor, 100)


def compute_priority(discount: float) -> str:
    """3 niveaux de priorité basés sur la réduction."""
    if discount >= EXTREME_THRESHOLD:
        return "extreme"
    if discount >= PRIORITY_THRESHOLD:
        return "high"
    return "normal"


def score_bar(score: int) -> str:
    filled = round(score / 10)
    return "█" * filled + "░" * (10 - filled)

# ─── TELEGRAM (aiogram 3.x) ──────────────────────────────────────────────────

bot: Bot | None = None
dp = Dispatcher()

def _webapp_keyboard() -> InlineKeyboardMarkup | None:
    """Retourne un clavier avec le bouton Mini App, ou None si MINI_APP_URL non défini."""
    if not MINI_APP_URL:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="💎 Ouvrir le Dashboard",
            web_app=WebAppInfo(url=MINI_APP_URL),
        )
    ]])


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    kb = _webapp_keyboard()
    await message.answer(
        "🤖 <b>GetGems NFT Sniper actif!</b>\n\n"
        "Je surveille les NFT sous-évalués sur GetGems en temps réel et t'envoie une alerte dès qu'une opportunité est détectée.\n\n"
        "📋 <b>Commandes:</b>\n"
        "• /app — Ouvrir le dashboard complet 📊\n"
        "• /deals — Derniers deals détectés\n"
        "• /watchlist — Collections surveillées\n"
        "• /stats — Statistiques du bot\n"
        "• /floor &lt;slug&gt; — Floor d'une collection",
        parse_mode=ParseMode.HTML,
        reply_markup=kb,
    )


@dp.message(Command("app"))
async def cmd_app(message: types.Message):
    kb = _webapp_keyboard()
    if not kb:
        await message.answer(
            "⚠️ Le dashboard n'est pas encore configuré.\n"
            "Définissez la variable d'environnement <code>MINI_APP_URL</code> avec l'URL de votre déploiement.",
            parse_mode=ParseMode.HTML,
        )
        return
    await message.answer(
        "📊 <b>GetGems Sniper — Dashboard</b>\n\n"
        "Consultez les deals en temps réel, gérez vos collections et configurez le bot directement depuis Telegram.",
        parse_mode=ParseMode.HTML,
        reply_markup=kb,
    )

@dp.message(Command("deals"))
async def cmd_deals(message: types.Message):
    alerts = await get_recent_alerts(5)
    if not alerts:
        await message.answer("Aucun deal trouvé pour l'instant. Le bot scanne en continu...")
        return
    for a in alerts[:3]:
        await message.answer(
            f"💎 <b>{a['name']}</b>\n"
            f"📂 {a['collection']}\n"
            f"Prix: <b>{a['price']:.4f} TON</b> | Floor: {a['floor']:.4f} TON\n"
            f"🔥 Réduction: <b>-{a['discount']:.1f}%</b>\n"
            f"<a href='https://getgems.io/nft/{a['address']}'>👉 Voir sur GetGems</a>",
            parse_mode=ParseMode.HTML,
        )

@dp.message(Command("watchlist"))
async def cmd_watchlist(message: types.Message):
    cols = _discovered_collections or []
    text = f"📋 <b>{len(cols)} collections GetGems surveillées</b>\n\n"
    for col in cols[:10]:
        col_name = (col.get("metadata") or {}).get("name", "?")
        text += f"• {col_name}\n"
    if len(cols) > 10:
        text += f"<i>… et {len(cols) - 10} autres</i>\n"
    text += f"\n<i>Seuil deal: -{DEAL_THRESHOLD}% | Priorité: -{PRIORITY_THRESHOLD}%\nSource: TonAPI</i>"
    await message.answer(text, parse_mode=ParseMode.HTML)

@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    s = await get_stats()
    await message.answer(
        f"📊 <b>Statistiques:</b>\n"
        f"Scans effectués: <b>{s.get('scans', 0)}</b>\n"
        f"Alertes envoyées: <b>{s.get('alerts', 0)}</b>\n"
        f"Dernier scan: <b>{s.get('last_scan', 'N/A')}</b>",
        parse_mode=ParseMode.HTML,
    )

@dp.message(Command("trends"))
async def cmd_trends(message: types.Message):
    await message.answer("📊 <i>Récupération des tendances en cours…</i>", parse_mode=ParseMode.HTML)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT f.slug, f.name, f.floor_ton, f.item_count,
                   (SELECT AVG(floor_ton) FROM floor_history
                    WHERE slug = f.slug
                      AND recorded_at BETWEEN datetime('now', '-26 hours')
                                          AND datetime('now', '-22 hours')) AS floor_24h,
                   (SELECT AVG(floor_ton) FROM floor_history
                    WHERE slug = f.slug
                      AND recorded_at BETWEEN datetime('now', '-7 days', '-2 hours')
                                          AND datetime('now', '-7 days', '+2 hours')) AS floor_7d
            FROM floor_cache f
            WHERE f.floor_ton > 0
            ORDER BY f.item_count DESC
            LIMIT 8
        """) as cur:
            rows = await cur.fetchall()

    if not rows:
        await message.answer(
            "📊 Pas encore de données de tendances.\n"
            "Le bot doit effectuer plusieurs scans avant d'avoir un historique.",
            parse_mode=ParseMode.HTML,
        )
        return

    text = "📈 <b>Tendances des collections GetGems</b>\n<i>Via TonAPI — Floor virtuel (médiane)</i>\n\n"

    for slug, name, floor, items, floor_24h, floor_7d in rows:
        col_display = (name or slug or "?")[:22]

        if floor and floor_24h and floor_24h > 0:
            c24 = (floor - floor_24h) / floor_24h * 100
            if c24 > 0:
                trend_24h = f"📈 +{c24:.1f}%"
            elif c24 < 0:
                trend_24h = f"📉 {c24:.1f}%"
            else:
                trend_24h = "➡️ 0.0%"
        else:
            trend_24h = "➡️ N/A"

        if floor and floor_7d and floor_7d > 0:
            c7 = (floor - floor_7d) / floor_7d * 100
            trend_7d = f"{'📈 +' if c7 > 0 else '📉 '}{c7:.1f}%"
        else:
            trend_7d = "➡️ N/A"

        text += (
            f"<b>{col_display}</b>\n"
            f"💎 Floor: <code>{floor:.4f} TON</code>\n"
            f"📊 24h: {trend_24h}  |  7j: {trend_7d}\n"
            f"🛒 Listings: {items or 0}\n\n"
        )

    await message.answer(text, parse_mode=ParseMode.HTML)


@dp.message(Command("floor"))
async def cmd_floor(message: types.Message):
    parts = (message.text or "").split()
    if len(parts) < 2:
        await message.answer(
            "Usage: /floor &lt;adresse-collection&gt;\nEx: /floor 0:3202...f23",
            parse_mode=ParseMode.HTML,
        )
        return
    addr = parts[1].strip()
    await message.answer(f"🔍 Analyse de <code>{addr[:20]}...</code> via TonAPI...", parse_mode=ParseMode.HTML)
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        listings = await get_collection_listings(session, addr)
        if listings:
            floor = compute_virtual_floor(listings)
            await message.answer(
                f"📊 <b>Floor virtuel (médiane)</b>\n"
                f"• Floor: <b>{floor:.4f} TON</b>\n"
                f"• Listings GetGems: {len(listings)}\n"
                f"• Min: {min(l['price_ton'] for l in listings):.4f} TON\n"
                f"• Max: {max(l['price_ton'] for l in listings):.4f} TON",
                parse_mode=ParseMode.HTML,
            )
        else:
            await message.answer(
                f"❌ Aucun listing GetGems trouvé pour <code>{addr}</code>.",
                parse_mode=ParseMode.HTML,
            )

async def send_alert(deal: dict):
    if not bot or not TELEGRAM_CHAT_ID:
        return

    priority = deal.get("priority", "normal")
    score    = deal.get("score", 0)
    trend    = deal.get("trend", 0.0)
    discount = deal["discount"]

    # ── En-tête selon priorité ──────────────────────────────────────────
    if priority == "extreme":
        header = "🔴 <b>DEAL EXTRÊME — OPPORTUNITÉ RARE !</b> 🔴"
    elif priority == "high":
        header = "🟠 <b>HOT DEAL — PRIORITAIRE !</b>"
    else:
        header = "🟢 <b>BON DEAL DÉTECTÉ</b>"

    # ── Indicateur de tendance ──────────────────────────────────────────
    if trend > 5:
        trend_str = f"📈 Floor en hausse (+{trend:.1f}% / 24h)"
    elif trend < -5:
        trend_str = f"📉 Floor en baisse ({trend:.1f}% / 24h) ⚠️"
    else:
        trend_str = f"➡️ Floor stable ({trend:+.1f}% / 24h)"

    msg = (
        f"{header}\n\n"
        f"🎁 <b>{deal['name']}</b>\n"
        f"📂 Collection: <i>{deal['collection']}</i>\n\n"
        f"💎 Prix actuel: <b>{deal['price']:.4f} TON</b>\n"
        f"📊 Floor price: {deal['floor']:.4f} TON\n"
        f"🔥 Réduction: <b>-{discount:.1f}%</b>\n"
        f"⭐ Score: {score_bar(score)} ({score}/100)\n"
        f"{trend_str}\n\n"
        f"<i>⏰ {datetime.now().strftime('%H:%M:%S')}</i>"
    )

    buttons = [[InlineKeyboardButton(text="🛒 Acheter sur GetGems", url=deal["link"])]]
    if MINI_APP_URL:
        buttons.append([InlineKeyboardButton(
            text="📊 Voir le Dashboard",
            web_app=WebAppInfo(url=MINI_APP_URL),
        )])
    kb = InlineKeyboardMarkup(inline_keyboard=buttons)

    try:
        await bot.send_message(
            chat_id=TELEGRAM_CHAT_ID,
            text=msg,
            parse_mode=ParseMode.HTML,
            reply_markup=kb,
            disable_web_page_preview=True,
        )
    except Exception as e:
        log.error(f"Erreur envoi Telegram: {e}")

# ─── ACTUALITÉS TON GIFTS ─────────────────────────────────────────────────────

import xml.etree.ElementTree as _ET

INITIAL_NEWS = [
    {
        "title": "TON Gifts : 2,18M de détenteurs et 312M$ de volume total",
        "url": "https://ton.org/en/blog/ton-gifts-milestone",
        "summary": "L'écosystème TON Gifts a atteint des sommets historiques en novembre 2025 avec 2,18 millions de détenteurs et 312,2 millions de dollars de volume de négociation total sur la blockchain TON.",
        "source": "TON Foundation",
        "category": "milestone",
        "published_at": "2025-11-15T00:00:00",
    },
    {
        "title": "Khabib Nurmagomedov lance la collection NFT Papakha sur Telegram",
        "url": "https://getgems.io/collection/papakha",
        "summary": "La légende du MMA Khabib Nurmagomedov lance la collection 'Papakha', qui devient virale et booste le volume global des TON Gifts à des niveaux records.",
        "source": "GetGems",
        "category": "launch",
        "published_at": "2025-11-10T00:00:00",
    },
    {
        "title": "Les TON Gifts deviennent des NFT échangeables sur la blockchain TON",
        "url": "https://telegram.org/blog/gifts",
        "summary": "Telegram étend les fonctionnalités : les cadeaux collectibles peuvent être portés comme statuts emoji, transférés ou mis aux enchères via la blockchain TON. Paiement en TON ou Stars.",
        "source": "Telegram",
        "category": "feature",
        "published_at": "2025-10-01T00:00:00",
    },
    {
        "title": "Crafting NFT : combiner des cadeaux Telegram pour en créer de nouveaux",
        "url": "https://ton.org/en/blog/gifts-crafting",
        "summary": "Des rumeurs et indices officiels pointent vers un système de 'crafting' permettant de fusionner plusieurs cadeaux existants pour générer des NFT exclusifs plus rares.",
        "source": "TON Ecosystem",
        "category": "rumor",
        "published_at": "2025-12-01T00:00:00",
    },
    {
        "title": "Toncoin accepté comme paiement secondaire pour les TON Gifts",
        "url": "https://telegram.org/blog/toncoin-gifts",
        "summary": "Telegram officialise l'utilisation du Toncoin (TON) comme option de paiement pour les transactions de cadeaux numériques, en complément des Telegram Stars.",
        "source": "Telegram",
        "category": "feature",
        "published_at": "2025-09-15T00:00:00",
    },
]

RSS_SOURCES = [
    ("https://cointelegraph.com/rss/tag/ton",        "CoinTelegraph"),
    ("https://decrypt.co/feed/tag/ton",              "Decrypt"),
]

async def seed_initial_news():
    """Insère les actualités initiales si la table est vide."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM news") as cur:
            count = (await cur.fetchone())[0]
        if count == 0:
            for n in INITIAL_NEWS:
                await db.execute("""
                    INSERT OR IGNORE INTO news (title, url, summary, source, category, published_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (n["title"], n["url"], n["summary"], n["source"], n["category"], n["published_at"]))
            await db.commit()
            log.info(f"✅ {len(INITIAL_NEWS)} actualités initiales insérées")

async def fetch_rss_news(session: aiohttp.ClientSession):
    """Tente de récupérer les dernières actualités depuis les flux RSS."""
    for url, source_name in RSS_SOURCES:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    continue
                text = await resp.text()
            root = _ET.fromstring(text)
            ns = {"dc": "http://purl.org/dc/elements/1.1/"}
            channel = root.find("channel")
            if channel is None:
                continue
            items = channel.findall("item")[:10]
            async with aiosqlite.connect(DB_PATH) as db:
                inserted = 0
                for item in items:
                    title = (item.findtext("title") or "").strip()
                    link  = (item.findtext("link")  or "").strip()
                    desc  = (item.findtext("description") or "").strip()[:400]
                    pubdate = (item.findtext("pubDate") or "").strip()
                    if not title or not link:
                        continue
                    try:
                        await db.execute("""
                            INSERT OR IGNORE INTO news (title, url, summary, source, category, published_at)
                            VALUES (?, ?, ?, ?, 'ecosystem', ?)
                        """, (title, link, desc, source_name, pubdate))
                        inserted += 1
                    except Exception:
                        pass
                await db.commit()
            log.info(f"📰 RSS {source_name}: {inserted} article(s) importé(s)")
        except Exception as e:
            log.debug(f"RSS {source_name} inaccessible: {e}")

_last_news_fetch: float = 0.0

async def maybe_refresh_news(session: aiohttp.ClientSession):
    global _last_news_fetch
    if time.time() - _last_news_fetch > 3600:
        _last_news_fetch = time.time()
        await fetch_rss_news(session)


# ─── COLLECTIONS SPOTLIGHT (TON Gifts curatées) ───────────────────────────────

SPOTLIGHT_COLLECTIONS = [
    {
        "name": "Papakha by Khabib",
        "url": "https://getgems.io/collection/papakha",
        "description": "Collection lancée par la légende du MMA Khabib Nurmagomedov",
        "category": "celebrity",
        "emoji": "🥊",
    },
    {
        "name": "Telegram Gifts",
        "url": "https://getgems.io/?filter=gifts",
        "description": "Cadeaux Telegram convertis en NFT échangeables sur la blockchain TON",
        "category": "official",
        "emoji": "🎁",
    },
    {
        "name": "TON Punks",
        "url": "https://getgems.io/collection/ton-punks",
        "description": "La collection OG de l'écosystème TON — référence de liquidité",
        "category": "og",
        "emoji": "👾",
    },
    {
        "name": "Getgems Anonymous",
        "url": "https://getgems.io/collection/getgems-anonymous",
        "description": "Collection phare de la marketplace GetGems",
        "category": "og",
        "emoji": "🎭",
    },
    {
        "name": "TON Diamonds",
        "url": "https://getgems.io/collection/ton-diamonds",
        "description": "NFT de haute valeur — floor élevé, fort potentiel de plus-value",
        "category": "premium",
        "emoji": "💎",
    },
]


# ─── BOUCLE DE SNIPING ────────────────────────────────────────────────────────

async def sniper_loop():
    log.info("🚀 Boucle de sniping démarrée (via TonAPI)")
    if bot and TELEGRAM_CHAT_ID:
        try:
            await bot.send_message(
                chat_id=TELEGRAM_CHAT_ID,
                text=(
                    f"🤖 <b>GetGems NFT Sniper démarré!</b>\n\n"
                    f"⚙️ Config:\n"
                    f"• Scan toutes les <b>{SCAN_INTERVAL}s</b>\n"
                    f"• Deal si réduction ≥ <b>{DEAL_THRESHOLD}%</b>\n"
                    f"• Priorité si réduction ≥ <b>{PRIORITY_THRESHOLD}%</b>\n"
                    f"• Source: <b>TonAPI (officiel GetGems)</b>\n\n"
                    f"📡 Découverte des collections en cours..."
                ),
                parse_mode=ParseMode.HTML,
            )
        except Exception as e:
            log.warning(f"Impossible d'envoyer le message de démarrage: {e}")

    connector = aiohttp.TCPConnector(ssl=False, limit=5)
    scan_count = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        while True:
            t0 = time.time()
            scan_count += 1
            deals_found = 0

            # ── Refresh actualités toutes les heures ─────────────────────
            await maybe_refresh_news(session)

            # ── Redécouverte des collections toutes les 30 min ──────────────
            if time.time() - _last_discovery > 1800 or not _discovered_collections:
                collections = await discover_getgems_collections(session, pages=5)
            else:
                collections = _discovered_collections

            if not collections:
                log.warning("⚠️ Aucune collection trouvée — retry dans 60s")
                await asyncio.sleep(60)
                continue

            # ── Scan d'un sous-ensemble de collections (évite rate-limit TonAPI) ─
            shuffled = collections[:]
            random.shuffle(shuffled)
            batch = shuffled[:MAX_COLLECTIONS_PER_CYCLE]
            log.info(f"🔍 Scan de {len(batch)}/{len(collections)} collections (max {MAX_COLLECTIONS_PER_CYCLE}/cycle)")

            for col in batch:
                col_address = col.get("address", "")
                col_name    = (col.get("metadata") or {}).get("name", col_address[:20])

                if not col_address:
                    continue

                try:
                    listings = await get_collection_listings(session, col_address)

                    if len(listings) < 2:
                        continue  # Pas assez de données

                    # Floor virtuel = médiane des prix en vente
                    floor_ton  = compute_virtual_floor(listings)
                    volume_ton = 0.0  # TonAPI ne donne pas le volume direct
                    trend      = await get_floor_trend(col_address)

                    if floor_ton <= 0:
                        continue

                    # Cache pour les stats du dashboard
                    await cache_floor(col_address, col_name, floor_ton, volume_ton, len(listings))

                    # Watchlist automatique : toute collection active y est ajoutée
                    await auto_add_to_watchlist(col_address, col_name)

                    for item in listings:
                        price = item["price_ton"]
                        if price <= 0 or price >= floor_ton:
                            continue

                        discount = (floor_ton - price) / floor_ton * 100
                        if discount < DEAL_THRESHOLD:
                            continue

                        address = item["address"]
                        if await is_already_alerted(address):
                            continue

                        score    = compute_score(discount, floor_ton, volume_ton, trend)
                        priority = compute_priority(discount)

                        deal = {
                            "address":    address,
                            "name":       item["name"],
                            "collection": col_name,
                            "price":      price,
                            "floor":      floor_ton,
                            "discount":   round(discount, 1),
                            "score":      score,
                            "priority":   priority,
                            "trend":      round(trend, 2),
                            "link":       item["link"],
                        }

                        emoji = {"extreme": "🔴", "high": "🟠"}.get(priority, "🟢")
                        log.info(
                            f"{emoji} {item['name']} "
                            f"@ {price:.4f} TON (floor médiane {floor_ton:.4f}) "
                            f"-{discount:.1f}% | score {score}"
                        )

                        await send_alert(deal)
                        await mark_as_alerted(
                            address, item["name"], col_name,
                            price, floor_ton, round(discount, 1),
                            score=score, priority=priority,
                        )
                        deals_found += 1

                except Exception as e:
                    log.error(f"Erreur scan {col_name}: {e}")

            await increment_scan()
            elapsed = time.time() - t0
            log.info(f"✅ Scan #{scan_count} en {elapsed:.1f}s | {deals_found} deal(s) | {len(collections)} collections")

            sleep_for = max(1.0, SCAN_INTERVAL - elapsed)
            await asyncio.sleep(sleep_for)

# ─── SERVEUR WEB (API REST + fichiers statiques Mini App) ────────────────────

import json as _json
import os as _os

# Dossier contenant le build React (relatif au bot.py)
STATIC_DIR = _os.path.join(_os.path.dirname(__file__), "..", "dist", "public")

def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

def json_resp(data, status=200):
    return aiohttp.web.Response(
        text=_json.dumps(data),
        status=status,
        content_type="application/json",
        headers=cors_headers(),
    )

# ── Healthcheck avancé ──
async def handle_health(req):
    s = await get_stats()
    uptime_sec = int(time.time() - _BOT_START_TIME)
    uptime_str = f"{uptime_sec // 3600}h {(uptime_sec % 3600) // 60}m {uptime_sec % 60}s"
    try:
        mem = psutil.Process().memory_info()
        mem_mb = round(mem.rss / 1024 / 1024, 1)
    except Exception:
        mem_mb = 0
    return json_resp({
        "status": "OK",
        "version": "2.0",
        "uptime": uptime_str,
        "uptimeSeconds": uptime_sec,
        "memoryMb": mem_mb,
        "totalScans": s.get("scans", 0),
        "totalAlerts": s.get("alerts", 0),
        "lastScan": s.get("last_scan"),
        "thresholds": {
            "deal": DEAL_THRESHOLD,
            "hot": PRIORITY_THRESHOLD,
            "extreme": EXTREME_THRESHOLD,
        },
    })

# ── GET /api/deals ──
async def handle_deals(req):
    limit  = int(req.rel_url.query.get("limit", 50))
    offset = int(req.rel_url.query.get("offset", 0))
    prio   = req.rel_url.query.get("priority", "")   # normal|high|extreme
    search = req.rel_url.query.get("q", "").lower()
    min_score = int(req.rel_url.query.get("minScore", 0))

    sql = """
        SELECT rowid, nft_address, nft_name, collection,
               price_ton, floor_ton, discount, alerted_at,
               COALESCE(score, 0), COALESCE(priority, 'normal')
        FROM alerted_nfts
        WHERE 1=1
    """
    params: list = []
    if prio:
        sql += " AND COALESCE(priority,'normal') = ?"
        params.append(prio)
    if min_score:
        sql += " AND COALESCE(score, 0) >= ?"
        params.append(min_score)
    sql += " ORDER BY alerted_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(sql, params) as cur:
            rows = await cur.fetchall()

    deals = []
    for r in rows:
        name_lc = (r[2] or "").lower()
        coll_lc = (r[3] or "").lower()
        if search and search not in name_lc and search not in coll_lc:
            continue
        floor = r[5] or 1
        price = r[4] or 0
        disc  = r[6] or 0
        score = r[8] or compute_score(disc, floor, 0)
        prio_val = r[9] or compute_priority(disc)
        deals.append({
            "id":             r[0],
            "nftName":        r[2],
            "collectionName": r[3],
            "currentPrice":   price,
            "floorPrice":     floor,
            "discountPercent": round(disc, 1),
            "score":          score,
            "priority":       prio_val,
            "link":           f"https://getgems.io/nft/{r[1]}",
            "imageUrl":       None,
            "detectedAt":     r[7],
        })
    return json_resp(deals)


# ── GET /api/deals/history ──
async def handle_deals_history(req):
    limit  = int(req.rel_url.query.get("limit", 100))
    offset = int(req.rel_url.query.get("offset", 0))
    prio   = req.rel_url.query.get("priority", "")
    since  = req.rel_url.query.get("since", "")   # ISO datetime

    sql = """
        SELECT rowid, nft_address, nft_name, collection,
               price_ton, floor_ton, discount, alerted_at,
               COALESCE(score, 0), COALESCE(priority, 'normal')
        FROM alerted_nfts
        WHERE 1=1
    """
    params: list = []
    if prio:
        sql += " AND COALESCE(priority,'normal') = ?"
        params.append(prio)
    if since:
        sql += " AND alerted_at >= ?"
        params.append(since)
    sql += " ORDER BY alerted_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(sql, params) as cur:
            rows = await cur.fetchall()
        async with db.execute("SELECT COUNT(*) FROM alerted_nfts") as cur:
            total = (await cur.fetchone())[0]

    items = [{
        "id":             r[0],
        "nftName":        r[2],
        "collectionName": r[3],
        "currentPrice":   r[4] or 0,
        "floorPrice":     r[5] or 1,
        "discountPercent": round(r[6] or 0, 1),
        "score":          r[8],
        "priority":       r[9],
        "link":           f"https://getgems.io/nft/{r[1]}",
        "detectedAt":     r[7],
    } for r in rows]

    return json_resp({"total": total, "items": items, "limit": limit, "offset": offset})


# ── GET /api/stats/charts ──
async def handle_stats_charts(req):
    async with aiosqlite.connect(DB_PATH) as db:
        # Deals par heure (24 dernières heures)
        async with db.execute("""
            SELECT strftime('%H:00', alerted_at) as hour, COUNT(*) as count
            FROM alerted_nfts
            WHERE alerted_at >= datetime('now', '-24 hours')
            GROUP BY hour ORDER BY hour
        """) as cur:
            rows_hourly = await cur.fetchall()

        # Deals par collection (top 10)
        async with db.execute("""
            SELECT collection, COUNT(*) as count
            FROM alerted_nfts
            GROUP BY collection ORDER BY count DESC LIMIT 10
        """) as cur:
            rows_coll = await cur.fetchall()

        # Répartition priorité
        async with db.execute("""
            SELECT COALESCE(priority,'normal') as p, COUNT(*) as count
            FROM alerted_nfts GROUP BY p
        """) as cur:
            rows_prio = await cur.fetchall()

        # Évolution du floor par collection (7 derniers jours)
        async with db.execute("""
            SELECT slug, strftime('%Y-%m-%d', recorded_at) as day, AVG(floor_ton) as avg_floor
            FROM floor_history
            WHERE recorded_at >= datetime('now', '-7 days')
            GROUP BY slug, day ORDER BY slug, day
        """) as cur:
            rows_trend = await cur.fetchall()

    return json_resp({
        "dealsPerHour":   [{"hour": r[0], "count": r[1]} for r in rows_hourly],
        "dealsByCollection": [{"name": r[0], "count": r[1]} for r in rows_coll],
        "priorityDistribution": [{"priority": r[0], "count": r[1]} for r in rows_prio],
        "floorTrend": [{"slug": r[0], "day": r[1], "avgFloor": round(r[2], 4)} for r in rows_trend],
    })

# ── GET /api/deals/stats ──
async def handle_deal_stats(req):
    s = await get_stats()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM alerted_nfts WHERE discount >= ?", (PRIORITY_THRESHOLD,)) as cur:
            high = (await cur.fetchone())[0]
        async with db.execute("SELECT AVG(discount), COUNT(*) FROM alerted_nfts") as cur:
            row = await cur.fetchone()
            avg_disc = round(row[0] or 0, 1)
            total = row[1] or 0
        async with db.execute("SELECT COUNT(*) FROM floor_cache") as cur:
            colls = (await cur.fetchone())[0]
    return json_resp({
        "totalDeals": total,
        "highPriorityDeals": high,
        "avgDiscount": avg_disc,
        "totalCollections": colls,
    })

# ── GET /api/collections ──
async def handle_collections(req):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT rowid, slug, name, floor_ton, volume_24h, item_count, updated_at
            FROM floor_cache ORDER BY floor_ton DESC
        """) as cur:
            rows = await cur.fetchall()
    return json_resp([{
        "id": r[0], "slug": r[1], "name": r[2],
        "floorPrice": r[3] or 0, "volume24h": r[4] or 0,
        "itemCount": r[5] or 0, "updatedAt": r[6],
    } for r in rows])

# ── GET /api/watchlist ──
async def handle_watchlist_get(req):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT rowid, collection_slug, collection_name, alert_threshold, added_at FROM watchlist ORDER BY added_at DESC"
        ) as cur:
            rows = await cur.fetchall()
    return json_resp([{
        "id": r[0], "collectionSlug": r[1], "collectionName": r[2],
        "alertThreshold": r[3], "addedAt": r[4],
    } for r in rows])

# ── POST /api/watchlist ──
async def handle_watchlist_post(req):
    try:
        body = await req.json()
        slug  = body.get("collectionSlug", "").strip()
        name  = body.get("collectionName", "").strip()
        thresh = int(body.get("alertThreshold", 40))
        if not slug or not name:
            return json_resp({"error": "slug et name requis"}, 400)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR IGNORE INTO watchlist (collection_slug, collection_name, alert_threshold, added_at) VALUES (?,?,?,datetime('now'))",
                (slug, name, thresh)
            )
            await db.commit()
            async with db.execute("SELECT last_insert_rowid()") as cur:
                rid = (await cur.fetchone())[0]
        return json_resp({"id": rid, "collectionSlug": slug, "collectionName": name, "alertThreshold": thresh})
    except Exception as e:
        return json_resp({"error": str(e)}, 500)

# ── DELETE /api/watchlist/{id} ──
async def handle_watchlist_delete(req):
    try:
        wid = int(req.match_info["id"])
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM watchlist WHERE rowid = ?", (wid,))
            await db.commit()
        return json_resp({"ok": True})
    except Exception as e:
        return json_resp({"error": str(e)}, 500)

# ── GET /api/news ──
async def handle_news(req):
    limit = int(req.rel_url.query.get("limit", 20))
    category = req.rel_url.query.get("category", "")
    sql = "SELECT id, title, url, summary, source, category, published_at FROM news WHERE 1=1"
    params: list = []
    if category:
        sql += " AND category = ?"
        params.append(category)
    sql += " ORDER BY published_at DESC LIMIT ?"
    params.append(limit)
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(sql, params) as cur:
            rows = await cur.fetchall()
    items = [
        {
            "id": r[0], "title": r[1], "url": r[2], "summary": r[3],
            "source": r[4], "category": r[5], "publishedAt": r[6],
        }
        for r in rows
    ]
    return json_resp(items)

# ── GET /api/featured ──
async def handle_featured(req):
    """Collections en vedette : top actives + spotlight curatées."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT slug, name, floor_ton, item_count, updated_at
            FROM floor_cache
            WHERE floor_ton > 0
            ORDER BY item_count DESC, floor_ton DESC
            LIMIT 10
        """) as cur:
            rows = await cur.fetchall()
    live = [
        {
            "slug": r[0],
            "name": r[1],
            "floorTon": round(r[2], 4),
            "listings": r[3],
            "updatedAt": r[4],
            "url": f"https://getgems.io/collection/{r[0]}",
            "type": "live",
        }
        for r in rows
    ]
    return json_resp({
        "live": live,
        "spotlight": SPOTLIGHT_COLLECTIONS,
    })

# ── GET /api/bot/status ──
async def handle_bot_status(req):
    s = await get_stats()
    return json_resp({
        "isRunning": True,
        "telegramToken": "***" if TELEGRAM_TOKEN else "",
        "chatId": TELEGRAM_CHAT_ID,
        "scanInterval": SCAN_INTERVAL,
        "dealThreshold": int(DEAL_THRESHOLD),
        "priorityThreshold": int(PRIORITY_THRESHOLD),
        "totalScans": s.get("scans", 0),
        "totalAlertsSet": s.get("alerts", 0),
        "lastActivity": s.get("last_scan"),
        "tonapiKeySet": bool(TONAPI_KEY),
        "maxCollectionsPerCycle": MAX_COLLECTIONS_PER_CYCLE,
        "collectionsKnown": len(_discovered_collections),
    })

# ── PUT /api/bot/config ──
async def handle_bot_config(req):
    # La config vit dans les variables d'environnement sur Railway
    # On retourne juste un succès ici (les vraies configs sont dans Railway)
    return json_resp({"ok": True, "message": "Modifiez les variables d'environnement Railway pour changer la config."})

# ── GET /api/trends ──
async def handle_trends(req):
    """
    Retourne les tendances de prix pour toutes les collections suivies.
    Paramètre: ?period=24h|7d|30d
    """
    period = req.rel_url.query.get("period", "7d")

    async with aiosqlite.connect(DB_PATH) as db:
        # Toutes les collections en cache (issues du scanner TonAPI)
        async with db.execute("""
            SELECT slug, name, floor_ton, volume_24h, item_count, updated_at
            FROM floor_cache
            WHERE floor_ton > 0
            ORDER BY floor_ton DESC
        """) as cur:
            collections = await cur.fetchall()

        result = []
        for col in collections:
            slug, name, current_floor, volume, item_count, updated = col

            # Variation 24h
            async with db.execute("""
                SELECT AVG(floor_ton) FROM floor_history
                WHERE slug = ?
                  AND recorded_at BETWEEN datetime('now', '-26 hours')
                                      AND datetime('now', '-22 hours')
            """, (slug,)) as cur:
                row = await cur.fetchone()
                floor_24h = row[0] if row and row[0] else None

            # Variation 7j
            async with db.execute("""
                SELECT AVG(floor_ton) FROM floor_history
                WHERE slug = ?
                  AND recorded_at BETWEEN datetime('now', '-7 days', '-2 hours')
                                      AND datetime('now', '-7 days', '+2 hours')
            """, (slug,)) as cur:
                row = await cur.fetchone()
                floor_7d = row[0] if row and row[0] else None

            # Historique de prix selon la période
            if period == "24h":
                hist_sql = """
                    SELECT strftime('%Y-%m-%dT%H:00:00', recorded_at), AVG(floor_ton)
                    FROM floor_history
                    WHERE slug = ? AND recorded_at >= datetime('now', '-24 hours')
                    GROUP BY strftime('%Y-%m-%dT%H:00:00', recorded_at)
                    ORDER BY recorded_at
                """
            elif period == "30d":
                hist_sql = """
                    SELECT strftime('%Y-%m-%d', recorded_at), AVG(floor_ton)
                    FROM floor_history
                    WHERE slug = ? AND recorded_at >= datetime('now', '-30 days')
                    GROUP BY strftime('%Y-%m-%d', recorded_at)
                    ORDER BY recorded_at
                """
            else:  # 7d par défaut
                hist_sql = """
                    SELECT strftime('%Y-%m-%d', recorded_at), AVG(floor_ton)
                    FROM floor_history
                    WHERE slug = ? AND recorded_at >= datetime('now', '-7 days')
                    GROUP BY strftime('%Y-%m-%d', recorded_at)
                    ORDER BY recorded_at
                """

            async with db.execute(hist_sql, (slug,)) as cur:
                history_rows = await cur.fetchall()

            # Calcul des % de variation
            change_24h = None
            if current_floor and floor_24h and floor_24h > 0:
                change_24h = round((current_floor - floor_24h) / floor_24h * 100, 1)

            change_7d = None
            if current_floor and floor_7d and floor_7d > 0:
                change_7d = round((current_floor - floor_7d) / floor_7d * 100, 1)

            # Nombre de deals détectés par collection (proxy du volume)
            async with db.execute("""
                SELECT COUNT(*) FROM alerted_nfts WHERE collection = ?
            """, (name,)) as cur:
                row = await cur.fetchone()
                deals_count = row[0] if row else 0

            result.append({
                "slug":         slug,
                "name":         name or slug[:20],
                "currentFloor": round(current_floor, 4) if current_floor else 0,
                "itemCount":    item_count or 0,
                "volume24h":    round(volume or 0, 2),
                "dealsFound":   deals_count,
                "change24h":    change_24h,
                "change7d":     change_7d,
                "updatedAt":    updated,
                "floorHistory": [
                    {"time": r[0], "floor": round(r[1], 4)}
                    for r in history_rows if r[1]
                ],
            })

    # Trie par activité (variation 24h absolue en premier, puis collections actives)
    result.sort(key=lambda x: (
        -abs(x.get("change24h") or 0),
        -(x.get("itemCount") or 0),
    ))

    return json_resp({"collections": result, "period": period})


# ── OPTIONS (CORS preflight) ──
async def handle_options(req):
    return aiohttp.web.Response(status=204, headers=cors_headers())

# ── Fichiers statiques React ──
async def handle_static(req):
    # Retire le préfixe de base si présent
    path_str = req.path.lstrip("/")
    file_path = _os.path.join(STATIC_DIR, path_str) if path_str else _os.path.join(STATIC_DIR, "index.html")

    # Si le fichier n'existe pas → renvoie index.html (SPA routing)
    if not _os.path.isfile(file_path):
        file_path = _os.path.join(STATIC_DIR, "index.html")

    if not _os.path.isfile(file_path):
        return aiohttp.web.Response(text="Mini App non construite. Lancez le build.", status=404)

    ext = _os.path.splitext(file_path)[1]
    mime = {
        ".html": "text/html", ".js": "application/javascript",
        ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".json": "application/json",
    }.get(ext, "application/octet-stream")

    with open(file_path, "rb") as f:
        return aiohttp.web.Response(body=f.read(), content_type=mime)

async def start_web_server():
    app = aiohttp.web.Application()

    # ── API routes ───────────────────────────────────────────────────────
    app.router.add_get("/health",                    handle_health)
    app.router.add_get("/api/deals",                 handle_deals)
    app.router.add_get("/api/deals/stats",           handle_deal_stats)
    app.router.add_get("/api/deals/history",         handle_deals_history)
    app.router.add_get("/api/stats/charts",          handle_stats_charts)
    app.router.add_get("/api/collections",           handle_collections)
    app.router.add_get("/api/trends",                handle_trends)
    app.router.add_get("/api/news",                  handle_news)
    app.router.add_get("/api/featured",              handle_featured)
    app.router.add_get("/api/watchlist",             handle_watchlist_get)
    app.router.add_post("/api/watchlist",            handle_watchlist_post)
    app.router.add_delete("/api/watchlist/{id}",     handle_watchlist_delete)
    app.router.add_get("/api/bot/status",            handle_bot_status)
    app.router.add_put("/api/bot/config",            handle_bot_config)
    app.router.add_route("OPTIONS", "/{path_info:.*}", handle_options)

    # ── Fichiers statiques React (SPA routing) ───────────────────────────
    app.router.add_get("/",                          handle_static)
    app.router.add_get("/{path_info:.*}",            handle_static)

    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, "0.0.0.0", KEEPALIVE_PORT)
    await site.start()
    log.info(f"🌐 Serveur web démarré sur le port {KEEPALIVE_PORT} (API + Mini App statique)")

# ─── POINT D'ENTRÉE ──────────────────────────────────────────────────────────

async def main():
    global bot

    if not TELEGRAM_TOKEN:
        log.warning("⚠️  TELEGRAM_BOT_TOKEN non défini — alertes Telegram désactivées")
    else:
        bot = Bot(token=TELEGRAM_TOKEN)

    await init_db()
    await seed_initial_news()

    # Serveur web : API REST + fichiers statiques Mini App
    await start_web_server()

    # Sniper tourne en arrière-plan dans tous les cas
    asyncio.create_task(sniper_loop())

    if bot:
        log.info("🤖 Démarrage du polling Telegram (aiogram 3.x)...")
        # start_polling DOIT être awaité directement en aiogram 3.x
        # drop_pending_updates=True évite de traiter les vieux messages
        await dp.start_polling(
            bot,
            allowed_updates=["message"],
            drop_pending_updates=True,
        )
    else:
        # Pas de bot Telegram : on attend indéfiniment sur le sniper seul
        await asyncio.Event().wait()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("👋 Bot arrêté.")
