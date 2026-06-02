# 🚗 Taiwan Carsharing Map (台灣三大共享租車平台整合地圖)

English | [繁體中文版](README_zh-TW.md)

[![GitHub license](https://img.shields.io/github/license/ASDXDXD630/twrentacar?style=flat-square&color=blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ASDXDXD630/twrentacar?style=flat-square&color=gold)](https://github.com/ASDXDXD630/twrentacar/stargazers)
[![PWA Support](https://img.shields.io/badge/PWA-Supported-brightgreen?style=flat-square&logo=progressive-web-apps)](https://asdxdxd630.github.io/twrentacar/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-red?style=flat-square&logo=leaflet)](https://leafletjs.com/)

A unified web-based map dashboard designed for Taiwanese commuters and car-sharing users. This project consolidates, cleans, and visualizes geospatial data from Taiwan's top 3 roadside car-sharing platforms (**iRent**, **GoSmart**, **URiDE**), integrates public transportation networks (Taipei MRT lines/stations), and calculates cross-brand proximity hubs to enable seamless multi-modal transit and platform transfers.

👉 **[Live Demo](https://asdxdxd630.github.io/twrentacar/)**

---

## 🌟 Core Features

### 1. 📂 Consolidated Station Map
* Displays **iRent Relocation Lots**, **GoSmart Hubs**, and **URiDE Stations** in a single, responsive Leaflet map, eliminating the need to toggle between different vendor apps.
* Features custom pulsating markers with distinct brand colors: Red (iRent), Blue (GoSmart), and Yellow (URiDE).

### 2. 🔗 Proximity Hub Connection (200m Cross-Platform Hubs)
* Computes real-world spherical distances (Haversine formula) between different platforms. Stations within **200 meters (approx. 2-minute walk)** are automatically connected with **glowing purple dashed lines** and detailed proximity tables in Popups.
* This helps users perform fast cross-brand transfers (e.g., dropping off an iRent and immediately renting a nearby URiDE).

### 3. 🚉 Integrated Metro (MRT) Network
* Includes static layers of Taipei MRT routes and stations.
* MRT layers are non-interactive (`interactive: false` and `pointer-events: none`) to serve as a clean visual background, avoiding interference with clickable car-sharing pins.

### 4. 📱 Progressive Web App (PWA) Support
* Fully compliant with PWA specifications. Users can add the map as a standalone app on iOS Safari ("Add to Home Screen") or Android Chrome.
* Runs in `standalone` display mode (no URL bar, full-screen, immersive feel).
* Utilizes a Service Worker (`sw.js`) to cache static resources and map tiles, enabling fast, offline-capable load times even with poor roadside signals.

### 5. 🎯 High-Accuracy GPS Locator ("Find My Car")
* Features a custom pulsating GPS button at the bottom center.
* Pinpoints the user's location with a glowing sky-blue ripple marker and automatically flies the camera to the **closest available rental station** across all active platforms.

### 6. ⚡ Deep Link Integration
* Popup dialogs contain a "Rent Now" action button that attempts to wake the corresponding rental app on the user's mobile device via custom URL Schemes (`easyrent://`, `gosmart://`, `uride://`).
* Fallbacks gracefully to App Store (iOS) or Google Play (Android) listings in under 1.5 seconds if the app is not installed.

---

## 🛠️ Tech Stack

* **Front-End**:
  * Semantic HTML5
  * Vanilla CSS3 (custom HSL variables, frosted-glass Glassmorphism panel styling, flexbox/grid responsive layouts)
  * Vanilla ES6+ JS (parallel async fetches, modular filters, event bindings)
* **Maps & Geospatial**:
  * [Leaflet.js](https://leafletjs.com/) (Self-hosted to prevent CDN outages)
  * [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) (High-performance marker clustering)
  * Mathematical Haversine calculations.
  * Vector cutout clipping masks (Even-Odd winding rule) to dim non-operating regions.
* **PWA & Caching**:
  * Service Worker API (`Stale-While-Revalidate` and `Cache-First` strategies)
  * Web App Manifest (`manifest.json`)
* **Fonts & Icons**:
  * FontAwesome 6.x
  * Google Fonts (Orbit, Outfit, Inter)

---

## 📂 Project Directory Structure

```text
taiwan-carsharing-map/
├── data/
│   ├── irent_stations.json       # iRent roadside relocation station data
│   ├── gosmart_stations.json     # GoSmart hub station data
│   ├── uride_stations.json       # URiDE station data
│   ├── zones.json                # Operating area polygons
│   ├── metro_lines.json          # Taipei MRT route geometries
│   └── metro_stations.json       # Taipei MRT station coordinates
├── lib/                          # Local Leaflet & MarkerCluster assets
├── index.html                    # Main HTML entry point
├── app.css                       # Glowing dark theme and glassmorphism panel styles
├── app.js                        # Core rendering, distance sorting, and PWA logic
├── sw.js                         # PWA caching worker
├── manifest.json                 # Web App Manifest descriptors
├── icon-192.png / icon-512.png   # PWA application icons
└── README.md                     # Main documentation (English)
```

---

## 🚀 How to Run Locally

Since the application uses PWA features and ES modules, it cannot be run by double-clicking the `.html` file. You need a local server:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ASDXDXD630/twrentacar.git
   cd twrentacar
   ```

2. **Launch a lightweight web server**:
   * **Python (Recommended)**:
     ```bash
     python -m http.server 8000
     ```
   * **Node.js**:
     ```bash
     npm install -g http-server
     http-server -p 8000
     ```

3. **Open the browser**:
   * Navigate to `http://localhost:8000` to inspect the dashboard.
   * Access via your computer's local IP (e.g., `http://192.168.1.100:8000`) on your mobile phone on the same Wi-Fi network to test mobile GPS tracking and PWA app installation.

---

## 🤝 Contributing

Contributions are highly welcome!
* To update operating boundaries, modify `data/zones.json`.
* To update car-sharing hubs, update the respective `.json` files inside the `data/` folder.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). Feel free to modify and share.
