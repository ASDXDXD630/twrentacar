"""
iRent 站點爬蟲 — 使用已發現的官方 API
端點: POST EasyrentService2019/api/iRentWeb/LOCATION_Q
無需 Playwright，直接呼叫即可取得全台灣所有 iRent 站點
"""
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "irent_stations.json"

API_URL = "https://www.irentcar.com.tw/EasyrentService2019/api/iRentWeb/LOCATION_Q"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json",
    "Referer": "https://www.irentcar.com.tw/",
    "Origin": "https://www.irentcar.com.tw",
}


def fetch_all_irent_stations() -> list[dict]:
    """直接呼叫 iRent 官方 API 取得全台灣所有站點"""
    # CITY="A" 代表全台灣
    payload = json.dumps({"CITY": "A", "SOURCE": "WEB"}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=payload, headers=HEADERS)

    print(f"呼叫 iRent API: {API_URL}")
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        data = json.loads(raw.decode("utf-8"))

    table1 = data.get("DATA", {}).get("Table1", [])
    print(f"API 回傳 {len(table1)} 筆原始資料")

    stations = []
    skipped = 0

    for s in table1:
        try:
            # 注意：iRent API 的 LAT 欄位實際上是「經度」，LON 是「緯度」（命名相反）
            lng_raw = s.get("LAT", "")   # 欄位名叫 LAT，實際是 lng
            lat_raw = s.get("LON", "")   # 欄位名叫 LON，實際是 lat

            if not lat_raw or not lng_raw:
                skipped += 1
                continue

            lat = float(lat_raw)
            lng = float(lng_raw)

            # 台灣座標範圍驗證
            if not (21.5 <= lat <= 26.0 and 119.0 <= lng <= 122.5):
                # 嘗試反轉
                lat, lng = lng, lat
                if not (21.5 <= lat <= 26.0 and 119.0 <= lng <= 122.5):
                    skipped += 1
                    continue

            name = str(s.get("STANAME", "")).strip()
            address = str(s.get("CITYADD", "")).strip()
            station_id = s.get("STARFNBR")

            if not name:
                skipped += 1
                continue

            stations.append({
                "id": f"irent_{station_id}" if station_id else None,
                "name": name,
                "address": address,
                "lat": round(lat, 7),
                "lng": round(lng, 7)
            })
        except (ValueError, TypeError, KeyError):
            skipped += 1

    print(f"有效站點: {len(stations)}, 跳過: {skipped}")
    return stations


def main():
    print("=== iRent 站點爬蟲開始 ===\n")

    try:
        stations = fetch_all_irent_stations()
    except Exception as e:
        print(f"API 呼叫失敗: {e}")
        sys.exit(1)

    if not stations:
        print("未取得任何站點")
        sys.exit(1)

    # 按縣市統計
    cities = {}
    for s in stations:
        addr = s.get("address", "")
        for city in ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "基隆市", "新竹市",
                     "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣",
                     "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "澎湖縣", "連江縣"]:
            if city in addr:
                cities[city] = cities.get(city, 0) + 1
                break
        else:
            cities["其他"] = cities.get("其他", 0) + 1

    print("\n各縣市站點數:")
    for city, cnt in sorted(cities.items(), key=lambda x: -x[1]):
        print(f"  {city}: {cnt}")

    # 儲存
    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 儲存完成：{len(stations)} 個站點 → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
