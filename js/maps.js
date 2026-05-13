/**
 * Naver Maps integration.
 * - 지도 초기화
 * - 주소 → 좌표 (Geocoder submodule)
 * - 마커 표시
 * - Naver Map URL 파싱: 이름, placeId, 좌표 추출 (best-effort)
 * - 지도 클릭으로 좌표 직접 지정 모드
 */
(function () {
  let map = null;
  let markers = [];
  let pickModeListener = null;
  let pickModeCallback = null;
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

    renderStores(stores) {
      if (!ready() || !map) return;
      this.clearMarkers();
      const bounds = new naver.maps.LatLngBounds();
      let count = 0;
      stores.forEach((s) => {
        if (s.lat == null || s.lng == null) return;
        const position = new naver.maps.LatLng(s.lat, s.lng);
        const marker = new naver.maps.Marker({ position, map, title: s.name });
        const info = new naver.maps.InfoWindow({
          content: `
            <div style="padding:8px 12px;min-width:180px;font-size:13px">
              <strong>${escapeHtml(s.name)}</strong><br/>
              ${s.address ? escapeHtml(s.address) + '<br/>' : ''}
              ${s.memo ? '<span style="color:#888">' + escapeHtml(s.memo) + '</span><br/>' : ''}
              ${s.url ? '<a href="' + encodeURI(s.url) + '" target="_blank" rel="noopener">네이버 지도에서 보기</a>' : ''}
            </div>`,
        });
        naver.maps.Event.addListener(marker, 'click', () => info.open(map, marker));
        markers.push(marker);
        bounds.extend(position);
        count++;
      });
      if (count > 0) map.fitBounds(bounds);
    },

    focus(store) {
      if (!ready() || !map || store.lat == null || store.lng == null) return;
      const pos = new naver.maps.LatLng(store.lat, store.lng);
      map.setCenter(pos);
      map.setZoom(16);
    },

    geocode(address) {
      return new Promise((resolve) => {
        if (!ready() || !naver.maps.Service) { resolve(null); return; }
        naver.maps.Service.geocode({ query: address }, function (status, response) {
          if (status !== naver.maps.Service.Status.OK) { resolve(null); return; }
          const items = response.v2 && response.v2.addresses;
          if (!items || items.length === 0) { resolve(null); return; }
          const first = items[0];
          resolve({
            lat: parseFloat(first.y),
            lng: parseFloat(first.x),
            address: first.roadAddress || first.jibunAddress || null,
          });
        });
      });
    },

    /**
     * Naver Map URL 파싱 (best-effort)
     * 추출 시도:
     *   - name: searchText / bk_query / path의 search 다음 세그먼트
     *   - placeId: path의 place 다음 세그먼트
     *   - lat/lng: c= 파라미터에서 한국 좌표 범위 매칭
     * 단축 URL(naver.me/...)은 CORS 때문에 해석 불가.
     */
    parseUrl(url) {
      if (!url) return null;
      const result = { name: null, placeId: null, lat: null, lng: null, address: null, url };
      try {
        const u = new URL(url);

        // 1) Query 파라미터 기반
        const searchText = u.searchParams.get('searchText');
        const bkQuery = u.searchParams.get('bk_query');
        if (searchText) result.name = safeDecode(searchText);
        else if (bkQuery) result.name = safeDecode(bkQuery);

        // 2) 경로 기반: /p/search/{name}/place/{id} or /p/entry/place/{id}
        const pathParts = u.pathname.split('/').filter(Boolean);
        const searchIdx = pathParts.indexOf('search');
        if (searchIdx >= 0 && pathParts[searchIdx + 1] && !result.name) {
          result.name = safeDecode(pathParts[searchIdx + 1]);
        }
        const placeIdx = pathParts.indexOf('place');
        if (placeIdx >= 0 && pathParts[placeIdx + 1]) {
          result.placeId = pathParts[placeIdx + 1].split('?')[0];
        }

        // 3) c= 좌표
        const c = u.searchParams.get('c');
        if (c) {
          const parts = c.split(',').map(Number).filter((n) => !Number.isNaN(n));
          for (let i = 0; i < parts.length - 1; i++) {
            const a = parts[i], b = parts[i + 1];
            // Korean lng range 124~132, lat range 33~39
            if (a >= 124 && a <= 132 && b >= 33 && b <= 39) { result.lng = a; result.lat = b; break; }
            if (b >= 124 && b <= 132 && a >= 33 && a <= 39) { result.lat = a; result.lng = b; break; }
          }
        }

        // placePath 안의 추가 쿼리(bk_query 등)도 시도
        const placePath = u.searchParams.get('placePath');
        if (placePath && !result.name) {
          const fakeUrl = 'https://x' + (placePath.startsWith('/') ? placePath : '/' + placePath);
          try {
            const p = new URL(fakeUrl);
            const bk2 = p.searchParams.get('bk_query');
            if (bk2) result.name = safeDecode(bk2);
          } catch (e) { /* ignore */ }
        }

        return result;
      } catch (e) {
        return null;
      }
    },

    /**
     * 지도 클릭 모드 활성화. 다음 클릭 좌표가 callback(lat, lng)로 전달되고
     * 자동으로 모드 종료.
     */
    enablePickMode(callback) {
      if (!ready() || !map) return;
      this.disablePickMode();
      pickModeCallback = callback;
      const el = map.getElement && map.getElement();
      if (el) el.style.cursor = 'crosshair';
      pickModeListener = naver.maps.Event.addListener(map, 'click', (e) => {
        const cb = pickModeCallback;
        const lat = e.coord.lat();
        const lng = e.coord.lng();
        this.disablePickMode();
        if (cb) cb(lat, lng);
      });
    },

    disablePickMode() {
      if (pickModeListener) {
        naver.maps.Event.removeListener(pickModeListener);
        pickModeListener = null;
      }
      pickModeCallback = null;
      if (map) {
        const el = map.getElement && map.getElement();
        if (el) el.style.cursor = '';
      }
    },

    isPickMode() { return pickModeListener != null; },
  };

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  window.Maps = Maps;
})();
