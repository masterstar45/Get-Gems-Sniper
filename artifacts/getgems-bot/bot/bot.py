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
import base64
import logging
import os
import random
import struct
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

# ─── UTILITAIRES ADRESSES TON ────────────────────────────────────────────────

def _crc16_ccitt(data: bytes) -> int:
    """CRC-16/CCITT (polynomial 0x1021)."""
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
        crc &= 0xFFFF
    return crc

def ton_raw_to_friendly(addr: str, bounceable: bool = True) -> str:
    """Convertit une adresse TON brute (0:hex64) en format user-friendly (EQ…).
    Retourne l'adresse inchangée si déjà en format base64url ou si erreur."""
    if not addr:
        return addr
    # Déjà en format friendly (commence par EQ, UQ, kQ, 0Q, etc.)
    if ":" not in addr:
        return addr
    try:
        wc_str, hex_part = addr.split(":", 1)
        if len(hex_part) != 64:
            return addr
        wc   = int(wc_str) & 0xFF
        tag  = 0x11 if bounceable else 0x51
        body = bytes([tag, wc]) + bytes.fromhex(hex_part)
        crc  = _crc16_ccitt(body)
        full = body + struct.pack(">H", crc)
        return base64.urlsafe_b64encode(full).decode()  # 48 chars, no padding needed
    except Exception:
        return addr

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

# Diagnostics du dernier cycle de scan (exposé via /api/debug/scan)
_scan_diagnostics: dict = {
    "cycle": 0,
    "collections_total": 0,
    "collections_scanned": 0,
    "collections_with_listings": 0,
    "items_fetched": 0,
    "items_getgems": 0,
    "items_below_floor": 0,
    "items_qualifying": 0,
    "deals_found": 0,
    "tonapi_errors": 0,
    "tonapi_rate_limited": False,
    "last_collection_scanned": "",
    "last_collection_listings": 0,
    "sample_prices": [],
    "sample_floor": 0.0,
    "ts": 0.0,
}

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

            CREATE TABLE IF NOT EXISTS runtime_config (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            );
        """)
        # Migrations sans-casse (colonnes ajoutées si absentes)
        for col_def in [
            ("alerted_nfts", "score",     "INTEGER DEFAULT 0"),
            ("alerted_nfts", "priority",  "TEXT DEFAULT 'normal'"),
            ("alerted_nfts", "image_url", "TEXT DEFAULT ''"),
            ("alerted_nfts", "source",    "TEXT DEFAULT 'getgems'"),
            ("alerted_nfts", "buy_link",  "TEXT DEFAULT ''"),
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
                           score: int = 0, priority: str = "normal",
                           image_url: str = "", source: str = "getgems",
                           buy_link: str = ""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR IGNORE INTO alerted_nfts
            (nft_address, nft_name, collection, price_ton, floor_ton, discount, score, priority, image_url, source, buy_link)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (address, name, collection, price, floor, discount, score, priority, image_url, source, buy_link))
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

    # Délai poli entre requêtes (réduit avec clé API, mais pas trop agressif)
    await asyncio.sleep(0.5 if TONAPI_KEY else 1.2)

    for attempt in range(2):
        try:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 429:
                    if TONAPI_KEY:
                        wait = 20
                        log.warning(f"⏳ TonAPI 429 (clé: free tier) — pause {wait}s")
                    else:
                        wait = 60
                        log.warning(f"⏳ TonAPI 429 — pause {wait}s (sans clé API, limite basse)")
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

            market      = sale.get("market") or {}
            market_name = market.get("name", "").lower()

            # Accepte toutes les marketplaces : GetGems, Fragment, Tonnel, etc.
            # (avant : filtrait uniquement getgems)
            price_nano = int((sale.get("price") or {}).get("value", 0) or 0)
            if price_nano <= 0:
                continue

            price_ton = price_nano / 1e9
            previews  = item.get("previews") or []
            image_url = previews[-1]["url"] if previews else ""
            addr      = item.get("address", "")
            friendly  = ton_raw_to_friendly(addr)

            # Génère le lien d'achat selon la marketplace
            if "fragment" in market_name:
                buy_link = f"https://fragment.com/nft/{friendly}"
                source   = "fragment"
            elif "tonnel" in market_name:
                buy_link = f"https://tonnel.io/nft/{friendly}"
                source   = "tonnel"
            else:
                buy_link = f"https://getgems.io/nft/{friendly}"
                source   = "getgems"

            listings.append({
                "address":   addr,
                "name":      (item.get("metadata") or {}).get("name", "NFT"),
                "price_ton": price_ton,
                "image_url": image_url,
                "link":      buy_link,
                "source":    source,
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

# ─── RUNTIME CONFIG (persistée en DB, modifiable depuis le dashboard) ────────

import json as _json_cfg

_runtime_config: dict = {
    "scan_types":      ["getgems", "tg_gifts", "fragment"],
    "max_price_ton":   0.0,    # 0 = pas de limite
    "top_gifts_count": 20,     # top N collections Gift à scanner en priorité
}

async def load_runtime_config() -> dict:
    """Charge la config depuis runtime_config DB → met à jour _runtime_config."""
    global _runtime_config
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT key, value FROM runtime_config") as cur:
                rows = await cur.fetchall()
        for k, v in rows:
            if k == "scan_types":
                _runtime_config["scan_types"] = _json_cfg.loads(v)
            elif k == "max_price_ton":
                _runtime_config["max_price_ton"] = float(v)
            elif k == "top_gifts_count":
                _runtime_config["top_gifts_count"] = int(v)
    except Exception as e:
        log.debug(f"load_runtime_config: {e}")
    return dict(_runtime_config)

async def save_runtime_config_key(key: str, value) -> None:
    """Sauvegarde une clé dans runtime_config DB."""
    str_val = _json_cfg.dumps(value) if isinstance(value, list) else str(value)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO runtime_config (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            (key, str_val)
        )
        await db.commit()
    _runtime_config[key] = value


# ─── GETGEMS GRAPHQL CLIENT ──────────────────────────────────────────────────

GG_GRAPHQL_URL = "https://api.getgems.io/graphql"

async def gg_query(session: aiohttp.ClientSession, query: str, variables: dict | None = None) -> dict | None:
    """POST vers l'API GraphQL publique de GetGems."""
    await asyncio.sleep(0.5)
    try:
        payload: dict = {"query": query}
        if variables:
            payload["variables"] = variables
        async with session.post(
            GG_GRAPHQL_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept":       "application/json",
                "User-Agent":   get_ua(),
                "Origin":       "https://getgems.io",
                "Referer":      "https://getgems.io/store/gifts",
            },
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status != 200:
                log.debug(f"GetGems GQL HTTP {resp.status}")
                return None
            d = await resp.json()
            if d.get("errors"):
                log.debug(f"GetGems GQL errors: {d['errors'][:1]}")
            return d.get("data")
    except Exception as e:
        log.debug(f"GetGems GQL: {e}")
        return None


# ─── SCANNER TELEGRAM GIFT NFTs (via GetGems GraphQL) ────────────────────────

# Requête GraphQL : toutes les collections de type tgGift avec leur floor
_GG_GIFTS_COLLECTIONS_QUERY = """
{
  alphaNftCollections(first: 200, sort: TradeVolume, types: [tgGift]) {
    items {
      ... on NftCollection {
        address
        name
        floorPrice { value }
        counters { activeAuctions }
        totalSales
        itemsCount
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

# Requête GraphQL : ventes fix_price pour une collection (triées par prix croissant)
_GG_COLLECTION_SALES_QUERY = """
query Sales($addr: String!, $cursor: String) {
  alphaNftSalesByCollection(
    collectionAddress: $addr
    first: 100
    sort: PriceLow
    after: $cursor
  ) {
    items {
      ... on NftSaleFixPrice {
        nftAddress
        fullPrice
        nft {
          address
          name
          previews { url resolution }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

_gift_collections_cache: list[dict] = []
_gift_collections_ts: float = 0.0


async def discover_gift_collections(session: aiohttp.ClientSession) -> list[dict]:
    """Récupère toutes les collections Telegram Gift depuis GetGems GraphQL."""
    global _gift_collections_cache, _gift_collections_ts
    if time.time() - _gift_collections_ts < 1800 and _gift_collections_cache:
        return _gift_collections_cache

    data = await gg_query(session, _GG_GIFTS_COLLECTIONS_QUERY)
    if not data:
        return _gift_collections_cache or []

    items = (data.get("alphaNftCollections") or {}).get("items") or []
    result = []
    for item in items:
        addr   = item.get("address", "")
        name   = item.get("name", "Telegram Gift")
        active = (item.get("counters") or {}).get("activeAuctions", 0)
        floor_val = (item.get("floorPrice") or {}).get("value")
        floor_ton = int(floor_val) / 1e9 if floor_val else 0.0
        if addr and active > 0:
            result.append({
                "address":     addr,
                "name":        name,
                "floor_ton":   floor_ton,
                "total_sales": item.get("totalSales", 0) or 0,
                "items_count": item.get("itemsCount", 0) or 0,
                "active_auctions": active,
            })

    _gift_collections_cache = result
    _gift_collections_ts = time.time()
    log.info(f"🎁 {len(result)} collections Telegram Gift découvertes (GetGems GQL)")
    return result


async def get_gift_sales_gg(session: aiohttp.ClientSession, col_address: str) -> list[dict]:
    """Récupère les ventes fix_price d'une collection Gift via GetGems GraphQL."""
    listings: list[dict] = []
    cursor: str | None = None

    for _ in range(5):
        variables: dict = {"addr": col_address}
        if cursor:
            variables["cursor"] = cursor

        data = await gg_query(session, _GG_COLLECTION_SALES_QUERY, variables)
        if not data:
            break

        sales_data = (data.get("alphaNftSalesByCollection") or {})
        for sale in (sales_data.get("items") or []):
            price_nano = int(sale.get("fullPrice", 0) or 0)
            if price_nano <= 0:
                continue
            nft       = sale.get("nft") or {}
            addr      = nft.get("address") or sale.get("nftAddress", "")
            name      = nft.get("name", "Telegram Gift")
            previews  = nft.get("previews") or []
            image_url = previews[-1]["url"] if previews else ""
            friendly  = ton_raw_to_friendly(addr)
            listings.append({
                "address":   friendly,
                "name":      name,
                "price_ton": price_nano / 1e9,
                "image_url": image_url,
                "link":      f"https://getgems.io/nft/{friendly}",
                "source":    "getgems_gift",
            })

        page_info = sales_data.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    return listings


async def scan_telegram_gifts(session: aiohttp.ClientSession) -> int:
    """
    Cycle complet : découverte des collections Gift + détection de deals.
    Retourne le nombre de deals trouvés.
    """
    collections = await discover_gift_collections(session)
    if not collections:
        return 0

    deals_found = 0
    for col in collections:
        col_addr  = col["address"]
        col_name  = col["name"]
        floor_gql = col.get("floor_ton", 0.0)

        try:
            listings = await get_gift_sales_gg(session, col_addr)
            if len(listings) < 2:
                continue

            floor_ton = floor_gql if floor_gql > 0 else compute_virtual_floor(listings)
            if floor_ton <= 0:
                continue

            await cache_floor(col_addr, col_name, floor_ton, 0.0, len(listings))
            await auto_add_to_watchlist(col_addr, col_name)
            trend = await get_floor_trend(col_addr)

            log.info(f"  🎁 {col_name}: {len(listings)} ventes | floor={floor_ton:.4f} TON")

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

                score    = compute_score(discount, floor_ton, 0.0, trend)
                priority = compute_priority(discount)

                emoji = {"extreme": "🔴", "high": "🟠"}.get(priority, "🟢")
                log.info(
                    f"  {emoji} [GIFT] {item['name']} @ {price:.4f} TON "
                    f"(floor {floor_ton:.4f}) -{discount:.1f}% | score {score}"
                )

                await mark_as_alerted(
                    address, item["name"], col_name,
                    price, floor_ton, round(discount, 1),
                    score=score, priority=priority,
                    image_url=item.get("image_url", ""),
                    source="getgems_gift",
                    buy_link=item["link"],
                )
                deals_found += 1

        except Exception as e:
            log.error(f"Erreur scan Gift {col_name}: {e}")

    return deals_found


# ─── SCANNER FRAGMENT.COM (Telegram Gifts & NFTs) ────────────────────────────

# Slugs de cadeaux Telegram connus sur Fragment (rotatifs entre cycles)
_FRAGMENT_GIFT_SLUGS: list[str] = [
    "star", "heart", "cake", "peach", "ring", "bear", "cookie",
    "balloon", "plush-peach", "jelly-bunny", "eternal-rose",
    "spooky-lamp", "diamond-ring", "loot-bag", "signet-ring",
    "vintage-cigar", "christmas-tree", "crystal-ball", "trophy",
    "candle", "flame", "bouquet", "kiss", "kiss-mark", "hamster",
]
_fragment_floor_cache: dict[str, float] = {}
_fragment_slug_idx: int = 0  # rotation circulaire
_last_fragment_scan: float = 0.0


async def scan_fragment_gifts(session: aiohttp.ClientSession, max_price_ton: float = 0.0) -> int:
    """
    Scan partiel de Fragment.com pour les Telegram Gifts.
    Tente d'extraire les prix via le JSON Next.js intégré dans le HTML.
    Retourne le nombre de deals trouvés.
    max_price_ton : si > 0, ignore les items dont le prix dépasse ce seuil.
    """
    global _fragment_slug_idx, _fragment_floor_cache

    import re as _re
    import json as _json_mod

    deals_found = 0
    headers = {
        "User-Agent":      get_ua(),
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Referer":         "https://fragment.com/",
    }

    # Scanne 6 slugs par cycle en rotation (évite le ban)
    batch = []
    for _ in range(6):
        batch.append(_FRAGMENT_GIFT_SLUGS[_fragment_slug_idx % len(_FRAGMENT_GIFT_SLUGS)])
        _fragment_slug_idx += 1

    for slug in batch:
        try:
            url = f"https://fragment.com/gift/{slug}"
            async with session.get(url, headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=12)) as resp:
                if resp.status == 404:
                    continue
                if resp.status != 200:
                    log.debug(f"Fragment /{slug}: HTTP {resp.status}")
                    continue
                html = await resp.text()

            # Essaie d'extraire le JSON Next.js ou des prix en TON
            prices: list[float] = []

            # Approche 1 : JSON dans script#__NEXT_DATA__
            m = _re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.+?)</script>',
                           html, _re.DOTALL)
            if m:
                try:
                    nd = _json_mod.loads(m.group(1))
                    # Cherche les prix dans la hiérarchie props.pageProps
                    def _extract_prices(obj):
                        if isinstance(obj, dict):
                            for k, v in obj.items():
                                if k in ("price", "tonPrice", "amount", "fullPrice") and isinstance(v, (int, float, str)):
                                    try:
                                        p = float(str(v).replace(",", "."))
                                        # Fragment retourne les prix en nano-TON si > 1e6
                                        if p > 1_000_000:
                                            p /= 1e9
                                        if 0.001 < p < 100_000:
                                            prices.append(p)
                                    except Exception:
                                        pass
                                else:
                                    _extract_prices(v)
                        elif isinstance(obj, list):
                            for i in obj:
                                _extract_prices(i)
                    _extract_prices(nd)
                except Exception:
                    pass

            # Approche 2 : regex sur les montants TON dans le HTML
            if not prices:
                for m2 in _re.finditer(r'([\d]+(?:[.,]\d+)?)\s*TON', html):
                    try:
                        p = float(m2.group(1).replace(",", "."))
                        if 0.01 < p < 100_000:
                            prices.append(p)
                    except Exception:
                        pass

            if not prices:
                await asyncio.sleep(1.5)
                continue

            prices.sort()
            min_price = prices[0]

            # Floor = médiane des prix observés (mise en cache entre cycles)
            if slug not in _fragment_floor_cache or _fragment_floor_cache[slug] <= 0:
                n = len(prices)
                _fragment_floor_cache[slug] = prices[n // 2] if n >= 2 else min_price * 1.3

            floor_ton = _fragment_floor_cache[slug]
            # Actualise progressivement le floor (moyenne mobile)
            _fragment_floor_cache[slug] = floor_ton * 0.85 + prices[len(prices) // 2] * 0.15

            if floor_ton <= 0 or min_price >= floor_ton:
                await asyncio.sleep(1.5)
                continue

            # Filtre prix max (si configuré)
            if max_price_ton > 0 and min_price > max_price_ton:
                await asyncio.sleep(1.5)
                continue

            discount = (floor_ton - min_price) / floor_ton * 100
            if discount < DEAL_THRESHOLD:
                await asyncio.sleep(1.5)
                continue

            score    = compute_score(discount, floor_ton, 0.0, 0.0)
            priority = compute_priority(discount)
            gift_name = slug.replace("-", " ").title()
            fake_addr = f"fragment:{slug}:{round(min_price, 4)}"

            if not await is_already_alerted(fake_addr):
                emoji = {"extreme": "🔴", "high": "🟠"}.get(priority, "🟢")
                log.info(
                    f"  {emoji} [FRAGMENT] {gift_name} @ {min_price:.4f} TON "
                    f"(floor {floor_ton:.4f}) -{discount:.1f}%"
                )
                await mark_as_alerted(
                    fake_addr, f"🎁 {gift_name}", f"Fragment — {gift_name}",
                    min_price, floor_ton, round(discount, 1),
                    score=score, priority=priority,
                    image_url="",
                    source="fragment",
                    buy_link=f"https://fragment.com/gift/{slug}",
                )
                deals_found += 1

            await asyncio.sleep(2.0)  # Respecte le rate-limit Fragment

        except Exception as e:
            log.debug(f"Fragment scan {slug}: {e}")

    return deals_found


# ─── SCAN TOP GIFTS : top N collections par volume ──────────────────────────

async def scan_top_gifts(
    session: aiohttp.ClientSession,
    top_n: int = 20,
    max_price_ton: float = 0.0,
) -> int:
    """
    Scan approfondi des top_n collections Telegram Gift les plus actives sur GetGems.
    Trie les collections par volume_7d décroissant (ou item_count si volume absent).
    Récupère jusqu'à 50 listings par collection et détecte les deals.
    Retourne le nombre de deals trouvés.
    """
    # 1. Découverte de toutes les collections Gift
    all_cols = await discover_gift_collections(session)
    if not all_cols:
        return 0

    # 2. Trie par total_sales décroissant (= volume d'échanges historique)
    #    puis par active_auctions comme tie-breaker
    def _sort_key(c):
        sales   = c.get("total_sales", 0) or 0
        active  = c.get("active_auctions", 0) or 0
        return (sales, active)

    sorted_cols = sorted(all_cols, key=_sort_key, reverse=True)
    top_cols = sorted_cols[:top_n]

    log.info(f"🏆 Top Gifts scan: {len(top_cols)} collections sélectionnées sur {len(all_cols)}")

    deals_found = 0
    for col in top_cols:
        col_addr  = col["address"]
        col_name  = col["name"]
        floor_gql = col.get("floor_ton", 0.0)

        try:
            # Récupère jusqu'à 100×5 ventes (pagination complète via get_gift_sales_gg)
            listings = await get_gift_sales_gg(session, col_addr)
            if len(listings) < 2:
                continue

            floor_ton = floor_gql if floor_gql > 0 else compute_virtual_floor(listings)
            if floor_ton <= 0:
                continue

            await cache_floor(col_addr, col_name, floor_ton, 0.0, len(listings))
            await auto_add_to_watchlist(col_addr, col_name)
            trend = await get_floor_trend(col_addr)

            log.info(f"  🏆 [TopGift] {col_name}: {len(listings)} ventes | floor={floor_ton:.4f} TON")

            for item in listings:
                price = item["price_ton"]
                if price <= 0 or price >= floor_ton:
                    continue
                # Filtre prix max
                if max_price_ton > 0 and price > max_price_ton:
                    continue

                discount = (floor_ton - price) / floor_ton * 100
                if discount < DEAL_THRESHOLD:
                    continue

                address = item["address"]
                if await is_already_alerted(address):
                    continue

                score    = compute_score(discount, floor_ton, 0.0, trend)
                priority = compute_priority(discount)

                emoji = {"extreme": "🔴", "high": "🟠"}.get(priority, "🟢")
                log.info(
                    f"    {emoji} [TopGift] {item['name']} @ {price:.4f} TON "
                    f"(floor {floor_ton:.4f}) -{discount:.1f}% | score {score}"
                )

                buy_link = item.get("link", f"https://getgems.io/nft/{address}")
                await mark_as_alerted(
                    address, item["name"], col_name,
                    price, floor_ton, round(discount, 1),
                    score=score, priority=priority,
                    image_url=item.get("image_url", ""),
                    source="tg_gifts",
                    buy_link=buy_link,
                )
                deals_found += 1

        except Exception as e:
            log.debug(f"TopGifts scan {col_name}: {e}")

    return deals_found


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
        "💎 <b>GetGems NFT Sniper</b>\n\n"
        "Je surveille les NFT sous-évalués sur GetGems en temps réel.\n"
        "Ouvre le dashboard pour voir les deals, les tendances et configurer le bot.",
        parse_mode=ParseMode.HTML,
        reply_markup=kb,
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
        "title": "TON dépasse 10M de wallets actifs — record historique pour la blockchain",
        "url": "https://ton.org/en/blog/10m-wallets",
        "summary": "La blockchain TON franchit le cap des 10 millions de wallets actifs mensuels, portée par l'explosion des TON Gifts et l'intégration native dans Telegram. Un jalon majeur pour l'écosystème.",
        "source": "TON Foundation",
        "category": "milestone",
        "published_at": "2026-03-01T00:00:00",
    },
    {
        "title": "GetGems dépasse 500M$ de volume cumulé — la marketplace NFT TON s'impose",
        "url": "https://getgems.io",
        "summary": "GetGems, la principale marketplace NFT de l'écosystème TON, annonce avoir dépassé 500 millions de dollars de volume cumulé. Les TON Gifts représentent désormais plus de 60% du volume total.",
        "source": "GetGems",
        "category": "milestone",
        "published_at": "2026-02-20T00:00:00",
    },
    {
        "title": "Telegram Gifts 2.0 : les cadeaux animés arrivent sur la blockchain TON",
        "url": "https://telegram.org/blog/gifts-2",
        "summary": "Telegram lance la deuxième génération de TON Gifts avec des animations exclusives et des effets visuels améliorés. Les nouveaux cadeaux animés déclenchent immédiatement un engouement massif sur GetGems.",
        "source": "Telegram",
        "category": "launch",
        "published_at": "2026-02-10T00:00:00",
    },
    {
        "title": "NFT Crafting officiel : fusionnez vos cadeaux pour créer des NFT légendaires",
        "url": "https://ton.org/en/blog/gifts-crafting",
        "summary": "Telegram déploie officiellement le système de crafting NFT : il est maintenant possible de combiner plusieurs TON Gifts pour générer des collections exclusives à rareté contrôlée. Les prix des matériaux s'envolent.",
        "source": "Telegram",
        "category": "feature",
        "published_at": "2026-01-28T00:00:00",
    },
    {
        "title": "Khabib Nurmagomedov — la collection Papakha établit un record de mint en 24h",
        "url": "https://getgems.io/collection/papakha",
        "summary": "La collection NFT 'Papakha' lancée par la légende du MMA Khabib Nurmagomedov bat tous les records de la marketplace GetGems avec plus de 45 000 TON échangés lors des premières 24 heures.",
        "source": "GetGems",
        "category": "milestone",
        "published_at": "2025-11-10T00:00:00",
    },
    {
        "title": "TON Gifts : 2,18M de détenteurs — l'écosystème NFT de Telegram explose",
        "url": "https://ton.org/en/blog/ton-gifts-milestone",
        "summary": "L'écosystème TON Gifts atteint des sommets historiques avec 2,18 millions de détenteurs uniques et 312 millions de dollars de volume total. Telegram devient l'une des plus grandes plateformes NFT au monde.",
        "source": "TON Foundation",
        "category": "milestone",
        "published_at": "2025-11-15T00:00:00",
    },
    {
        "title": "Toncoin intégré nativement dans Telegram — paiement direct en TON",
        "url": "https://telegram.org/blog/toncoin-gifts",
        "summary": "Telegram officialise l'intégration native du Toncoin (TON) pour l'achat et le transfert de cadeaux numériques. Cette intégration expose le TON à plus de 900 millions d'utilisateurs Telegram.",
        "source": "Telegram",
        "category": "feature",
        "published_at": "2025-09-15T00:00:00",
    },
    {
        "title": "TON Society : le programme de récompenses communautaires de TON Foundation",
        "url": "https://society.ton.org",
        "summary": "TON Foundation lance TON Society, un programme incitatif récompensant les contributeurs actifs de l'écosystème en Toncoin. Développeurs, créateurs et traders peuvent désormais gagner des récompenses.",
        "source": "TON Foundation",
        "category": "ecosystem",
        "published_at": "2025-08-01T00:00:00",
    },
    {
        "title": "Rumeur : un système de staking de NFT sur GetGems en préparation",
        "url": "https://getgems.io",
        "summary": "Des indices dans le code source de GetGems suggèrent l'arrivée prochaine d'un système de staking permettant de générer des revenus passifs en TON en immobilisant ses NFT sur la plateforme.",
        "source": "Communauté TON",
        "category": "rumor",
        "published_at": "2026-03-15T00:00:00",
    },
    {
        "title": "TON Punks — la collection OG de TON retrouve son ATH après 18 mois",
        "url": "https://getgems.io/collection/ton-punks",
        "summary": "La collection TON Punks, référence historique de l'écosystème NFT sur TON, retrouve son plus haut historique de floor price alimenté par l'engouement général pour les NFT Telegram.",
        "source": "GetGems",
        "category": "milestone",
        "published_at": "2026-01-05T00:00:00",
    },
]

RSS_SOURCES = [
    ("https://fr.cointelegraph.com/rss",                 "CoinTelegraph FR"),
    ("https://journalducoin.com/feed/",                  "Journal du Coin"),
    ("https://cryptoast.fr/feed/",                       "Cryptoast"),
]

async def seed_initial_news():
    """Insère les actualités initiales si la table est vide."""
    async with aiosqlite.connect(DB_PATH) as db:
        inserted = 0
        for n in INITIAL_NEWS:
            cur = await db.execute("""
                INSERT OR IGNORE INTO news (title, url, summary, source, category, published_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (n["title"], n["url"], n["summary"], n["source"], n["category"], n["published_at"]))
            if cur.rowcount:
                inserted += 1
        await db.commit()
        if inserted:
            log.info(f"✅ {inserted} actualité(s) initiale(s) ajoutée(s)")

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

    connector = aiohttp.TCPConnector(ssl=False, limit=5)
    scan_count = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        while True:
            t0 = time.time()
            scan_count += 1
            deals_found = 0

            # ── Charge la config runtime (peut changer entre deux cycles) ────
            await load_runtime_config()
            scan_types  = _runtime_config.get("scan_types", ["getgems", "tg_gifts", "fragment"])
            max_price   = float(_runtime_config.get("max_price_ton", 0.0))

            # ── Refresh actualités toutes les heures ─────────────────────
            await maybe_refresh_news(session)

            # ── Scan Top Telegram Gift NFTs (top N collections par volume) ───
            if "tg_gifts" in scan_types:
                top_n = int(_runtime_config.get("top_gifts_count", 20))
                gift_deals = await scan_top_gifts(session, top_n=top_n, max_price_ton=max_price)
                if gift_deals:
                    log.info(f"🎁 {gift_deals} deal(s) Telegram Gift (Top {top_n}) trouvé(s)")
                    deals_found += gift_deals

            # ── Scan Fragment.com (best effort) ──────────────────────────────
            if "fragment" in scan_types:
                frag_deals = await scan_fragment_gifts(session, max_price_ton=max_price)
                if frag_deals:
                    log.info(f"💎 Fragment: {frag_deals} deal(s) trouvé(s)")
                    deals_found += frag_deals

            # ── Scan GetGems via TonAPI (activé si "getgems" dans scan_types) ──
            if "getgems" not in scan_types:
                # Mise à jour quand même du diag pour ne pas bloquer l'affichage
                _scan_diagnostics.update({
                    "cycle": scan_count, "collections_total": 0,
                    "collections_scanned": 0, "collections_with_listings": 0,
                    "items_getgems": 0, "items_below_floor": 0,
                    "items_qualifying": 0, "deals_found": deals_found,
                    "tonapi_errors": 0, "tonapi_rate_limited": False,
                    "last_collection_scanned": "", "last_collection_listings": 0,
                    "sample_prices": [], "sample_floor": 0.0, "ts": time.time(),
                })
                await increment_scan()
                elapsed = time.time() - t0
                sleep_for = max(1.0, SCAN_INTERVAL - elapsed)
                await asyncio.sleep(sleep_for)
                continue

            # ── Redécouverte des collections toutes les 30 min ──────────────
            if time.time() - _last_discovery > 1800 or not _discovered_collections:
                collections = await discover_getgems_collections(session, pages=5)
                log.info(f"📋 {len(collections)} collections GetGems découvertes via TonAPI")
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
            log.info(f"🔍 Scan #{scan_count}: {len(batch)}/{len(collections)} collections | seuil={DEAL_THRESHOLD}% | max_prix={'∞' if max_price == 0 else f'{max_price:.0f} TON'} | clé={'OUI' if TONAPI_KEY else 'NON'}")

            # Compteurs de diagnostic pour ce cycle
            diag_cols_with_listings = 0
            diag_items_fetched = 0
            diag_items_gg = 0
            diag_items_below_floor = 0
            diag_items_qualifying = 0
            diag_errors = 0
            sample_col = ""
            sample_prices: list[float] = []
            sample_floor = 0.0

            for col in batch:
                col_address = col.get("address", "")
                col_name    = (col.get("metadata") or {}).get("name", col_address[:20])

                if not col_address:
                    continue

                try:
                    listings = await get_collection_listings(session, col_address)

                    diag_items_gg += len(listings)

                    if len(listings) < 2:
                        if listings:
                            log.debug(f"  ↳ {col_name}: {len(listings)} listing(s) GetGems — insuffisant (<2)")
                        continue  # Pas assez de données

                    diag_cols_with_listings += 1

                    # Floor virtuel = médiane des prix en vente
                    floor_ton  = compute_virtual_floor(listings)
                    volume_ton = 0.0
                    trend      = await get_floor_trend(col_address)

                    if floor_ton <= 0:
                        log.debug(f"  ↳ {col_name}: floor=0 (listings vides)")
                        continue

                    log.info(f"  ↳ {col_name}: {len(listings)} listings GetGems | floor={floor_ton:.3f} TON")

                    # Cache pour les stats du dashboard
                    await cache_floor(col_address, col_name, floor_ton, volume_ton, len(listings))

                    # Watchlist automatique
                    await auto_add_to_watchlist(col_address, col_name)

                    # Sauvegarde le premier exemple pour le diagnostic
                    if not sample_col:
                        sample_col = col_name
                        sample_prices = sorted(l["price_ton"] for l in listings)[:10]
                        sample_floor = floor_ton

                    col_deals = 0
                    for item in listings:
                        price = item["price_ton"]
                        if price <= 0 or price >= floor_ton:
                            continue
                        # Filtre prix max (si configuré dans les settings)
                        if max_price > 0 and price > max_price:
                            continue

                        diag_items_below_floor += 1
                        discount = (floor_ton - price) / floor_ton * 100
                        if discount < DEAL_THRESHOLD:
                            continue

                        diag_items_qualifying += 1

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
                            f"{emoji} DEAL: {item['name']} "
                            f"@ {price:.4f} TON (floor {floor_ton:.4f}) "
                            f"-{discount:.1f}% | score {score}"
                        )

                        await mark_as_alerted(
                            address, item["name"], col_name,
                            price, floor_ton, round(discount, 1),
                            score=score, priority=priority,
                            image_url=item.get("image_url", ""),
                            source=item.get("source", "getgems"),
                            buy_link=item.get("link", ""),
                        )
                        deals_found += 1
                        col_deals += 1

                    if diag_items_below_floor > 0 and col_deals == 0:
                        log.info(f"    → {diag_items_below_floor} items sous floor, 0 qualifié (seuil {DEAL_THRESHOLD}%)")

                except Exception as e:
                    log.error(f"Erreur scan {col_name}: {e}", exc_info=True)
                    diag_errors += 1

            # ── Mise à jour du diagnostic global ─────────────────────────────
            _scan_diagnostics.update({
                "cycle": scan_count,
                "collections_total": len(collections),
                "collections_scanned": len(batch),
                "collections_with_listings": diag_cols_with_listings,
                "items_getgems": diag_items_gg,
                "items_below_floor": diag_items_below_floor,
                "items_qualifying": diag_items_qualifying,
                "deals_found": deals_found,
                "tonapi_errors": diag_errors,
                "tonapi_rate_limited": time.time() < _tonapi_rate_limited_until,
                "last_collection_scanned": sample_col,
                "last_collection_listings": len(sample_prices),
                "sample_prices": sample_prices,
                "sample_floor": sample_floor,
                "ts": time.time(),
            })

            await increment_scan()
            elapsed = time.time() - t0
            log.info(
                f"✅ Cycle #{scan_count} terminé en {elapsed:.1f}s | "
                f"{deals_found} deal(s) | {diag_cols_with_listings}/{len(batch)} cols avec listings | "
                f"{diag_items_gg} items GetGems | {diag_items_below_floor} sous floor | "
                f"{diag_items_qualifying} qualifiés"
            )

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
               COALESCE(score, 0), COALESCE(priority, 'normal'),
               COALESCE(image_url, ''), COALESCE(source, 'getgems'), COALESCE(buy_link, '')
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
        floor    = r[5] or 1
        price    = r[4] or 0
        disc     = r[6] or 0
        score    = r[8] or compute_score(disc, floor, 0)
        prio_val = r[9] or compute_priority(disc)
        img      = r[10] or ""
        source   = r[11] or "getgems"
        buy_link = r[12] or ""
        addr     = r[1] or ""
        # Utilise le lien stocké si disponible, sinon génère un lien GetGems
        if not buy_link:
            if source == "fragment":
                buy_link = f"https://fragment.com/nft/{ton_raw_to_friendly(addr)}"
            else:
                buy_link = f"https://getgems.io/nft/{ton_raw_to_friendly(addr)}"
        deals.append({
            "id":             r[0],
            "nftName":        r[2],
            "collectionName": r[3],
            "currentPrice":   price,
            "floorPrice":     floor,
            "discountPercent": round(disc, 1),
            "score":          score,
            "priority":       prio_val,
            "source":         source,
            "link":           buy_link,
            "imageUrl":       img if img else None,
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
        "link":           f"https://getgems.io/nft/{ton_raw_to_friendly(r[1])}",
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
async def handle_debug_scan(req):
    """Expose les diagnostics du dernier cycle de scan."""
    global _scan_diagnostics
    diag = dict(_scan_diagnostics)
    diag["tonapi_key_set"] = bool(TONAPI_KEY)
    diag["deal_threshold"] = DEAL_THRESHOLD
    diag["scan_interval"] = SCAN_INTERVAL
    diag["max_per_cycle"] = MAX_COLLECTIONS_PER_CYCLE
    diag["age_seconds"] = round(time.time() - diag["ts"], 1) if diag["ts"] else None
    diag["rate_limit_remaining_s"] = max(0, round(_tonapi_rate_limited_until - time.time(), 1))
    return json_resp(diag)

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
    return json_resp({"ok": True, "message": "Modifiez les variables d'environnement Railway pour changer la config."})

# ── GET /api/scan/config ──
async def handle_scan_config_get(req):
    """Retourne la config runtime du scan (types + prix max)."""
    cfg = await load_runtime_config()
    return json_resp({
        "scanTypes":     cfg.get("scan_types", ["getgems", "tg_gifts", "fragment"]),
        "maxPriceTon":   cfg.get("max_price_ton", 0.0),
        "topGiftsCount": cfg.get("top_gifts_count", 20),
    })

# ── PUT /api/scan/config ──
async def handle_scan_config_put(req):
    """Met à jour la config runtime du scan."""
    try:
        body = await req.json()
    except Exception:
        return json_resp({"error": "JSON invalide"}, status=400)

    updated = {}

    if "scanTypes" in body:
        valid  = {"getgems", "tg_gifts", "fragment"}
        types  = [t for t in (body["scanTypes"] or []) if t in valid]
        if not types:
            types = list(valid)  # au moins un type activé
        await save_runtime_config_key("scan_types", types)
        updated["scanTypes"] = types

    if "maxPriceTon" in body:
        try:
            max_p = max(0.0, float(body["maxPriceTon"]))
        except (TypeError, ValueError):
            max_p = 0.0
        await save_runtime_config_key("max_price_ton", max_p)
        updated["maxPriceTon"] = max_p

    if "topGiftsCount" in body:
        try:
            cnt = max(5, min(100, int(body["topGiftsCount"])))
        except (TypeError, ValueError):
            cnt = 20
        await save_runtime_config_key("top_gifts_count", cnt)
        updated["topGiftsCount"] = cnt

    return json_resp({"ok": True, **updated})

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
    app.router.add_get("/api/debug/scan",            handle_debug_scan)
    app.router.add_get("/api/scan/config",           handle_scan_config_get)
    app.router.add_put("/api/scan/config",           handle_scan_config_put)
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
        # Supprime toutes les commandes du menu "/" — tout passe par le dashboard
        try:
            await bot.delete_my_commands()
            log.info("✅ Menu de commandes Telegram effacé")
        except Exception as e:
            log.warning(f"Impossible d'effacer les commandes: {e}")

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
