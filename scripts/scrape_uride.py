"""
URiDE (恣意) 站點爬蟲
策略：先嘗試公開 API，失敗則用 Playwright 攔截地圖頁請求
"""
import asyncio
import json
import math
import sys
import urllib.request
import urllib.error
from pathlib import Path
from playwright.async_api import async_playwright

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "uride_stations.json"

APIGW = "https://web-apigw.uridego.com.tw/sharecar-backstage-service/openapi/officialweb"
URIDE_MAP_URL = "https://www.uridego.com.tw/station-map"
URIDE_HOME_URL = "https://www.uridego.com.tw/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": "https://www.uridego.com.tw",
    "Referer": "https://www.uridego.com.tw/"
}


def fetch_via_api() -> list[dict]:
    """嘗試透過公開 API 取得站點（按地區查詢）"""
    all_stations = []

    # 取得所有地區 ID
    try:
        req = urllib.request.Request(
            f"{APIGW}/regions?language=zh-TW",
            headers={k: v for k, v in HEADERS.items() if k != "Content-Type"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            regions_data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  Regions API 失敗: {e}")
        return []

    regions = []
    for parent in regions_data.get("regions", []):
        regions.append(parent["id"])
        for child in parent.get("children", []):
            regions.append(child["id"])

    print(f"  取得 {len(regions)} 個地區 ID")

    # 對每個地區查詢站點
    for region_id in regions:
        payload = json.dumps({"regionId": region_id}).encode("utf-8")
        req = urllib.request.Request(
            f"{APIGW}/stations/search?language=zh-TW",
            data=payload,
            headers=HEADERS
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                result = json.loads(r.read().decode("utf-8"))
                stations = result.get("stations", [])
                for s in stations:
                    all_stations.append(_normalize_uride(s))
        except Exception:
            pass

    return _dedup(all_stations)


async def fetch_via_playwright() -> list[dict]:
    """用 Playwright 攔截 URiDE 地圖頁的 API 請求"""
    captured = []
    all_stations = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
            viewport={"width": 390, "height": 844},
            locale="zh-TW"
        )
        page = await context.new_page()

        async def handle_response(response):
            url = response.url
            try:
                ct = response.headers.get("content-type", "")
                if "json" in ct and ("uridego" in url or "station" in url.lower()):
                    body = await response.body()
                    text = body.decode("utf-8", errors="replace")
                    if len(text) > 50 and ('"lat"' in text.lower() or '"stations"' in text.lower()):
                        print(f"  [CAPTURED] {url[:80]}")
                        captured.append({"url": url, "body": text})
            except Exception:
                pass

        page.on("response", handle_response)

        for url in [URIDE_MAP_URL, URIDE_HOME_URL]:
            print(f"  Opening {url}...")
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
                await asyncio.sleep(5)
            except Exception as e:
                print(f"  Error: {e}")

        for resp in captured:
            stations = _parse_uride_json(resp["body"])
            if stations:
                print(f"  Parsed {len(stations)} from {resp['url'][:60]}")
                all_stations.extend(stations)

        await browser.close()

    return _dedup(all_stations)


def _normalize_uride(s: dict) -> dict:
    return {
        "id": s.get("id") or s.get("stationId"),
        "code": s.get("code") or s.get("stationCode", ""),
        "name": str(s.get("name") or s.get("stationName") or ""),
        "address": str(s.get("address") or s.get("stationAddress") or ""),
        "lat": float(s.get("lat") or s.get("latitude") or 0),
        "lng": float(s.get("lng") or s.get("longitude") or 0)
    }


def _parse_uride_json(text: str) -> list[dict]:
    stations = []
    try:
        data = json.loads(text)
    except Exception:
        return []

    def extract(obj):
        if isinstance(obj, list):
            for item in obj:
                extract(item)
        elif isinstance(obj, dict):
            lat = obj.get("lat") or obj.get("latitude")
            lng = obj.get("lng") or obj.get("longitude")
            if lat and lng:
                try:
                    lat, lng = float(lat), float(lng)
                    if 21.5 <= lat <= 25.5 and 119.0 <= lng <= 122.5:
                        stations.append(_normalize_uride(obj))
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
        if not s.get("lat") or not s.get("lng"):
            continue
        key = f"{s['lat']:.5f},{s['lng']:.5f}"
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
        if not any(dist(ns, es) < 100 for es in existing):
            existing.append(ns)
            added += 1

    print(f"  新增 {added} 個 URiDE 站點（共 {len(existing)} 個）")
    return existing


async def main():
    print("=== URiDE 站點爬蟲開始 ===\n")

    # 先嘗試 API
    print("1. 嘗試公開 API...")
    stations = fetch_via_api()
    print(f"   API 取得: {len(stations)} 個站點")

    # 不論 API 結果如何，也跑 Playwright 補充
    print("\n2. Playwright 攔截地圖頁...")
    pw_stations = await fetch_via_playwright()
    print(f"   Playwright 取得: {len(pw_stations)} 個站點")

    # 合併兩個來源
    combined = _dedup(stations + pw_stations)
    print(f"\n合計（去重後）: {len(combined)} 個站點")

    if combined:
        merged = merge_with_existing(combined, OUTPUT_FILE)
        with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"儲存完成：{len(merged)} 個站點 → {OUTPUT_FILE}")
    else:
        print("未取得任何新站點")


if __name__ == "__main__":
    asyncio.run(main())
