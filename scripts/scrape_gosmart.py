"""
GoSmart (格上) 站點爬蟲
使用已發現的官方 API 取得所有短租與訂閱站點
"""
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "gosmart_stations.json"
API_GW = "https://gateway.api.car-plus.com.tw/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "application/json",
    "Referer": "https://www.car-plus.com.tw/",
    "Origin": "https://www.car-plus.com.tw",
}


def fetch_api(path: str) -> list[dict]:
    url = API_GW + path
    print(f"呼叫 GoSmart API: {url}")
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")).get("data", [])
    except Exception as e:
        print(f"  API 呼叫失敗: {e}")
        return []


def dist(a, b):
    # 兩點間距離 (公尺)
    R = 6371000
    phi1, phi2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi = math.radians(b["lat"] - a["lat"])
    dlam = math.radians(b["lng"] - a["lng"])
    x = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(x))


def main():
    print("=== GoSmart 站點爬蟲開始 ===\n")

    # 1. 讀取現有資料
    existing = []
    if OUTPUT_FILE.exists():
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = []
    print(f"現有站點: {len(existing)}")

    # 2. 獲取 API 資料
    srental_list = fetch_api("common/srental/v1/station")
    subscribe_list = fetch_api("common/subscribe/stations")
    print(f"API 短租 (srental) 回傳: {len(srental_list)} 筆")
    print(f"API 訂閱 (subscribe) 回傳: {len(subscribe_list)} 筆")

    # 3. 標準化 API 資料
    new_stations = []

    # 短租
    for s in srental_list:
        code = s.get("stationCode")
        name = s.get("stationName", "").strip()
        addr = s.get("addr", "").strip()
        lat = s.get("lat")
        lng = s.get("lng")

        if not lat or not lng or not name:
            continue

        new_stations.append({
            "id": f"gosmart_{code}",
            "name": f"格上 GoSmart {name}" if not name.startswith("格上") else name,
            "address": addr,
            "lat": float(lat),
            "lng": float(lng)
        })

    # 訂閱
    for s in subscribe_list:
        code = s.get("stationCode")
        name = s.get("stationName", "").strip()
        addr = s.get("addr", "").strip()
        lat = s.get("lat")
        lng = s.get("lng")

        if not lat or not lng or not name:
            continue

        new_stations.append({
            "id": f"gosmart_sub_{code}",
            "name": f"格上 GoSmart {name}" if not name.startswith("格上") else name,
            "address": addr,
            "lat": float(lat),
            "lng": float(lng)
        })

    print(f"標準化後共 {len(new_stations)} 個候選站點")

    # 4. 合併（若距離小於 100m 視為同一個站點）
    merged = list(existing)
    added = 0

    for ns in new_stations:
        dup = False
        for es in merged:
            if dist(ns, es) < 100:
                dup = True
                # 更新地址與座標
                es["lat"] = ns["lat"]
                es["lng"] = ns["lng"]
                if not es.get("address") and ns.get("address"):
                    es["address"] = ns["address"]
                break
        if not dup:
            merged.append(ns)
            added += 1

    print(f"合併完成：新增 {added} 個站點，總計 {len(merged)} 個站點")

    # 5. 儲存
    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 儲存完成：{len(merged)} 個站點 → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
