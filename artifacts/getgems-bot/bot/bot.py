#!/usr/bin/env python3
"""
GetGems NFT Sniper Bot — Version Ultra-Rapide
===============================================
Stack : aiogram 3.x | aiohttp | aiosqlite | aiohttp.web (keep-alive)
API   : GraphQL public GetGems (https://api.getgems.io/graphql)
"""

import asyncio
import logging
import os
import random
import time
from datetime import datetime

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
SCAN_INTERVAL      = int(os.getenv("SCAN_INTERVAL", "7"))        # secondes
DEAL_THRESHOLD     = float(os.getenv("DEAL_THRESHOLD", "30"))    # % réduction → bon deal
PRIORITY_THRESHOLD = float(os.getenv("PRIORITY_THRESHOLD", "50")) # % réduction → prioritaire
DB_PATH            = os.getenv("DB_PATH", "sniper.db")
KEEPALIVE_PORT     = int(os.getenv("PORT", "8080"))               # Replit lit $PORT
# URL publique du dashboard (Mini App Telegram)
# Ex: https://monapp.railway.app/getgems-bot
MINI_APP_URL       = os.getenv("MINI_APP_URL", "")

# API GraphQL GetGems (endpoint officiel, sans clé)
GETGEMS_GQL = "https://api.getgems.io/graphql"

# Collections de Gifts/NFTs à surveiller
COLLECTIONS = [
    "ton-gifts",
    "telegram-gifts",
    "getgems-gifts",
    "the-open-league",
    "ton-whales",
    "ton-punks",
    "mega-ton-whale",
    "animals-nft",
    "toncoin-gifts",
    "getgems-nft",
]

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

            CREATE TABLE IF NOT EXISTS stats (
                id          INTEGER PRIMARY KEY DEFAULT 1,
                total_scans INTEGER DEFAULT 0,
                total_alerts INTEGER DEFAULT 0,
                last_scan   TEXT
            );
        """)
        await db.execute("INSERT OR IGNORE INTO stats (id) VALUES (1)")
        await db.commit()
    log.info("✅ Base de données initialisée")

async def is_already_alerted(address: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM alerted_nfts WHERE nft_address = ?", (address,)
        ) as cursor:
            return await cursor.fetchone() is not None

async def mark_as_alerted(address: str, name: str, collection: str,
                           price: float, floor: float, discount: float):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR IGNORE INTO alerted_nfts
            (nft_address, nft_name, collection, price_ton, floor_ton, discount)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (address, name, collection, price, floor, discount))
        await db.execute(
            "UPDATE stats SET total_alerts = total_alerts + 1 WHERE id = 1"
        )
        await db.commit()

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

# ─── GRAPHQL CLIENT ───────────────────────────────────────────────────────────

def gql_headers() -> dict:
    return {
        "User-Agent": get_ua(),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://getgems.io",
        "Referer": "https://getgems.io/",
    }

async def gql_request(session: aiohttp.ClientSession, query: str, variables: dict = {}) -> dict | None:
    """POST GraphQL avec retry et délai aléatoire anti-ban."""
    for attempt in range(3):
        try:
            await asyncio.sleep(random.uniform(0.3, 1.5))
            async with session.post(
                GETGEMS_GQL,
                json={"query": query, "variables": variables},
                headers=gql_headers(),
                timeout=aiohttp.ClientTimeout(total=12),
                ssl=False,
            ) as resp:
                if resp.status == 429:
                    log.warning("⏳ Rate limited — pause 15s")
                    await asyncio.sleep(15)
                    continue
                if resp.status != 200:
                    log.debug(f"GQL HTTP {resp.status}")
                    continue
                data = await resp.json()
                return data.get("data")
        except asyncio.TimeoutError:
            log.debug(f"Timeout (essai {attempt + 1})")
            await asyncio.sleep(2 ** attempt)
        except Exception as e:
            log.debug(f"Erreur réseau: {e} (essai {attempt + 1})")
            await asyncio.sleep(2 ** attempt)
    return None

# ─── REQUÊTES GETGEMS ─────────────────────────────────────────────────────────

QUERY_FLOOR = """
query CollectionFloor($slug: String!) {
    alphaNftCollection(slug: $slug) {
        name
        approximateCount
        floorPrice
        volume24h
    }
}
"""

QUERY_LISTINGS = """
query CollectionListings($slug: String!, $first: Int!) {
    alphaNftItems(
        collectionSlug: $slug
        first: $first
        filter: { saleStatus: forSale }
        sort: { price: asc }
    ) {
        edges {
            node {
                address
                name
                previews { url }
                sale {
                    ... on NftSaleFixPrice {
                        fullPrice
                    }
                }
            }
        }
    }
}
"""

async def fetch_floor(session: aiohttp.ClientSession, slug: str) -> tuple[str, float, float, int] | None:
    """Retourne (name, floor_ton, volume_ton, item_count) ou None."""
    cached = await get_cached_floor(slug)
    if cached is not None:
        return (slug, cached, 0.0, 0)

    data = await gql_request(session, QUERY_FLOOR, {"slug": slug})
    if not data or not data.get("alphaNftCollection"):
        return None

    col = data["alphaNftCollection"]
    floor_ton  = int(col.get("floorPrice") or 0) / 1e9
    volume_ton = int(col.get("volume24h")  or 0) / 1e9
    count      = col.get("approximateCount", 0)
    name       = col.get("name", slug)

    if floor_ton <= 0:
        return None

    await cache_floor(slug, name, floor_ton, volume_ton, count)
    return (name, floor_ton, volume_ton, count)

async def fetch_listings(session: aiohttp.ClientSession, slug: str, limit: int = 30) -> list[dict]:
    """Retourne la liste des NFTs en vente triés par prix croissant."""
    data = await gql_request(session, QUERY_LISTINGS, {"slug": slug, "first": limit})
    if not data or "alphaNftItems" not in data:
        return []

    items = []
    for edge in data["alphaNftItems"].get("edges", []):
        node  = edge.get("node", {})
        sale  = node.get("sale", {})
        price = int(sale.get("fullPrice", 0) or 0)
        if price == 0:
            continue
        previews  = node.get("previews", [])
        image_url = previews[-1]["url"] if previews else ""
        items.append({
            "address":   node.get("address", ""),
            "name":      node.get("name", "NFT"),
            "price_ton": price / 1e9,
            "image_url": image_url,
            "link":      f"https://getgems.io/nft/{node.get('address', '')}",
        })
    return items

# ─── SCORE 0–100 ─────────────────────────────────────────────────────────────

def compute_score(discount: float, floor: float, volume: float) -> int:
    score = 0
    # Réduction (50 pts max)
    if discount >= 70:   score += 50
    elif discount >= 50: score += 40
    elif discount >= 30: score += 25
    else:                score += int(discount / 2)
    # Volume 24h (30 pts max)
    if volume >= 1000:   score += 30
    elif volume >= 100:  score += 20
    elif volume >= 10:   score += 10
    elif volume >= 1:    score += 5
    # Floor price (20 pts max)
    if floor >= 100:     score += 20
    elif floor >= 10:    score += 15
    elif floor >= 1:     score += 10
    elif floor >= 0.1:   score += 5
    return min(score, 100)

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
    text = "📋 <b>Collections surveillées:</b>\n\n"
    for slug in COLLECTIONS:
        text += f"• <code>{slug}</code>\n"
    text += f"\n<i>Seuil deal: -{DEAL_THRESHOLD}% | Priorité: -{PRIORITY_THRESHOLD}%</i>"
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

@dp.message(Command("floor"))
async def cmd_floor(message: types.Message):
    parts = (message.text or "").split()
    if len(parts) < 2:
        await message.answer("Usage: /floor &lt;collection-slug&gt;", parse_mode=ParseMode.HTML)
        return
    slug = parts[1].strip()
    await message.answer(f"🔍 Recherche du floor pour <code>{slug}</code>...", parse_mode=ParseMode.HTML)
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        result = await fetch_floor(session, slug)
        if result:
            name, floor, volume, count = result
            await message.answer(
                f"📊 <b>{name}</b>\n"
                f"Floor: <b>{floor:.4f} TON</b>\n"
                f"Volume 24h: {volume:.2f} TON\n"
                f"Items: {count}",
                parse_mode=ParseMode.HTML,
            )
        else:
            await message.answer(f"❌ Collection <code>{slug}</code> introuvable.", parse_mode=ParseMode.HTML)

async def send_alert(deal: dict):
    if not bot or not TELEGRAM_CHAT_ID:
        return
    header = "🚨 <b>ALERTE PRIORITAIRE</b> 🚨" if deal["priority"] == "high" else "💰 <b>BON DEAL DÉTECTÉ</b>"
    disc_emoji = "🔥" if deal["discount"] >= 50 else "✅"
    msg = (
        f"{header}\n\n"
        f"🎁 <b>{deal['name']}</b>\n"
        f"📂 Collection: <i>{deal['collection']}</i>\n\n"
        f"💎 Prix actuel: <b>{deal['price']:.4f} TON</b>\n"
        f"📊 Floor price: {deal['floor']:.4f} TON\n"
        f"{disc_emoji} Réduction: <b>-{deal['discount']:.1f}%</b>\n"
        f"⭐ Score: {score_bar(deal['score'])} ({deal['score']}/100)\n\n"
        f"<i>⏰ {datetime.now().strftime('%H:%M:%S')}</i>"
    )
    # Boutons : Acheter + Dashboard Mini App
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

# ─── BOUCLE DE SNIPING ────────────────────────────────────────────────────────

async def sniper_loop():
    log.info("🚀 Boucle de sniping démarrée")
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
                    f"• Collections: <b>{len(COLLECTIONS)}</b>\n\n"
                    f"📡 Surveillance active..."
                ),
                parse_mode=ParseMode.HTML,
            )
        except Exception as e:
            log.warning(f"Impossible d'envoyer le message de démarrage: {e}")

    connector = aiohttp.TCPConnector(ssl=False, limit=10)
    scan_count = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        while True:
            t0 = time.time()
            scan_count += 1
            deals_found = 0

            shuffled = COLLECTIONS[:]
            random.shuffle(shuffled)

            for slug in shuffled:
                try:
                    floor_data = await fetch_floor(session, slug)
                    if not floor_data:
                        continue

                    col_name, floor_ton, volume_ton, _ = floor_data

                    # Filtre anti-fake : ignorer collections mortes
                    if floor_ton <= 0:
                        continue

                    listings = await fetch_listings(session, slug)

                    for item in listings:
                        price = item["price_ton"]
                        if price <= 0 or price >= floor_ton:
                            continue

                        discount = (floor_ton - price) / floor_ton * 100
                        if discount < DEAL_THRESHOLD:
                            continue

                        address = item["address"]
                        # Anti-spam : déjà alerté ?
                        if await is_already_alerted(address):
                            continue

                        score    = compute_score(discount, floor_ton, volume_ton)
                        priority = "high" if discount >= PRIORITY_THRESHOLD else "normal"

                        deal = {
                            "address":    address,
                            "name":       item["name"],
                            "collection": col_name,
                            "price":      price,
                            "floor":      floor_ton,
                            "discount":   round(discount, 1),
                            "score":      score,
                            "priority":   priority,
                            "link":       item["link"],
                        }

                        log.info(
                            f"{'🚨' if priority == 'high' else '💎'} {item['name']} "
                            f"@ {price:.4f} TON (floor {floor_ton:.4f}) "
                            f"-{discount:.1f}% | score {score}"
                        )

                        await send_alert(deal)
                        await mark_as_alerted(address, item["name"], col_name,
                                               price, floor_ton, round(discount, 1))
                        deals_found += 1

                except Exception as e:
                    log.error(f"Erreur scan {slug}: {e}")

            await increment_scan()
            elapsed = time.time() - t0
            log.info(f"✅ Scan #{scan_count} en {elapsed:.1f}s | {deals_found} deal(s)")

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

# ── Healthcheck ──
async def handle_health(req):
    s = await get_stats()
    return json_resp({"status": "OK", "scans": s.get("scans", 0), "alerts": s.get("alerts", 0)})

# ── GET /api/deals ──
async def handle_deals(req):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT rowid, nft_address, nft_name, collection,
                   price_ton, floor_ton, discount, alerted_at
            FROM alerted_nfts ORDER BY alerted_at DESC LIMIT 50
        """) as cur:
            rows = await cur.fetchall()
    deals = []
    for r in rows:
        floor = r[5] or 1
        price = r[4] or 0
        disc  = r[6] or 0
        score = compute_score(disc, floor, 0)
        deals.append({
            "id": r[0],
            "nftName": r[2],
            "collectionName": r[3],
            "currentPrice": price,
            "floorPrice": floor,
            "discountPercent": round(disc, 1),
            "score": score,
            "priority": "high" if disc >= PRIORITY_THRESHOLD else "normal",
            "link": f"https://getgems.io/nft/{r[1]}",
            "imageUrl": None,
            "detectedAt": r[7],
        })
    return json_resp(deals)

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
    })

# ── PUT /api/bot/config ──
async def handle_bot_config(req):
    # La config vit dans les variables d'environnement sur Railway
    # On retourne juste un succès ici (les vraies configs sont dans Railway)
    return json_resp({"ok": True, "message": "Modifiez les variables d'environnement Railway pour changer la config."})

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

async def init_watchlist_table():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS watchlist (
                collection_slug  TEXT UNIQUE,
                collection_name  TEXT,
                alert_threshold  INTEGER DEFAULT 40,
                added_at         TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()

async def start_web_server():
    await init_watchlist_table()
    app = aiohttp.web.Application()

    # API routes
    app.router.add_get("/health",               handle_health)
    app.router.add_get("/api/deals",            handle_deals)
    app.router.add_get("/api/deals/stats",      handle_deal_stats)
    app.router.add_get("/api/collections",      handle_collections)
    app.router.add_get("/api/watchlist",        handle_watchlist_get)
    app.router.add_post("/api/watchlist",       handle_watchlist_post)
    app.router.add_delete("/api/watchlist/{id}", handle_watchlist_delete)
    app.router.add_get("/api/bot/status",       handle_bot_status)
    app.router.add_put("/api/bot/config",       handle_bot_config)
    app.router.add_route("OPTIONS", "/{path_info:.*}", handle_options)

    # Fichiers statiques React (tout le reste)
    app.router.add_get("/",                     handle_static)
    app.router.add_get("/{path_info:.*}",       handle_static)

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
