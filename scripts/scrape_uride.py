"""
URiDE (恣意) 站點爬蟲
使用已發現的官方 API 取得所有站點
無需 Playwright，直接呼叫 API 即可
"""
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "uride_stations.json"
APIGW = "https://web-apigw.uridego.com.tw/sharecar-backstage-service/openapi/officialweb"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://www.uridego.com.tw",
    "Referer": "https://www.uridego.com.tw/",
}


def fetch_regions(station_type: str) -> list[dict]:
    url = f"{APIGW}/regions?language=zh-TW&stationType={station_type}"
    print(f"取得 URiDE 地區清單: {url}")
    try:
        req = urllib.request.Request(url, headers={k: v for k, v in HEADERS.items() if k != "Content-Type"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8")).get("regions", [])
    except Exception as e:
        print(f"  地區 API 失敗: {e}")
        return []


def query_stations_for_county(county: dict, station_type: str) -> list[dict]:
    url = f"{APIGW}/stations/search?language=zh-TW"
    
    payload = {
        "regions": [{
            "id": county.get("id"),
            "children": [child.get("id") for child in county.get("children", [])]
        }],
        "stationType": station_type
    }
    
    data = json.dumps(payload).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8")).get("stations", [])
    except Exception as e:
        print(f"  查詢縣市 {county.get('name')} 失敗: {e}")
        return []


def _normalize_uride(s: dict) -> dict:
    return {
        "id": s.get("id") or s.get("stationId"),
        "code": s.get("code") or s.get("stationCode", ""),
        "name": str(s.get("name") or s.get("stationName") or "").strip(),
        "address": str(s.get("address") or s.get("stationAddress") or "").strip(),
        "lat": float(s.get("lat") or s.get("latitude") or 0),
        "lng": float(s.get("lng") or s.get("longitude") or 0)
    }


def dist(a, b):
    R = 6371000
    phi1, phi2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi = math.radians(b["lat"] - a["lat"])
    dlam = math.radians(b["lng"] - a["lng"])
    x = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(x))


def merge_with_existing(new_stations: list[dict], existing_file: Path) -> list[dict]:
    if existing_file.exists():
        try:
            with open(existing_file, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = []
    else:
        existing = []

    # 使用 ID 作為唯一鍵來建檔，避免重複 ID
    existing_by_id = {}
    for s in existing:
        if s.get("id"):
            existing_by_id[s["id"]] = s

    added = 0
    updated = 0
    for ns in new_stations:
        ns_id = ns["id"]
        if ns_id in existing_by_id:
            # 如果 ID 存在，檢查是否有欄位更新
            es = existing_by_id[ns_id]
            if (es.get("name") != ns.get("name") or 
                es.get("address") != ns.get("address") or 
                es.get("lat") != ns.get("lat") or 
                es.get("lng") != ns.get("lng")):
                existing_by_id[ns_id] = ns
                updated += 1
        else:
            # 如果是新 ID，檢查 100m 內是否已有其他站點（避免物理位置重複，但基本上 ID 不同即為新據點）
            if not any(dist(ns, es) < 100 for es in existing_by_id.values()):
                existing_by_id[ns_id] = ns
                added += 1

    print(f"  新增 {added} 個，更新 {updated} 個 URiDE 站點（共 {len(existing_by_id)} 個）")
    return list(existing_by_id.values())


def main():
    print("=== URiDE 站點爬蟲開始 ===\n")
    
    station_type = "RENT_FROM_ANY_PLACE"
    regions = fetch_regions(station_type)
    
    if not regions:
        print("無法取得地區清單")
        sys.exit(1)
        
    print(f"取得 {len(regions)} 個縣市區域")
    
    all_stations = []
    for county in regions:
        name = county.get("name")
        print(f"正在抓取 {name}...")
        stations = query_stations_for_county(county, station_type)
        print(f"  找到 {len(stations)} 個站點")
        for s in stations:
            all_stations.append(_normalize_uride(s))
        time.sleep(0.5)  # 禮貌延遲

    # 去重
    seen = set()
    unique_stations = []
    for s in all_stations:
        if not s.get("lat") or not s.get("lng"):
            continue
        key = f"{s['lat']:.5f},{s['lng']:.5f}"
        if key not in seen:
            seen.add(key)
            unique_stations.append(s)
            
    print(f"\nAPI 抓取完畢，共取得 {len(unique_stations)} 個獨立站點")
    
    if unique_stations:
        merged = merge_with_existing(unique_stations, OUTPUT_FILE)
        with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"✅ 儲存完成：{len(merged)} 個站點 → {OUTPUT_FILE}")
    else:
        print("未取得任何站點")


if __name__ == "__main__":
    main()
