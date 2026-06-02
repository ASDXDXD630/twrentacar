# 🚗 台灣三大共享租車平台整合地圖 (Taiwan Carsharing Map)

[English Version](README.md) | 繁體中文

[![GitHub license](https://img.shields.io/github/license/ASDXDXD630/twrentacar?style=flat-square&color=blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ASDXDXD630/twrentacar?style=flat-square&color=gold)](https://github.com/ASDXDXD630/twrentacar/stargazers)
[![PWA Support](https://img.shields.io/badge/PWA-Supported-brightgreen?style=flat-square&logo=progressive-web-apps)](https://asdxdxd630.github.io/twrentacar/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-red?style=flat-square&logo=leaflet)](https://leafletjs.com/)

一個專為台灣通勤族與共享租車用戶設計的整合式地圖儀表板。本專案將台灣三大主流共享租車平台（**和泰 iRent**、**格上 GoSmart**、**中租 URiDE**）的隨還特約場與隨還據點進行資料庫清洗與即時地理解析，整合大眾運輸（捷運線路），並提供高精度的「跨品牌鄰近交會點」分析，協助用路人解決平台資訊分裂的痛點，實現快速換租、低碳轉乘。

👉 **[立即線上體驗 Live Demo](https://asdxdxd630.github.io/twrentacar/)**

---

## 🌟 核心特色 (Core Features)

### 1. 📂 三大平台據點一覽
* 整合 **iRent 隨還特約場**、**GoSmart 隨還特約點**與 **URiDE 恣意租還點** 的全台即時地理數據，消除切換多個 App 查詢地圖的麻煩。
* 全站點地理標記配備呼吸燈特效，紅色 (iRent)、藍色 (GoSmart)、黃色 (URiDE)，品牌識別清晰。

### 2. 🔗 鄰近交會連線（200m Cross-Platform Hubs）
* 內建高效能空間距離運算。若不同品牌的據點在 **200 公尺（步行約 2 分鐘）** 內，地圖會以 **粉紫色發光虛線** 將它們連接，並在 Popup 視窗列出詳細鄰近站點距離。
* 這是目前市場上**唯一**專為「跨平台無縫換車（例如開 iRent 去換租 URiDE）」設計的視覺引導功能。

### 3. 🚉 靜態捷運網整合
* 整合雙北捷運（MRT）路線與站點圖示。
* 圖示與線路均設為 `interactive: false`，在地圖背景中完美融入，絕不干擾租車據點的點擊操作，方便用戶規劃「捷運轉乘共享汽車」的最後一公里路程。

### 4. 📱 PWA (Progressive Web App) 行動端優化
* 支援 PWA 規範，可在 iOS Safari (加入主畫面) 或 Android Chrome (安裝應用程式) 中下載至手機桌面，享有**全螢幕、無瀏覽器底框**的原生 App 體驗。
* 內建 `sw.js` (Service Worker) 離線快取機制，自動緩存靜態資源與 Leaflet 地圖圖磚，在戶外訊號不佳處仍能秒速開啟。

### 5. 🎯 「找個車」高精度 GPS 尋車
* 地圖中央下方設有「找個車」定位準心按鈕。
* 一鍵透過 HTML5 Geolocation API 獲取高精度定位，地圖流暢飛移 (FlyTo) 至使用者位置（配有天藍色水波紋動畫標記），並自動彈出**最近的可用租車據點**與導航/租車選項。

### 6. ⚡ App 喚醒深度連結 (Deep Linking)
* 站點 Popup 資訊窗內設有「租車去」按鈕，點擊後會嘗試使用 custom URL scheme 喚醒手機內的對應 App (如 `easyrent://`、`gosmart://`、`uride://`)。
* 若未安裝對應 App，系統會引導跳轉至 App Store (iOS) 或 Google Play (Android) 下載頁面。

---

## 🛠️ 技術棧 (Tech Stack)

* **前端架構**: 
  * HTML5 (語意化標籤)
  * Vanilla CSS3 (自定義 HSL 色彩變數、毛玻璃 Glassmorphism 抽屜式控制面板、響應式佈局)
  * JavaScript (ES6+ 異步並行加載、動態篩選機制)
* **地圖與空間運算**:
  * [Leaflet.js](https://leafletjs.com/) (地圖渲染引擎，本地化部署，防範 CDN 載入失敗問題)
  * [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) (高密度站點聚合渲染)
  * 自定義 Haversine Formula 進行高精度地理空間球面距離計算。
  * 反向多邊形挖孔技術（Cutout Overlay with Even-Odd fill rule）實現非營運縣市半透明灰色遮罩。
* **PWA & 快取**:
  * Service Worker API (`Stale-While-Revalidate` & `Cache-First` 快取策略)
  * Web App Manifest (`manifest.json`)
* **字型與圖示**:
  * FontAwesome 6.x (圖示庫)
  * Google Fonts (Orbit, Outfit, Inter)

---

## 📂 專案目錄結構 (Project Structure)

```text
taiwan-carsharing-map/
├── data/
│   ├── irent_stations.json       # iRent 全台隨還特約場站點數據
│   ├── gosmart_stations.json     # GoSmart 全台據點數據
│   ├── uride_stations.json       # URiDE 全台據點數據
│   ├── zones.json                # 各品牌營運區塊邊界 JSON (多邊形經緯度)
│   ├── metro_lines.json          # 捷運主線座標
│   └── metro_stations.json       # 捷運車站座標
├── lib/                          # 本地 Leaflet 與 MarkerCluster 套件
├── index.html                    # 滿版地圖與控制面板主頁面
├── app.css                       # HSL 微光霓虹主題與玻璃防觸控面板樣式
├── app.js                        # 地圖繪製、交會邏輯與事件處理核心程式碼
├── sw.js                         # PWA 離線快取 Service Worker
├── manifest.json                 # PWA 應用設定檔
├── icon-192.png / icon-512.png   # PWA 手機案裝圖示
└── README.md                     # 專案說明文件
```

---

## 🚀 本地開發運行 (How to Run Locally)

本專案完全以純前端 (Vanilla JS) 打造，無任何編譯步驟，解壓或克隆後即可直接運行：

1. **複製本專案倉庫**：
   ```bash
   git clone https://github.com/ASDXDXD630/twrentacar.git
   cd twrentacar
   ```

2. **啟動本地輕量網頁伺服器** (由於 PWA 與 ES 模組安全性要求，請勿直接點擊雙擊打開 `.html` 檔案)：
   * **使用 Python (推薦)**:
     ```bash
     python -m http.server 8000
     ```
   * **使用 Node.js (`http-server`)**:
     ```bash
     npm install -g http-server
     http-server -p 8000
     ```

3. **瀏覽測試**：
   * 在瀏覽器中開啟 `http://localhost:8000` 即可檢視滿版地圖。
   * 手機與電腦在同一個區域網路（Wi-Fi）時，手機輸入電腦 IP 加上端口（例如 `http://192.168.1.100:8000`），即可安裝 PWA 至桌面，體驗高精度 GPS 定位尋車功能。

---

## 🤝 參與貢獻與維護 (Contributing)

我們非常歡迎您提交 Issue 或 Pull Request 來改進本專案！
* 如果您發現某個城市的營運邊界有調整，歡迎修改 `data/zones.json` 中的多邊形座標。
* 如果某家共享汽車新增或裁撤了特約停車場，請更新 `data/` 下對應的品牌 `.json` 檔案。

---

## 📄 開源授權 (License)

本專案採用 [MIT License](LICENSE) 授權釋出，歡迎自由修改與分享。
