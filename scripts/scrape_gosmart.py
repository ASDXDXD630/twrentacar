"""
GoSmart (格上) 站點爬蟲
使用 Playwright 開啟 GoSmart 網頁地圖，攔截站點資料 API 請求
"""
import asyncio
import json
import re
import sys
import math
from pathlib import Path
from playwright.async_api import async_playwright

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "gosmart_stations.json"

GOSMART_URLS = [
    "https://www.gosmart.com.tw/",
    "https://www.car-plus.com.tw/gosmart",
    "https://gosmart.car-plus.com.tw/",
]


async def scrape_gosmart_stations() -> list[dict]:
    all_stations = []
    captured = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            viewport={"width": 390, "height": 844},
            locale="zh-TW"
        )
        page = await context.new_page()

        async def handle_response(response):
            url = response.url
            try:
                ct = response.headers.get("content-type", "")
                if "json" in ct:
                    body = await response.body()
                    text = body.decode("utf-8", errors="replace")
                    if len(text) > 50 and ('"lat"' in text.lower() or '"latitude"' in text.lower() or '"hub"' in text.lower()):
                        print(f"  [CAPTURED] {url[:80]}")
                        captured.append({"url": url, "body": text})
            except Exception:
                pass

        page.on("response", handle_response)

        for url in GOSMART_URLS:
            print(f"Trying: {url}")
            try:
                await page.goto(url, wait_until="networkidle", timeout=25000)
                await asyncio.sleep(4)
            except Exception as e:
                print(f"  Error: {e}")
                continue

        for resp in captured:
            stations = _parse_stations(resp["body"])
            if stations:
                print(f"  Parsed {len(stations)} from {resp['url'][:60]}")
                all_stations.extend(stations)

        await browser.close()

    return _dedup(all_stations)


def _parse_stations(text: str) -> list[dict]:
    """解析 GoSmart 站點資料"""
    stations = []
    try:
        data = json.loads(text)
    except Exception:
        return []

    def extract(obj, prefix=""):
        if isinstance(obj, list):
            for item in obj:
                extract(item)
        elif isinstance(obj, dict):
            lat_keys = ["lat", "latitude", "Lat", "LAT", "hub_lat", "stationLat"]
            lng_keys = ["lng", "lon", "longitude", "Lng", "LON", "hub_lng", "stationLng"]
            name_keys = ["name", "Name", "hub_name", "stationName", "title", "hub_title"]
            addr_keys = ["address", "Address", "addr", "hub_address", "stationAddress"]
            id_keys = ["id", "Id", "hub_id", "stationId", "code"]

            lat = next((obj[k] for k in lat_keys if k in obj), None)
            lng = next((obj[k] for k in lng_keys if k in obj), None)

            if lat is not None and lng is not None:
                try:
                    lat, lng = float(lat), float(lng)
                    if 21.5 <= lat <= 25.5 and 119.0 <= lng <= 122.5:
                        stations.append({
                            "id": next((obj[k] for k in id_keys if k in obj), None),
                            "name": str(next((obj[k] for k in name_keys if k in obj), "")),
                            "address": str(next((obj[k] for k in addr_keys if k in obj), "")),
                            "lat": lat,
                            "lng": lng
                        })
                except (ValueError, TypeError):
                    pass
            else:
                for v in obj.values():
                    extract(v)

    extract(data)
    return stations


def _dedup(stations):
    seen = set()
    out = []
    for s in stations:
        key = f"{s['lat']:.4f},{s['lng']:.4f}"
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def merge_with_existing(new_stations: list[dict], existing_file: Path) -> list[dict]:
    if existing_file.exists():
        with open(existing_file, "r", encoding="utf-8") as f:
            existing = json.load(f)
    else:
        existing = []

    def dist(a, b):
        R = 6371000
        phi1, phi2 = math.radians(a["lat"]), math.radians(b["lat"])
        dphi = math.radians(b["lat"] - a["lat"])
        dlam = math.radians(b["lng"] - a["lng"])
        x = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
        return 2 * R * math.asin(math.sqrt(x))

    added = 0
    for ns in new_stations:
        if not any(dist(ns, es) < 150 for es in existing):
            existing.append(ns)
            added += 1

    print(f"  新增 {added} 個 GoSmart 站點")
    return existing


async def main():
    print("=== GoSmart 站點爬蟲開始 ===\n")
    stations = await scrape_gosmart_stations()
    print(f"\n爬蟲取得 {len(stations)} 個站點")

    if stations:
        merged = merge_with_existing(stations, OUTPUT_FILE)
        with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"儲存完成：{len(merged)} 個站點")
    else:
        print("未取得任何站點（GoSmart 可能從此地區無法訪問）")
        # 不 exit(1)，GoSmart 無法訪問是已知問題


if __name__ == "__main__":
    asyncio.run(main())
