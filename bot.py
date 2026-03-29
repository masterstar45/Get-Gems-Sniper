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
from fake_useragent import UserAgent

# ─── CONFIG ──────────────────────────────────────────────────────────────────

TELEGRAM_TOKEN     = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")
SCAN_INTERVAL      = int(os.getenv("SCAN_INTERVAL", "7"))        # secondes
DEAL_THRESHOLD     = float(os.getenv("DEAL_THRESHOLD", "30"))    # % réduction → bon deal
PRIORITY_THRESHOLD = float(os.getenv("PRIORITY_THRESHOLD", "50")) # % réduction → prioritaire
DB_PATH            = os.getenv("DB_PATH", "sniper.db")
KEEPALIVE_PORT     = int(os.getenv("PORT", "8080"))               # Replit lit $PORT

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

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer(
        "🤖 <b>GetGems NFT Sniper actif!</b>\n\n"
        "Commandes disponibles:\n"
        "• /deals — Derniers deals détectés\n"
        "• /watchlist — Collections surveillées\n"
        "• /stats — Statistiques du bot\n"
        "• /floor &lt;slug&gt; — Floor d'une collection",
        parse_mode=ParseMode.HTML,
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
    emoji = "🚨" if deal["priority"] == "high" else "💰"
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
        f"🔗 <a href=\"{deal['link']}\">Acheter maintenant</a>\n\n"
        f"<i>⏰ {datetime.now().strftime('%H:%M:%S')}</i>"
    )
    try:
        await bot.send_message(
            chat_id=TELEGRAM_CHAT_ID,
            text=msg,
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=False,
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

# ─── SERVEUR KEEP-ALIVE (aiohttp.web) ────────────────────────────────────────
# Indispensable sur Replit gratuit : UptimeRobot peut pinger cette URL
# pour empêcher le bot de s'endormir.

async def keepalive_handler(request: aiohttp.web.Request) -> aiohttp.web.Response:
    s = await get_stats()
    return aiohttp.web.json_response({
        "status": "OK",
        "scans":  s.get("scans", 0),
        "alerts": s.get("alerts", 0),
        "last_scan": s.get("last_scan"),
    })

async def start_keepalive_server():
    app = aiohttp.web.Application()
    app.router.add_get("/",      keepalive_handler)
    app.router.add_get("/health", keepalive_handler)
    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, "0.0.0.0", KEEPALIVE_PORT)
    await site.start()
    log.info(f"🌐 Serveur keep-alive démarré sur le port {KEEPALIVE_PORT}")

# ─── POINT D'ENTRÉE ──────────────────────────────────────────────────────────

async def main():
    global bot

    if not TELEGRAM_TOKEN:
        log.warning("⚠️  TELEGRAM_BOT_TOKEN non défini — alertes Telegram désactivées")
    else:
        bot = Bot(token=TELEGRAM_TOKEN)

    await init_db()

    # Keep-alive non-bloquant (se lance en arrière-plan)
    await start_keepalive_server()

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
