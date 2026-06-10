"""
iRent 路邊租還站點爬蟲
使用 Playwright 開啟 iRent 網頁地圖，攔截站點資料 API 請求
"""
import asyncio
import json
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright, Route, Request

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "irent_stations.json"

# iRent 路邊租還地圖頁（載入時會呼叫後端取得所有停車場）
IRENT_MAP_URL = "https://www.irentcar.com.tw/iRent/Web/#/relocation"
IRENT_RELOCATION_URL = "https://www.irentcar.com.tw/UPLOAD/web/location/index.html"

# 站點資料會從這個 base URL 取得
API_BASE = "EasyrentService2019"
PARKING_BASE = "ParkingFrontEndService"


async def scrape_irent_stations() -> list[dict]:
    """開啟 iRent 地圖頁，攔截所有包含站點資料的 API 請求"""
    all_stations = []
    captured_responses = []

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

        # 攔截所有 API 回應
        async def handle_response(response):
            url = response.url
            # 檢查是否為站點相關 API
            if any(kw in url for kw in [API_BASE, PARKING_BASE, "iRent", "relocation", "parking", "station"]):
                try:
                    ct = response.headers.get("content-type", "")
                    if "json" in ct or "javascript" in ct:
                        body = await response.body()
                        text = body.decode("utf-8", errors="replace")
                        if len(text) > 100 and ('"lat"' in text.lower() or '"latitude"' in text.lower()):
                            print(f"  [CAPTURED] {url[:80]} ({len(text)} bytes)")
                            captured_responses.append({
                                "url": url,
                                "body": text
                            })
                except Exception as e:
                    pass

        page.on("response", handle_response)

        # 1. 嘗試路邊租還地圖頁
        print(f"Opening iRent relocation map...")
        try:
            await page.goto(IRENT_MAP_URL, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(5)  # 等待動態內容載入
        except Exception as e:
            print(f"  Map page error: {e}")

        # 2. 嘗試 UPLOAD 版本
        print(f"Opening iRent UPLOAD map...")
        try:
            await page.goto(IRENT_RELOCATION_URL, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(5)
        except Exception as e:
            print(f"  UPLOAD page error: {e}")

        # 解析捕獲的 JSON 回應
        for resp in captured_responses:
            stations = _parse_stations_from_json(resp["body"], resp["url"])
            if stations:
                print(f"  Parsed {len(stations)} stations from {resp['url'][:60]}")
                all_stations.extend(stations)

        await browser.close()

    # 去重
    seen_ids = set()
    unique_stations = []
    for s in all_stations:
        sid = s.get("id") or f"{s.get('lat')},{s.get('lng')}"
        if sid not in seen_ids:
            seen_ids.add(sid)
            unique_stations.append(s)

    return unique_stations


def _parse_stations_from_json(text: str, url: str) -> list[dict]:
    """從 JSON 文字中解析站點資料"""
    stations = []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 嘗試找出 JSON 陣列
        match = re.search(r'\[{.*?}\]', text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except Exception:
                return []
        else:
            return []

    # 遞迴搜尋含有 lat/lng 的物件
    def extract(obj):
        if isinstance(obj, list):
            for item in obj:
                extract(item)
        elif isinstance(obj, dict):
            # 標準化欄位名稱
            lat_keys = ["lat", "latitude", "Lat", "LAT", "stLat"]
            lng_keys = ["lng", "lon", "longitude", "Lng", "LON", "stLng"]
            name_keys = ["name", "Name", "stName", "parkingName", "title"]
            addr_keys = ["address", "Address", "addr", "stAddr", "parkingAddr"]
            id_keys = ["id", "Id", "ID", "stId", "parkingId", "lotId"]

            lat = next((obj[k] for k in lat_keys if k in obj), None)
            lng = next((obj[k] for k in lng_keys if k in obj), None)

            if lat is not None and lng is not None:
                try:
                    lat = float(lat)
                    lng = float(lng)
                    # 台灣座標範圍驗證
                    if 21.5 <= lat <= 25.5 and 119.0 <= lng <= 122.5:
                        name = next((obj[k] for k in name_keys if k in obj), "")
                        addr = next((obj[k] for k in addr_keys if k in obj), "")
                        sid = next((obj[k] for k in id_keys if k in obj), None)

                        stations.append({
                            "id": sid,
                            "name": str(name) if name else "",
                            "address": str(addr) if addr else "",
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


def merge_with_existing(new_stations: list[dict], existing_file: Path) -> list[dict]:
    """合併新站點與現有站點（保留現有，新增缺少的）"""
    import math

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
        # 檢查是否已存在（150m 內）
        if not any(dist(ns, es) < 150 for es in existing):
            existing.append(ns)
            added += 1

    print(f"  新增 {added} 個站點（原有 {len(existing) - added} 個）")
    return existing


async def main():
    print("=== iRent 站點爬蟲開始 ===\n")

    stations = await scrape_irent_stations()
    print(f"\n爬蟲取得 {len(stations)} 個站點")

    if stations:
        merged = merge_with_existing(stations, OUTPUT_FILE)
        with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"儲存完成：{len(merged)} 個站點 → {OUTPUT_FILE}")
    else:
        print("未取得任何站點（API 可能有變更）")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
