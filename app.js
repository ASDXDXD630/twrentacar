document.addEventListener('DOMContentLoaded', () => {
  // ==========================================================================
  // 0. Performance Utilities
  // ==========================================================================
  // Debounce: 等待使用者停止輸入後才執行，避免頻繁 DOM 重建
  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
  // ==========================================================================
  // 1. Map Initialization (Default to Colorful Voyager Tiles)
  // ==========================================================================
  const map = L.map('map', {
    zoomControl: false,
    minZoom: 7,
    maxZoom: 18,
    preferCanvas: true       // 啟用 Canvas 渲染，大幅提升多邊形與線段的滑動流暢度
  }).setView([25.045, 121.545], 11); // Centered on Taipei comparison view

  L.control.zoom({ position: 'topright' }).addTo(map);

  // CartoDB Voyager Tile Layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
    keepBuffer: 4,          // 預載周圍 4 格 tile，滑動時不閃白
    updateWhenIdle: false,  // 持續滑動時也更新 tile（更順暢）
    updateWhenZooming: false // zoom 動畫期間不重載 tile
  }).addTo(map);

  // Marker Cluster Group
  const markerCluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    // chunkedLoading: 分批把 marker 加入地圖，避免一次塞幾百個 DOM 凍住 UI
    chunkedLoading: true,
    chunkInterval: 100,       // 每 100ms 處理一批
    chunkDelay: 50,           // 每批之間休息 50ms，讓主線程喘氣
    // animate 關掉可以減少 zoom 時的 layout thrashing，手機滑動更順暢
    animate: false,
    animateAddingMarkers: false, // 加 marker 不播動畫（省 GPU）
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="custom-cluster"><span>${count}</span></div>`,
        className: 'custom-cluster-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
    }
  }).addTo(map);

  // Handle zoom-based cluster and line visibility
  // 用 requestAnimationFrame 包住，確保在瀏覽器畫完一幀後才改 DOM，避免 layout thrashing
  let _zoomRafId = null;
  function handleZoomLevels() {
    if (_zoomRafId) cancelAnimationFrame(_zoomRafId);
    _zoomRafId = requestAnimationFrame(() => {
      const zoom = map.getZoom();
      
      // 1. 管理 Marker Cluster
      if (zoom <= 9) {
        if (map.hasLayer(markerCluster)) map.removeLayer(markerCluster);
      } else {
        if (!map.hasLayer(markerCluster)) map.addLayer(markerCluster);
      }
      
      // 2. 管理 Nearby 鄰近連線
      if (zoom <= 9 || !toggleNearby.checked) {
        if (map.hasLayer(layers.nearby)) map.removeLayer(layers.nearby);
      } else {
        if (!map.hasLayer(layers.nearby)) map.addLayer(layers.nearby);
      }

      // 3. 管理捷運圖層 (只在 zoom >= 12 才顯示，減少低倍率時的效能損耗)
      if (zoom < 12) {
        if (map.hasLayer(layers.metro)) map.removeLayer(layers.metro);
      } else {
        if (!map.hasLayer(layers.metro)) map.addLayer(layers.metro);
      }
    });
  }

  map.on('zoomend', handleZoomLevels);

  // ==========================================================================
  // 2. Application State
  // ==========================================================================
  let urideStations = [];
  let gosmartStations = [];
  let irentStations = [];
  let metroLines = [];
  let metroStations = [];
  let allStations = []; // Combined array of roadside relocation stations
  let zoneData = { iRentOnly: [], GoSmartOnly: [], Overlap: [] };
  let nearbyLinesData = []; // Line geometries for stations within 200m (capped to 3 closest)
  
  // Map Layer Groups (zones and metro are always active)
  const layers = {
    zones: L.layerGroup().addTo(map),  // Outer dark mask + boundaries
    metro: L.layerGroup().addTo(map),  // Taipei Metro Lines + Stations
    nearby: L.layerGroup().addTo(map)  // Dash lines between close stations
  };

  // Lookup table for markers interaction
  const markerLookup = {};
  let activeItemElement = null;
  let userLocationMarker = null;

  // ==========================================================================
  // 3. UI Element Selectors
  // ==========================================================================
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search');
  const stationsListContainer = document.getElementById('stations-list');
  const resultsCount = document.getElementById('results-count');
  
  // Filter Checkboxes
  const toggleURide = document.getElementById('toggle-uride');
  const toggleGoSmart = document.getElementById('toggle-gosmart');
  const toggleiRent = document.getElementById('toggle-irent');
  const toggleNearby = document.getElementById('toggle-nearby');

  // Stats Elements
  const statTotal = document.getElementById('stat-total');
  const statURide = document.getElementById('stat-uride');
  const statGoSmart = document.getElementById('stat-gosmart');
  const statZones = document.getElementById('stat-zones');

  // Quick Location Buttons
  const btnTaiwan = document.getElementById('zoom-taiwan');
  const btnNorth = document.getElementById('zoom-north');
  const btnCentral = document.getElementById('zoom-central');
  const btnSouth = document.getElementById('zoom-south');

  // Mobile Drawer Toggle UI Elements & Listeners
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const sidebarPanel = document.getElementById('sidebar-panel');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openMobileSidebar() {
    sidebarPanel.classList.add('active');
    sidebarOverlay.classList.add('active');
  }

  function closeMobileSidebar() {
    sidebarPanel.classList.remove('active');
    sidebarOverlay.classList.remove('active');
  }

  if (menuToggleBtn && sidebarPanel && sidebarOverlay) {
    menuToggleBtn.addEventListener('click', openMobileSidebar);
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  // ==========================================================================
  // 4. Distance Math (Haversine Formula)
  // ==========================================================================
  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  // ==========================================================================
  // 5. Data Fetch & Process
  // ==========================================================================
  async function loadAllData() {
    try {
      // Fetch datasets in parallel
      const [urideRes, gosmartRes, irentRes, zonesRes, metroRes, metroStationsRes] = await Promise.all([
        fetch('data/uride_stations.json'),
        fetch('data/gosmart_stations.json'),
        fetch('data/irent_stations.json'), // Cleaned to roadside relocation parking only
        fetch('data/zones.json'),
        fetch('data/metro_lines.json'),
        fetch('data/metro_stations.json')
      ]);

      urideStations = await urideRes.json();
      gosmartStations = await gosmartRes.json();
      irentStations = await irentRes.json();
      zoneData = await zonesRes.json();
      metroLines = await metroRes.json();
      metroStations = await metroStationsRes.json();

      // Combine all stations into a single array for calculation
      allStations = [
        ...urideStations.map(s => ({ ...s, brand: 'uride' })),
        ...gosmartStations.map(s => ({ ...s, brand: 'gosmart' })),
        ...irentStations.map(s => ({ ...s, brand: 'irent' }))
      ];

      // Reset nearby state
      allStations.forEach(s => {
        s.isNearby = false;
        s.nearbyStations = [];
      });

      // Calculate Cross-Brand Stations within 200m (capped to 3 closest)
      calculateNearbyHubs();

      // Draw everything
      initMapElements();
      updateStats();
      renderStationsList();
      handleZoomLevels(); // Evaluate first view zoom

    } catch (error) {
      console.error('資料載入或運算錯誤:', error);
      stationsListContainer.innerHTML = `
        <div class="list-placeholder">
          <i class="fa-solid fa-triangle-exclamation" style="color: var(--color-irent)"></i>
          <span>載入資料時發生錯誤，請重新整理網頁。</span>
        </div>
      `;
    }
  }

  function calculateNearbyHubs() {
    nearbyLinesData = [];
    const processedPairs = new Set();

    // 1. Initial double-loop to gather all cross-brand proximities
    for (let i = 0; i < allStations.length; i++) {
      for (let j = i + 1; j < allStations.length; j++) {
        const s1 = allStations[i];
        const s2 = allStations[j];

        if (s1.brand !== s2.brand) {
          const dist = getDistance(s1.lat, s1.lng, s2.lat, s2.lng);
          if (dist <= 200) {
            s1.nearbyStations.push({ station: s2, dist: dist });
            s2.nearbyStations.push({ station: s1, dist: dist });
          }
        }
      }
    }

    // 2. Sort and cap nearby list to the 3 closest stations for EACH station
    allStations.forEach(s => {
      s.nearbyStations.sort((a, b) => a.dist - b.dist);
      // Keep only 3 closest
      s.nearbyStations = s.nearbyStations.slice(0, 3);
      s.isNearby = s.nearbyStations.length > 0;
    });

    // 3. Populate lines coordinates based on capped lists
    allStations.forEach(s1 => {
      s1.nearbyStations.forEach(ns => {
        const s2 = ns.station;
        // Build unique identifier key
        const pairKey = [s1.brand + '_' + s1.id, s2.brand + '_' + s2.id].sort().join('||');
        if (!processedPairs.has(pairKey)) {
          processedPairs.add(pairKey);
          nearbyLinesData.push({
            coords: [[s1.lat, s1.lng], [s2.lat, s2.lng]],
            s1: s1,
            s2: s2,
            dist: ns.dist
          });
        }
      });
    });
  }

  function shouldShowStation(s) {
    if (toggleNearby.checked && s.isNearby) return true;
    if (s.brand === 'uride') return toggleURide.checked;
    if (s.brand === 'gosmart') return toggleGoSmart.checked;
    if (s.brand === 'irent') return toggleiRent.checked;
    return false;
  }

  function updateStationVisibility() {
    allStations.forEach(s => {
      const m = markerLookup[`${s.brand}_${s.id}`];
      if (m) {
        const isCurrentlyOnMap = markerCluster.hasLayer(m);
        const shouldBeOnMap = shouldShowStation(s);
        if (shouldBeOnMap && !isCurrentlyOnMap) {
          markerCluster.addLayer(m);
        } else if (!shouldBeOnMap && isCurrentlyOnMap) {
          markerCluster.removeLayer(m);
        }
      }
    });
    updateMarkerIcons();
    drawNearbyLines();
    renderStationsList();
  }

  // ==========================================================================
  // 6. Draw Map Elements (Winding math for correct cutout hole rendering)
  // ==========================================================================
  function getPolygonWinding(coords) {
    let sum = 0;
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      sum += (p2[1] - p1[1]) * (p2[0] + p1[0]);
    }
    return sum >= 0 ? 'CW' : 'CCW';
  }

  function enforceWinding(coords, desiredWinding) {
    const cloned = coords.map(c => [...c]);
    const current = getPolygonWinding(cloned);
    if (current !== desiredWinding) {
      cloned.reverse();
    }
    return cloned;
  }

  function initMapElements() {
    // Clear existing layer groups & clusters
    layers.zones.clearLayers();
    layers.metro.clearLayers();
    layers.nearby.clearLayers();
    markerCluster.clearLayers();

    // A. Render Outer Dark Mask (Dimming non-operating areas)
    // Outer big box covering Taiwan & surroundings (enforce Clockwise winding)
    const outerBoundary = enforceWinding([
      [28.0, 118.0],
      [28.0, 123.5],
      [21.0, 123.5],
      [21.0, 118.0]
    ], 'CW');
    
    // Operating zone holes to cutout from the dark mask (enforce Counter-Clockwise winding)
    const holes = [];
    if (zoneData.iRentOnly) zoneData.iRentOnly.forEach(z => holes.push(enforceWinding(z.coords, 'CCW')));
    if (zoneData.GoSmartOnly) zoneData.GoSmartOnly.forEach(z => holes.push(enforceWinding(z.coords, 'CCW')));
    if (zoneData.Overlap) zoneData.Overlap.forEach(z => holes.push(enforceWinding(z.coords, 'CCW')));

    // Dark cutout polygon layer (Non-interactive)
    // Using non-overlapping holes with explicit winding orientation and fillRule: 'evenodd'
    // guarantees correct SVG cutout hole behavior across all browsers (solving the black center bug in Taipei!)
    L.polygon([outerBoundary, ...holes], {
      color: 'none',
      stroke: false,
      fillColor: '#0f131c',
      fillOpacity: 0.68,
      fillRule: 'evenodd',
      interactive: false
    }).addTo(layers.zones);

    // Draw colored operating zones based on brand: iRent (red), GoSmart (blue), Overlap (orange)
    if (zoneData.iRentOnly) {
      zoneData.iRentOnly.forEach(zone => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.16,
          weight: 1.5,
          opacity: 0.6,
          dashArray: '3, 4',
          interactive: false // Disabled click interaction to prevent accidental popups
        }).addTo(layers.zones);
      });
    }

    if (zoneData.GoSmartOnly) {
      zoneData.GoSmartOnly.forEach(zone => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.16,
          weight: 1.5,
          opacity: 0.6,
          dashArray: '3, 4',
          interactive: false // Disabled click interaction to prevent accidental popups
        }).addTo(layers.zones);
      });
    }

    if (zoneData.Overlap) {
      zoneData.Overlap.forEach(zone => {
        L.polygon(zone.coords, {
          color: zone.color,
          fillColor: zone.color,
          fillOpacity: 0.24,
          weight: 1.8,
          opacity: 0.7,
          dashArray: '3, 4',
          interactive: false // Disabled click interaction to prevent accidental popups
        }).addTo(layers.zones);
      });
    }

    // B. Draw Taipei Metro Routes (Lines)
    metroLines.forEach(line => {
      L.polyline(line.coords, {
        color: line.color,
        weight: 3.5,
        opacity: 0.72,
        className: 'metro-route-line',
        interactive: false // Non-interactive to prevent interference
      }).addTo(layers.metro);
    });

    // C. Draw Taipei Metro Stations (Nodes)
    metroStations.forEach(st => {
      const metroIcon = L.divIcon({
        className: 'metro-station-marker',
        html: '<i class="fa-solid fa-train-subway metro-icon-mrt"></i>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      L.marker([st.lat, st.lng], { 
        icon: metroIcon,
        interactive: false // Fully static, non-clickable
      }).addTo(layers.metro);
    });

    // D. Draw Dash Polylines for Nearby Stations
    drawNearbyLines();

    // E. Add Physical Station Markers to the Cluster Group
    allStations.forEach(s => {
      // Icon class definition
      let iconClass = `glow-marker brand-${s.brand}`;
      if (s.isNearby && toggleNearby.checked) {
        iconClass = 'glow-marker brand-nearby';
      }

      const icon = L.divIcon({
        className: iconClass,
        html: '<div class="marker-dot"></div><div class="marker-pulse"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      let brandLabel = '';
      if (s.brand === 'uride') brandLabel = '<span class=\"popup-brand-badge uride\">URiDE 恣意租還</span>';
      if (s.brand === 'gosmart') brandLabel = '<span class=\"popup-brand-badge gosmart\">GoSmart 隨還特約場</span>';
      if (s.brand === 'irent') brandLabel = '<span class=\"popup-brand-badge irent\">iRent 隨還特約場</span>';

      let nearbyInfoHtml = '';
      if (s.isNearby) {
        nearbyInfoHtml = `
          <div class="popup-nearby-alert" style="margin-top: 10px; border-top: 1px solid var(--border-light); padding-top: 8px;">
            <strong style="color: var(--color-nearby); font-size: 11px;"><i class="fa-solid fa-circle-nodes"></i> 最近交會點（200m）：</strong>
            <ul style="list-style: none; margin-top: 4px; padding-left: 2px;">
              ${s.nearbyStations.map(ns => {
                const other = ns.station;
                const brandName = other.brand === 'uride' ? 'URiDE' : (other.brand === 'gosmart' ? 'GoSmart' : 'iRent');
                return `<li style="font-size: 10px; color: var(--text-secondary); margin-bottom: 2px;">
                  • <strong>${brandName}</strong> [${other.name.replace('URiDE', '').replace('iRent', '')}] &rarr; <strong>${Math.round(ns.dist)}公尺</strong>
                </li>`;
              }).join('')}
            </ul>
          </div>
        `;
      }

      const popupContent = `
        <div class="custom-popup-content">
          ${brandLabel}
          ${s.isNearby ? '<span class="popup-brand-badge nearby" style="margin-left: 6px;"><i class="fa-solid fa-arrows-left-right"></i> 交會點</span>' : ''}
          <h4>${s.name}</h4>
          <p><i class="fa-solid fa-location-dot"></i>${s.address}</p>
          <p><i class="fa-solid fa-compass"></i>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</p>
          ${nearbyInfoHtml}
          <div class="popup-action-btn-container" style="margin-top: 12px; border-top: 1px solid var(--border-light); padding-top: 10px;">
            <button class="rent-btn rent-${s.brand}" onclick="triggerRentApp('${s.brand}')">
              <i class="fa-solid fa-car-side"></i> 租車去
            </button>
          </div>
        </div>
      `;

      const marker = L.marker([s.lat, s.lng], { icon: icon }).bindPopup(popupContent);

      // Evaluate active state checkbox to decide if adding to cluster
      if (shouldShowStation(s)) {
        markerCluster.addLayer(marker);
      }

      markerLookup[`${s.brand}_${s.id}`] = marker;
    });
  }

  function drawNearbyLines() {
    layers.nearby.clearLayers();
    if (!toggleNearby.checked) return;

    nearbyLinesData.forEach(line => {
      const showS1 = shouldShowStation(line.s1);
      const showS2 = shouldShowStation(line.s2);

      if (showS1 && showS2) {
        L.polyline(line.coords, {
          color: 'var(--color-nearby)',
          weight: 1.8,
          opacity: 0.7,
          dashArray: '4, 4',
          className: 'nearby-link-line'
        }).bindPopup(`
          <div class="custom-popup-content">
            <span class="popup-brand-badge nearby"><i class="fa-solid fa-arrows-left-right"></i> 鄰近交會連線</span>
            <p><strong>${line.s1.name}</strong> (${line.s1.brand.toUpperCase()})</p>
            <p style="text-align: center; margin: 4px 0; color: var(--color-nearby); font-weight: 800;">
              &larr; 相距約 ${Math.round(line.dist)} 公尺 &rarr;
            </p>
            <p><strong>${line.s2.name}</strong> (${line.s2.brand.toUpperCase()})</p>
          </div>
        `).addTo(layers.nearby);
      }
    });
  }

  function updateMarkerIcons() {
    allStations.forEach(s => {
      const marker = markerLookup[`${s.brand}_${s.id}`];
      if (marker) {
        let iconClass = `glow-marker brand-${s.brand}`;
        if (s.isNearby && toggleNearby.checked) {
          iconClass = 'glow-marker brand-nearby';
        }
        
        const newIcon = L.divIcon({
          className: iconClass,
          html: '<div class="marker-dot"></div><div class="marker-pulse"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        marker.setIcon(newIcon);
      }
    });
  }

  // ==========================================================================
  // 7. Update Stats Counters
  // ==========================================================================
  function updateStats() {
    const urideCount = urideStations.length;
    const gosmartCount = gosmartStations.length;
    const irentCount = irentStations.length;

    statURide.textContent = urideCount;
    statGoSmart.textContent = gosmartCount;
    statTotal.textContent = urideCount + gosmartCount + irentCount;
    
    // Display total zones count in stats (Overlap + iRentOnly + GoSmartOnly)
    const zonesCount = (zoneData.iRentOnly?.length || 0) + (zoneData.GoSmartOnly?.length || 0) + (zoneData.Overlap?.length || 0);
    statZones.textContent = zonesCount;
    
    const zonesLabel = statZones.previousElementSibling;
    if (zonesLabel) {
      zonesLabel.innerHTML = `<i class="fa-solid fa-draw-polygon" style="color: #ffffff"></i> 隨還營運邊界區域數`;
    }
  }

  // ==========================================================================
  // 8. Sidebar List Render
  // ==========================================================================
  function renderStationsList() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    stationsListContainer.innerHTML = '';

    const showURide = toggleURide.checked;
    const showGoSmart = toggleGoSmart.checked;
    const showiRent = toggleiRent.checked;

    let itemsRendered = 0;

    const sortedStations = [...allStations].sort((a, b) => {
      if (a.isNearby && !b.isNearby) return -1;
      if (!a.isNearby && b.isNearby) return 1;
      return a.name.localeCompare(b.name, 'zh-Hant-TW');
    });

    sortedStations.forEach(s => {
      if (!shouldShowStation(s)) return;

      const matchesSearch = s.name.toLowerCase().includes(searchTerm) || 
                            s.address.toLowerCase().includes(searchTerm);
      
      if (!matchesSearch) return;

      const item = createStationListItem(s);
      stationsListContainer.appendChild(item);
      itemsRendered++;
    });

    resultsCount.textContent = itemsRendered;

    if (itemsRendered === 0) {
      stationsListContainer.innerHTML = `
        <div class="list-placeholder">
          <i class="fa-solid fa-magnifying-glass-minus"></i>
          <span>無符合篩選條件的隨還據點</span>
        </div>
      `;
    }
  }

  function createStationListItem(station) {
    const card = document.createElement('div');
    card.className = `station-item brand-${station.brand}`;
    if (station.isNearby && toggleNearby.checked) {
      card.style.borderColor = 'rgba(217, 70, 239, 0.4)';
    }

    let brandText = 'URiDE';
    if (station.brand === 'gosmart') brandText = 'GoSmart';
    if (station.brand === 'irent') brandText = 'iRent';

    let badgesHtml = `<span class="brand-badge ${station.brand}">${brandText}</span>`;
    if (station.isNearby) {
      badgesHtml += ` <span class="brand-badge nearby" title="200公尺內有他牌據點"><i class="fa-solid fa-arrows-left-right"></i> 交會</span>`;
    }

    card.innerHTML = `
      <div class="station-item-header">
        <span class="station-item-name">${station.name}</span>
        <div class="badges-wrapper" style="display: flex; gap: 4px;">
          ${badgesHtml}
        </div>
      </div>
      <div class="station-item-address">
        <i class="fa-solid fa-location-dot"></i>
        <span>${station.address}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      if (activeItemElement) {
        activeItemElement.classList.remove('active');
        activeItemElement.style.boxShadow = 'none';
      }
      card.classList.add('active');
      activeItemElement = card;

      // Expand cluster to target marker first
      const marker = markerLookup[`${station.brand}_${station.id}`];
      if (marker) {
        markerCluster.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
      }

      // Auto-close sidebar drawer on mobile to show the map
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });

    return card;
  }

  // ==========================================================================
  // 9. Event Listeners (Brand Toggle handles Marker addition/removal from Cluster)
  // ==========================================================================
  toggleURide.addEventListener('change', updateStationVisibility);
  toggleGoSmart.addEventListener('change', updateStationVisibility);
  toggleiRent.addEventListener('change', updateStationVisibility);
  toggleNearby.addEventListener('change', updateStationVisibility);

  // Search input events — debounce 200ms 防止每個按鍵都重建 DOM 列表
  const debouncedRenderList = debounce(renderStationsList, 200);
  searchInput.addEventListener('input', () => {
    clearSearchBtn.style.display = searchInput.value.length > 0 ? 'block' : 'none';
    debouncedRenderList();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    renderStationsList();
    searchInput.focus();
  });

  // Location shortcuts zooming
  btnTaiwan.addEventListener('click', () => {
    map.flyTo([23.85, 120.95], 8, { duration: 1.2 });
  });

  btnNorth.addEventListener('click', () => {
    map.flyTo([25.04, 121.52], 12, { duration: 1.2 });
  });

  btnCentral.addEventListener('click', () => {
    map.flyTo([24.15, 120.65], 12, { duration: 1.2 });
  });

  btnSouth.addEventListener('click', () => {
    map.flyTo([22.78, 120.29], 11, { duration: 1.2 });
  });

  // Find Nearest Car Logic
  const btnFindNearest = document.getElementById('btn-find-nearest');
  btnFindNearest.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('您的瀏覽器不支援定位功能。');
      return;
    }

    const originalText = btnFindNearest.innerHTML;
    btnFindNearest.disabled = true;
    btnFindNearest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 定位中...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const uLat = position.coords.latitude;
        const uLng = position.coords.longitude;

        // Draw user custom pulsating GPS marker
        const userIcon = L.divIcon({
          className: 'user-gps-marker',
          html: '<div class="user-gps-dot"></div><div class="user-gps-pulse"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });

        if (userLocationMarker) {
          map.removeLayer(userLocationMarker);
        }
        userLocationMarker = L.marker([uLat, uLng], { icon: userIcon }).addTo(map).bindPopup('您的目前位置');

        // Find nearest station from pool
        let nearestStation = null;
        let minDistance = Infinity;

        // Search active stations first, fallback to all stations
        const activeStations = allStations.filter(s => shouldShowStation(s));
        const searchPool = activeStations.length > 0 ? activeStations : allStations;

        searchPool.forEach(s => {
          const dist = getDistance(uLat, uLng, s.lat, s.lng);
          if (dist < minDistance) {
            minDistance = dist;
            nearestStation = s;
          }
        });

        btnFindNearest.disabled = false;
        btnFindNearest.innerHTML = originalText;

        if (nearestStation) {
          // Pan to nearest station
          map.flyTo([nearestStation.lat, nearestStation.lng], 15, { duration: 1.5 });
          
          setTimeout(() => {
            const marker = markerLookup[`${nearestStation.brand}_${nearestStation.id}`];
            if (marker) {
              markerCluster.zoomToShowLayer(marker, () => {
                marker.openPopup();
              });
            }
          }, 1600);
        } else {
          alert('目前地圖上沒有任何據點可供搜尋。');
        }
      },
      (error) => {
        console.error('定位失敗:', error);
        alert('無法取得您的位置，請確認您的手機或瀏覽器已啟用 GPS 定位服務，並授權此網頁存取位置權限。');
        btnFindNearest.disabled = false;
        btnFindNearest.innerHTML = originalText;
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0
      }
    );
  });

  // Global App Launcher Redirection Logic
  // ── App 設定資料表 ──────────────────────────────────────────────────────────
  // Android package ID 請以 Google Play 網址確認：
  //   play.google.com/store/apps/details?id=<package_id>
  // iOS App Store ID 請以官方頁面確認
  const APP_CONFIG = {
    irent: {
      name: '和雲 iRent',
      webUrl: 'https://www.easyrent.com.tw/irent/web/',
      androidPackage: 'com.cht.easyrent.irent',         // 已修正（舊：com.easyrent.easyrent）
      iosAppId: '929007421',
      iosStoreUrl: 'https://apps.apple.com/tw/app/irent/id929007421',
      scheme: 'easyrent://'
    },
    gosmart: {
      name: '格上 GoSmart',
      webUrl: 'https://www.car-plus.com.tw/',
      androidPackage: 'com.carplus.gosmart',             // 已修正（舊：tw.com.carplus.gosmart）
      iosAppId: '1527633276',                            // 已修正（舊：1500552794）
      iosStoreUrl: 'https://apps.apple.com/tw/app/%E6%A0%BC%E4%B8%8AgoSmart/id1527633276',
      scheme: 'gosmart://'
    },
    uride: {
      name: '中租 URiDE',
      webUrl: 'https://www.uridego.com.tw/',
      androidPackage: 'tw.com.chailease.android.shareCar', // 已修正（舊：tw.com.chailease.uride）
      iosAppId: '6471373507',
      iosStoreUrl: 'https://apps.apple.com/tw/app/uride/id6471373507',
      scheme: 'uride://'
    }
  };

  window.triggerRentApp = function(brand) {
    const cfg = APP_CONFIG[brand];
    if (!cfg) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);

    // ── Modal 文字設定 ──────────────────────────────────────────────────────
    document.getElementById('launcher-title').textContent = `開啟 ${cfg.name}`;

    const webLink   = document.getElementById('launcher-link-web');
    const storeLink = document.getElementById('launcher-link-store');

    webLink.href = cfg.webUrl;

    let storeUrl = '';
    if (isIOS) {
      storeUrl = cfg.iosStoreUrl;
    } else {
      storeUrl = `https://play.google.com/store/apps/details?id=${cfg.androidPackage}`;
    }

    storeLink.href = storeUrl;

    // 更新說明文字讓使用者更清楚
    const storeStrong = storeLink.querySelector('strong');
    const storeSpan   = storeLink.querySelector('span');

    if (isAndroid) {
      if (storeStrong) storeStrong.textContent = '開啟 App 或前往 Google Play 📱';
      if (storeSpan)   storeSpan.textContent   = '已安裝者直接開啟，未安裝者跳至 Play Store 下載';
    } else if (isIOS) {
      if (storeStrong) storeStrong.textContent = '前往 App Store 下載或開啟 📥';
      if (storeSpan)   storeSpan.textContent   = '已安裝者可直接點擊「開啟」啟動 App';
    } else {
      if (storeStrong) storeStrong.textContent = '前往 App 商店 📥';
      if (storeSpan)   storeSpan.textContent   = '手機掃描下載或在商店搜尋 App';
    }

    // 當點擊前往商店按鈕時，嘗試喚醒 App
    storeLink.onclick = function(e) {
      if (isAndroid || isIOS) {
        e.preventDefault(); // 阻止預設開啟 Store 網頁行為
        
        // 1. 嘗試透過 Custom URL Scheme 喚醒 App
        const start = Date.now();
        const appUri = cfg.scheme;
        
        // 建立隱藏的 iframe 嘗試載入 Scheme（可避免直接跳轉失敗的報錯頁面）
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = appUri;
        document.body.appendChild(iframe);
        
        // 2000ms 後移除 iframe
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 2000);
        
        // 2. 嘗試透過 window.location.href 輔助開啟
        window.location.href = appUri;

        // 3. 設定延遲計時器：如果 App 沒有開啟（頁面沒有失去焦點，時間差很小），則導向 App 商店
        setTimeout(() => {
          // 如果 App 有成功打開，瀏覽器會轉為背景，Date.now() - start 會被暫停，回到前台時時間差會遠大於 1500ms
          // 如果 App 未安裝或沒打開，時間差會大約等於 1500ms，此時執行導向商店
          if (Date.now() - start < 2200) {
            window.location.href = storeUrl;
          }
        }, 1500);
      }
    };

    // Show modal
    const modal = document.getElementById('app-launcher-modal');
    modal.classList.add('active');
  };

  // Close App Launcher Modal Logic
  const launcherModal = document.getElementById('app-launcher-modal');
  const closeLauncherBtn = document.getElementById('close-launcher-btn');
  const closeLauncherModal = () => launcherModal.classList.remove('active');

  closeLauncherBtn.addEventListener('click', closeLauncherModal);
  launcherModal.addEventListener('click', (e) => {
    if (e.target === launcherModal) closeLauncherModal();
  });

  // Run fetching data
  loadAllData();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('PWA Service Worker registered successfully on scope:', reg.scope))
        .catch(err => console.error('PWA Service Worker registration failed:', err));
    });
  }
});