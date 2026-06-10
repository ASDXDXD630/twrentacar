"""
三大平台站點更新整合腳本
依序執行三個爬蟲，統計結果
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
DATA_DIR = SCRIPTS_DIR.parent / "data"


def count_stations(filepath: Path) -> int:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return len(json.load(f))
    except Exception:
        return 0


async def run_all():
    print("=" * 60)
    print("台灣共享汽車地圖 — 三大平台站點自動更新")
    print("=" * 60)

    # 記錄更新前的數量
    before = {
        "iRent": count_stations(DATA_DIR / "irent_stations.json"),
        "GoSmart": count_stations(DATA_DIR / "gosmart_stations.json"),
        "URiDE": count_stations(DATA_DIR / "uride_stations.json"),
    }
    print(f"\n更新前：iRent={before['iRent']}, GoSmart={before['GoSmart']}, URiDE={before['URiDE']}")

    # 依序執行各平台爬蟲
    scrapers = [
        ("iRent", SCRIPTS_DIR / "scrape_irent.py"),
        ("GoSmart", SCRIPTS_DIR / "scrape_gosmart.py"),
        ("URiDE", SCRIPTS_DIR / "scrape_uride.py"),
    ]

    results = {}
    for platform, script in scrapers:
        print(f"\n{'=' * 40}")
        print(f"正在更新 {platform}...")
        print(f"{'=' * 40}")
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(script),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
            output = stdout.decode("utf-8", errors="replace")
            print(output)
            results[platform] = proc.returncode == 0
        except asyncio.TimeoutError:
            print(f"  {platform} 爬蟲超時（120秒）")
            results[platform] = False
        except Exception as e:
            print(f"  {platform} 爬蟲錯誤: {e}")
            results[platform] = False

    # 統計結果
    after = {
        "iRent": count_stations(DATA_DIR / "irent_stations.json"),
        "GoSmart": count_stations(DATA_DIR / "gosmart_stations.json"),
        "URiDE": count_stations(DATA_DIR / "uride_stations.json"),
    }

    print("\n" + "=" * 60)
    print("更新結果摘要")
    print("=" * 60)
    total_added = 0
    for platform in ["iRent", "GoSmart", "URiDE"]:
        diff = after[platform] - before[platform]
        total_added += max(0, diff)
        status = "✓" if results.get(platform) else "✗"
        print(f"  [{status}] {platform}: {before[platform]} → {after[platform]} ({'+' if diff >= 0 else ''}{diff})")

    print(f"\n  總計新增: {total_added} 個站點")
    print(f"  三大平台合計: {sum(after.values())} 個站點")

    # 如果沒有新增任何站點，返回 1 讓 CI 知道
    if total_added == 0 and all(not v for v in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_all())
