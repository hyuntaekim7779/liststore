/**
 * Naver Maps integration.
 * - 지도 초기화
 * - 주소 → 좌표 (Geocoder submodule)
 * - 마커 표시
 * - Naver Map URL에서 좌표 추출 시도 (best-effort)
 */
(function () {
  let map = null;
  let markers = [];
  const DEFAULT_CENTER = { lat: 37.5666103, lng: 126.9783882 }; // 서울 시청

  function ready() {
    return typeof naver !== 'undefined' && naver.maps;
  }

  const Maps = {
    init(containerId) {
      if (!ready()) {
        console.warn('Naver Maps API not loaded.');
        const el = document.getElementById(containerId);
        if (el) {
          el.innerHTML =
            '<div style="padding:20px;color:#888;text-align:center">' +
            '네이버 지도 API를 불러오지 못했습니다. Client ID를 확인하거나, ' +
            '<code>ncpKeyId</code> ↔ <code>ncpClientId</code> 파라미터를 바꿔보세요.' +
            '</div>';
        }
        return;
      }
      map = new naver.maps.Map(containerId, {
        center: new naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        zoom: 14,
      });
    },

    clearMarkers() {
      markers.forEach((m) => m.setMap(null));
      markers = [];
    },

    /** Render markers for an array of stores. */
    renderStores(stores) {
      if (!ready() || !map) return;
      this.clearMarkers();
      const bounds = new naver.maps.LatLngBounds();
      let count = 0;
      stores.forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        const position = new naver.maps.LatLng(s.lat, s.lng);
        const marker = new naver.maps.Marker({
          position,
          map,
          title: s.name,
        });
        const info = new naver.maps.InfoWindow({
          content: `
            <div style="padding:8px 12px;min-width:160px;font-size:13px">
              <strong>${escapeHtml(s.name)}</strong><br/>
              ${s.address ? escapeHtml(s.address) + '<br/>' : ''}
              ${s.memo ? '<span style="color:#888">' + escapeHtml(s.memo) + '</span><br/>' : ''}
              ${s.url ? '<a href="' + encodeURI(s.url) + '" target="_blank" rel="noopener">네이버 지도에서 보기</a>' : ''}
            </div>`,
        });
        naver.maps.Event.addListener(marker, 'click', () => {
          info.open(map, marker);
        });
        markers.push(marker);
        bounds.extend(position);
        count++;
      });
      if (count > 0) map.fitBounds(bounds);
    },

    /** Focus map on a single store. */
    focus(store) {
      if (!ready() || !map || store.lat == null || store.lng == null) return;
      const pos = new naver.maps.LatLng(store.lat, store.lng);
      map.setCenter(pos);
      map.setZoom(16);
    },

    /** Geocode an address → {lat, lng}.  Returns null on failure. */
    geocode(address) {
      return new Promise((resolve) => {
        if (!ready() || !naver.maps.Service) {
          resolve(null);
          return;
        }
        naver.maps.Service.geocode({ query: address }, function (status, response) {
          if (status !== naver.maps.Service.Status.OK) {
            resolve(null);
            return;
          }
          const items = response.v2 && response.v2.addresses;
          if (!items || items.length === 0) {
            resolve(null);
            return;
          }
          const first = items[0];
          resolve({ lat: parseFloat(first.y), lng: parseFloat(first.x) });
        });
      });
    },

    /**
     * Best-effort extraction of lat/lng from a Naver Map URL.
     * Examples it handles:
     *   ...?c=12.5,127.123,37.456,0,0,0
     *   ...&c=127.123,37.456,15,0,0,0,dh
     *   .../place/12345?c=...
     * 추출 실패시 null. (단축 URL naver.me/... 는 CORS 때문에 풀 수 없음)
     */
    parseUrl(url) {
      if (!url) return null;
      try {
        const u = new URL(url);
        const c = u.searchParams.get('c');
        if (c) {
          const parts = c.split(',').map(Number).filter((n) => !Number.isNaN(n));
          // Look for a plausible lat/lng pair (lat: 33~39, lng: 124~132 for Korea)
          for (let i = 0; i < parts.length - 1; i++) {
            const a = parts[i], b = parts[i + 1];
            if (a >= 124 && a <= 132 && b >= 33 && b <= 39) return { lat: b, lng: a };
            if (b >= 124 && b <= 132 && a >= 33 && a <= 39) return { lat: a, lng: b };
          }
        }
      } catch (e) { /* ignore */ }
      return null;
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  window.Maps = Maps;
})();
