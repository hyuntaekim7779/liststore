/**
 * App orchestrator. 3-tab UI: 점심 / 저녁 / 설정
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    activeTab: 'lunch',           // 'lunch' | 'dinner' | 'settings'
    meal: 'lunch',                // 'lunch' | 'dinner' (현재 작업 대상 식사)
    selectedStoreId: null,
    voteTimer: null,
    pickingForStoreId: null,      // 좌표 지정 모드 대상
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    updateStorageStatus();
    Maps.init('map');
    Roulette.init('roulette-canvas');

    bindTabs();
    bindStoreForm();
    bindAutoAdd();
    bindRoulette();
    bindVoting();
    bindStorageErrors();

    // 점심/저녁 데이터 미리 로드
    await Stores.load('lunch');
    await Stores.load('dinner');
    await Voting.load('lunch');
    await Voting.load('dinner');

    await switchTab('lunch');
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Maps.isPickMode()) cancelPickMode();
    });

    startPolling();
  }

  function updateStorageStatus() {
    const el = $('#storage-status');
    if (!el) return;
    const mode = window.AppConfig && window.AppConfig.storage;
    if (mode === 'azure') {
      const acct = (window.AppConfig.azure && window.AppConfig.azure.account) || '?';
      el.innerHTML = `☁️ Azure Tables 연결됨 (<code>${acct}</code>) · 실시간 공유 모드`;
    } else {
      el.textContent = '💾 localStorage (이 브라우저에만 저장)';
    }
  }

  // ---------- 실시간 폴링 (Azure 모드일 때 데이터 동기화) ----------
  let pollTimerHandle = null;
  let pollCurrentMs = 0;

  function startPolling() {
    if (!window.AppConfig || window.AppConfig.storage !== 'azure') return;
    schedulePoll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        pollNow();
        schedulePoll();
      }
    });
  }

  function schedulePoll() {
    const v = Voting.get(state.meal);
    const voteOpen = v && Voting.status(v) === 'open';
    const desired = voteOpen
      ? (window.AppConfig.pollIntervalVoteMs || 3000)
      : (window.AppConfig.pollIntervalMs || 8000);
    if (desired === pollCurrentMs && pollTimerHandle) return;
    if (pollTimerHandle) clearInterval(pollTimerHandle);
    pollCurrentMs = desired;
    pollTimerHandle = setInterval(pollNow, desired);
  }

  async function pollNow() {
    if (document.visibilityState === 'hidden') return;
    if (state.pickingForStoreId) return; // 좌표 지정 중에는 방해 X
    try {
      await Stores.load('lunch');
      await Stores.load('dinner');
      await Voting.load(state.meal);
    } catch (e) {
      console.warn('poll failed:', e);
      return;
    }
    // 활성 탭 기준으로 UI 갱신
    if (state.activeTab === 'lunch' || state.activeTab === 'dinner') {
      renderStoreList();
      Maps.renderStores(Stores.get(state.meal));
      renderVote();
    } else if (state.activeTab === 'settings') {
      renderSettingsStoreList();
    }
    schedulePoll();
  }

  // ---------- Tabs ----------
  function bindTabs() {
    $$('.meal-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // settings 안의 식사 선택 라디오
    $$('input[name="reg-meal"]').forEach((r) => {
      r.addEventListener('change', () => {
        state.meal = r.value;
        renderSettingsStoreList();
      });
    });
  }

  async function switchTab(tab) {
    cancelPickMode();
    state.activeTab = tab;
    $$('.meal-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'settings') {
      $('#panel-meal').classList.add('hidden');
      $('#panel-settings').classList.remove('hidden');
      $$('input[name="reg-meal"]').forEach((r) => { r.checked = (r.value === state.meal); });
      renderSettingsStoreList();
      return;
    }

    // lunch/dinner
    state.meal = tab;
    state.selectedStoreId = null;
    $('#panel-settings').classList.add('hidden');
    $('#panel-meal').classList.remove('hidden');

    renderStoreList();
    Maps.renderStores(Stores.get(state.meal));
    Roulette.setItems([]);
    $('#roulette-result').textContent = '';
    $('#btn-spin').disabled = true;
    renderVote();
  }

  // ---------- 공통: URL로 가게 등록 ----------
  /**
   * URL(필수가 아님) + 이름(선택)으로 가게 등록.
   * statusCb(kind, msg): 'success' | 'warn' | 'error' | '' (info)
   * 반환: { store, warnNoCoords }
   */
  async function registerStoreSmart({ meal, url, manualName, memo, statusCb }) {
    const setStatus = (kind, msg) => { if (statusCb) statusCb(kind, msg); };

    let name = (manualName || '').trim() || null;
    let placeId = null;
    let lat = null, lng = null, address = null, phone = null, category = null;

    if (url) {
      setStatus('', '🔍 URL 분석 중…');
      const parsed = Maps.parseUrl(url);
      if (parsed) {
        if (!name && parsed.name) name = parsed.name;
        placeId = parsed.placeId;
        if (parsed.lat != null) { lat = parsed.lat; lng = parsed.lng; }
      }
    }

    if (!name && !placeId) {
      setStatus('error', '가게 이름이나 URL의 place ID를 찾을 수 없습니다.');
      return null;
    }

    if (placeId && window.AppConfig && window.AppConfig.placeLookup && window.NaverApi) {
      setStatus('', `🌐 네이버 지도에서 place ${placeId} 조회 중…`);
      try {
        const info = await NaverApi.getPlaceById(placeId);
        if (info) {
          if (info.name && !manualName) name = info.name;
          if (info.address) address = info.address;
          if (info.lat != null && info.lng != null) { lat = info.lat; lng = info.lng; }
          if (info.phone) phone = info.phone;
          if (info.category) category = info.category;
        }
      } catch (e) { console.warn('NaverApi lookup failed:', e); }
    }

    if ((lat == null || lng == null) && name) {
      setStatus('', `🔍 "${name}" 좌표 검색 중…`);
      const geo = await Maps.geocode(name);
      if (geo) { lat = geo.lat; lng = geo.lng; if (!address) address = geo.address; }
    }

    const warnNoCoords = (lat == null || lng == null);
    const finalName = name || (placeId ? `장소 ${placeId}` : '이름 없음');

    const store = await Stores.add(meal, {
      name: finalName,
      url: url || '',
      address: address || '',
      lat, lng,
      memo: (memo || '').trim(),
      placeId: placeId || null,
      phone: phone || null,
      category: category || null,
    });

    if (warnNoCoords) {
      setStatus('warn', `✓ "${finalName}" 등록됨. 좌표 자동 추출 실패 — 설정에서 "📍 지도에서 지정" 으로 위치를 잡아주세요.`);
    } else {
      setStatus('success', `✅ "${finalName}" 등록 완료. (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
    }

    return { store, warnNoCoords };
  }

  // ---------- Settings: Auto-add (URL 폼) ----------
  function bindAutoAdd() {
    $('#btn-auto-add').addEventListener('click', async () => {
      const url = $('#reg-url').value.trim();
      const meal = ($$('input[name="reg-meal"]').find((r) => r.checked) || {}).value || 'lunch';
      const statusEl = $('#auto-add-status');

      const setStatus = (kind, msg) => {
        statusEl.className = 'auto-status ' + (kind || '');
        statusEl.textContent = msg;
      };

      if (!url) {
        setStatus('error', 'URL을 입력해주세요.');
        return;
      }

      const result = await registerStoreSmart({ meal, url, statusCb: setStatus });
      if (!result) return;

      $('#reg-url').value = '';
      state.meal = meal;
      $$('input[name="reg-meal"]').forEach((r) => { r.checked = (r.value === meal); });
      renderSettingsStoreList();
      if (result.warnNoCoords) beginPickMode(result.store.id);
    });
  }

  // ---------- Settings: Manual form ----------
  function bindStoreForm() {
    $('#store-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const meal = $$('input[name="reg-meal"]').find((r) => r.checked).value;
      const name = $('#store-name').value.trim();
      if (!name) return;

      let lat = $('#store-lat').value;
      let lng = $('#store-lng').value;
      const url = $('#store-url').value.trim();
      const address = $('#store-address').value.trim();

      if ((!lat || !lng) && url) {
        const parsed = Maps.parseUrl(url);
        if (parsed && parsed.lat != null) { lat = parsed.lat; lng = parsed.lng; }
      }
      if ((!lat || !lng) && address) {
        const r = await Maps.geocode(address);
        if (r) { lat = r.lat; lng = r.lng; }
      }

      await Stores.add(meal, {
        name, url, address,
        lat: lat || null,
        lng: lng || null,
        memo: $('#store-memo').value.trim(),
      });
      $('#store-form').reset();
      state.meal = meal;
      $$('input[name="reg-meal"]').forEach((r) => { r.checked = (r.value === meal); });
      renderSettingsStoreList();
    });

    $('#btn-geocode').addEventListener('click', async () => {
      const address = $('#store-address').value.trim();
      const url = $('#store-url').value.trim();
      let result = null;
      if (url) {
        const p = Maps.parseUrl(url);
        if (p && p.lat != null) result = { lat: p.lat, lng: p.lng };
      }
      if (!result && address) result = await Maps.geocode(address);
      if (result) {
        $('#store-lat').value = result.lat;
        $('#store-lng').value = result.lng;
      } else {
        alert('좌표를 찾지 못했습니다. 주소를 더 상세히 입력하거나, 위도/경도를 직접 입력해주세요.');
      }
    });
  }

  // ---------- Settings: Store list + pick mode ----------
  function renderSettingsStoreList() {
    const list = $('#settings-store-list');
    const stores = Stores.get(state.meal);
    $('#settings-store-count').textContent = `(${stores.length})`;
    list.innerHTML = '';
    if (stores.length === 0) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 가게가 없습니다.</li>';
      return;
    }
    stores.forEach((s) => {
      const li = document.createElement('li');
      const noCoords = (s.lat == null || s.lng == null);
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(s.name)}
            ${noCoords ? '<span class="s-badge warn">좌표 미확인</span>' : ''}
          </div>
          <div class="s-meta">
            ${buildStoreMetaHtml(s, true)}
          </div>
        </div>
        <div class="s-actions">
          ${s.url ? `<button data-action="open">🔗</button>` : ''}
          <button class="pick" data-action="pick">📍 지도에서 지정</button>
          <button class="delete" data-action="delete">삭제</button>
        </div>
      `;
      li.addEventListener('click', async (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        if (action === 'delete') {
          if (confirm(`"${s.name}" 삭제할까요?`)) {
            await Stores.remove(state.meal, s.id);
            renderSettingsStoreList();
          }
          return;
        }
        if (action === 'open') { window.open(s.url, '_blank', 'noopener'); return; }
        if (action === 'pick') { beginPickMode(s.id); return; }
      });
      list.appendChild(li);
    });
  }

  let settingsMap = null;
  let settingsMarkers = [];

  function ensureSettingsMap() {
    if (settingsMap || typeof naver === 'undefined') return;
    settingsMap = new naver.maps.Map('settings-map', {
      center: new naver.maps.LatLng(37.5666103, 126.9783882),
      zoom: 14,
    });
  }

  function renderSettingsMapMarkers(focusStore) {
    if (!settingsMap) return;
    settingsMarkers.forEach((m) => m.setMap(null));
    settingsMarkers = [];
    const stores = Stores.get(state.meal);
    const bounds = new naver.maps.LatLngBounds();
    let count = 0;
    stores.forEach((s) => {
      if (s.lat == null) return;
      const pos = new naver.maps.LatLng(s.lat, s.lng);
      const marker = new naver.maps.Marker({ position: pos, map: settingsMap, title: s.name });
      settingsMarkers.push(marker);
      bounds.extend(pos);
      count++;
    });
    if (focusStore && focusStore.lat != null) {
      settingsMap.setCenter(new naver.maps.LatLng(focusStore.lat, focusStore.lng));
      settingsMap.setZoom(16);
    } else if (count > 0) {
      settingsMap.fitBounds(bounds);
    }
  }

  function beginPickMode(storeId) {
    const store = Stores.getById(state.meal, storeId);
    if (!store) return;
    state.pickingForStoreId = storeId;
    $('#settings-map-wrap').classList.remove('hidden');
    $('#pick-mode-hint').textContent =
      `"${store.name}" 의 위치를 지도에서 클릭해주세요. (ESC로 취소)`;

    ensureSettingsMap();
    renderSettingsMapMarkers(store);

    if (typeof naver === 'undefined') return;
    // Use a dedicated click listener on the settings map.
    if (settingsMap._pickListener) {
      naver.maps.Event.removeListener(settingsMap._pickListener);
    }
    settingsMap.getElement().style.cursor = 'crosshair';
    settingsMap._pickListener = naver.maps.Event.addListener(settingsMap, 'click', async (e) => {
      const lat = e.coord.lat();
      const lng = e.coord.lng();
      const sid = state.pickingForStoreId;
      if (!sid) return;
      const stores = Stores.get(state.meal);
      const idx = stores.findIndex((x) => x.id === sid);
      if (idx >= 0) {
        stores[idx].lat = lat;
        stores[idx].lng = lng;
        await Storage.saveStores(state.meal, stores);
      }
      cancelPickMode();
      renderSettingsStoreList();
      renderSettingsMapMarkers(stores[idx]);
      // 잠시 후 패널 닫기
      setTimeout(() => $('#settings-map-wrap').classList.add('hidden'), 1500);
    });

    // 스크롤
    setTimeout(() => $('#settings-map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function cancelPickMode() {
    if (settingsMap) {
      if (settingsMap._pickListener) {
        naver.maps.Event.removeListener(settingsMap._pickListener);
        settingsMap._pickListener = null;
      }
      const el = settingsMap.getElement && settingsMap.getElement();
      if (el) el.style.cursor = '';
    }
    state.pickingForStoreId = null;
  }

  // ---------- Meal panel: Store list (read-only) ----------
  function renderStoreList() {
    const list = $('#store-list');
    const stores = Stores.get(state.meal);
    $('#store-count').textContent = `(${stores.length})`;
    list.innerHTML = '';
    if (stores.length === 0) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 가게가 없습니다. 설정에서 추가해주세요.</li>';
      return;
    }
    stores.forEach((s) => {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      if (state.selectedStoreId === s.id) li.classList.add('selected');
      const noCoords = (s.lat == null || s.lng == null);
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(s.name)}
            ${noCoords ? '<span class="s-badge warn">좌표 미확인</span>' : ''}
          </div>
          <div class="s-meta">
            ${buildStoreMetaHtml(s, false)}
          </div>
        </div>
        <div class="s-actions">
          ${s.url ? `<button data-action="open">🔗</button>` : ''}
        </div>
      `;
      li.addEventListener('click', (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        if (action === 'open') { window.open(s.url, '_blank', 'noopener'); return; }
        state.selectedStoreId = s.id;
        renderStoreList();
        Maps.focus(s);
      });
      list.appendChild(li);
    });
  }

  // ---------- Roulette ----------
  function bindRoulette() {
    $('#btn-pick-roulette').addEventListener('click', () => {
      const picks = Stores.pickRandom(state.meal, 5);
      if (picks.length < 2) {
        alert('가게를 최소 2곳 이상 등록해주세요.');
        return;
      }
      Roulette.setItems(picks);
      $('#btn-spin').disabled = false;
      $('#roulette-result').textContent = `후보 ${picks.length}곳을 무작위로 선정했습니다.`;
      $('#roulette-result').classList.remove('winner');
    });

    $('#btn-spin').addEventListener('click', () => {
      $('#btn-spin').disabled = true;
      $('#roulette-result').textContent = '돌리는 중…';
      $('#roulette-result').classList.remove('winner');
      Roulette.spin((winner) => {
        $('#roulette-result').textContent = `🎉 오늘은 "${winner.name}" 입니다!`;
        $('#roulette-result').classList.add('winner');
        $('#btn-spin').disabled = false;
      });
    });
  }

  // ---------- Voting ----------
  function bindVoting() {
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60 * 1000);
    $('#vote-start').value = toLocalDtInput(now);
    $('#vote-end').value = toLocalDtInput(later);

    $('#btn-pick-vote').addEventListener('click', () => {
      const count = Math.max(2, Math.min(10, parseInt($('#vote-candidate-count').value, 10) || 4));
      const picks = Stores.pickRandom(state.meal, count);
      if (picks.length < 2) {
        alert('가게를 최소 2곳 이상 등록해주세요.');
        return;
      }
      renderVotePreview(picks);
    });

    $('#btn-create-vote').addEventListener('click', async () => {
      const startAt = new Date($('#vote-start').value).getTime();
      const endAt = new Date($('#vote-end').value).getTime();
      const candidates = window.__pendingVoteCandidates;
      if (!candidates || candidates.length < 2) {
        alert('먼저 "후보 무작위 선정" 버튼으로 후보를 뽑아주세요.');
        return;
      }
      try {
        await Voting.create(state.meal, candidates, startAt, endAt);
        window.__pendingVoteCandidates = null;
        renderVote();
      } catch (e) { alert(e.message); }
    });

    $('#btn-cancel-vote').addEventListener('click', async () => {
      if (!confirm('현재 투표를 종료/삭제하시겠어요?')) return;
      await Voting.clear(state.meal);
      renderVote();
    });
  }

  function renderVotePreview(picks) {
    window.__pendingVoteCandidates = picks.map((s) => ({ id: s.id, name: s.name }));
    const ul = $('#vote-candidates');
    ul.innerHTML = '';
    picks.forEach((c) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(c.name)}</span><span class="muted">대기 중</span>`;
      ul.appendChild(li);
    });
    $('#vote-active').classList.remove('hidden');
    $('#vote-status-label').textContent = '🟡 후보 선정됨 — 시작/종료 시간 확인 후 [투표 생성]을 눌러주세요.';
    $('#vote-timer').textContent = '';
    $('#vote-results').innerHTML = '';
  }

  function renderVote() {
    clearVoteTimer();
    const vote = Voting.get(state.meal);
    if (!vote) {
      $('#vote-active').classList.add('hidden');
      return;
    }
    $('#vote-active').classList.remove('hidden');

    const status = Voting.status(vote);
    const statusLabel = {
      pending: '🟡 투표 대기 중 (아직 시작 전)',
      open:    '🟢 투표 진행 중',
      ended:   '🔴 투표 종료',
    }[status];
    $('#vote-status-label').textContent = statusLabel;
    $('#vote-timer').textContent = formatVoteRange(vote);

    const ul = $('#vote-candidates');
    ul.innerHTML = '';
    vote.candidates.forEach((c) => {
      const li = document.createElement('li');
      const count = (vote.votes[c.id] || []).length;
      const disabled = status !== 'open';
      li.innerHTML = `
        <span>${escapeHtml(c.name)} <span class="muted">· ${count}표</span></span>
        <button data-cid="${c.id}" ${disabled ? 'disabled' : ''}>${disabled ? '투표 불가' : '투표하기'}</button>
      `;
      li.querySelector('button').addEventListener('click', async () => {
        const name = $('#voter-name').value.trim();
        if (!name) { alert('투표자 이름을 먼저 입력해주세요.'); $('#voter-name').focus(); return; }
        try {
          await Voting.cast(state.meal, c.id, name);
          renderVote();
        } catch (e) { alert(e.message); }
      });
      ul.appendChild(li);
    });

    const res = $('#vote-results');
    res.innerHTML = '';
    const totalVotes = Object.values(vote.votes).reduce((a, list) => a + list.length, 0);
    const sorted = [...vote.candidates].sort(
      (a, b) => (vote.votes[b.id] || []).length - (vote.votes[a.id] || []).length
    );
    sorted.forEach((c) => {
      const voters = vote.votes[c.id] || [];
      const pct = totalVotes ? Math.round((voters.length / totalVotes) * 100) : 0;
      const li = document.createElement('li');
      li.innerHTML = `
        <span><strong>${escapeHtml(c.name)}</strong></span>
        <span class="muted">${voters.length}표 (${pct}%)</span>
        <div class="bar"><div style="width:${pct}%"></div></div>
        ${voters.length ? `<div class="voters">${voters.map(escapeHtml).join(', ')}</div>` : ''}
      `;
      res.appendChild(li);
    });

    if (status !== 'ended') {
      state.voteTimer = setInterval(() => {
        $('#vote-timer').textContent = formatVoteRange(vote);
        const newStatus = Voting.status(vote);
        if (newStatus !== status) renderVote();
      }, 1000);
    }
  }

  function clearVoteTimer() {
    if (state.voteTimer) { clearInterval(state.voteTimer); state.voteTimer = null; }
  }

  function formatVoteRange(vote) {
    const fmt = (ts) => {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const now = Date.now();
    let suffix = '';
    if (now < vote.startAt) suffix = ` · 시작까지 ${formatDuration(vote.startAt - now)}`;
    else if (now <= vote.endAt) suffix = ` · 종료까지 ${formatDuration(vote.endAt - now)}`;
    else suffix = ' · 종료됨';
    return `${fmt(vote.startAt)} ~ ${fmt(vote.endAt)}${suffix}`;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}시간 ${m}분`;
    if (m) return `${m}분 ${sec}초`;
    return `${sec}초`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function toLocalDtInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  /** UI 표시용 memo 정리 — 옛 placeId:xxx 문자열을 제거. */
  function cleanMemoForDisplay(memo) {
    if (!memo) return '';
    return String(memo)
      .replace(/\s*·\s*placeId:\S+/gi, '')
      .replace(/^placeId:\S+\s*·?\s*/i, '')
      .trim();
  }

  /**
   * 가게 한 줄 메타 표시. placeId 는 의도적으로 노출하지 않음.
   * @param {boolean} showCoords - 좌표 텍스트를 함께 표시할지 여부
   */
  function buildStoreMetaHtml(s, showCoords) {
    const parts = [];
    if (s.address) parts.push(escapeHtml(s.address));
    if (s.category) parts.push(escapeHtml(s.category));
    if (s.phone) parts.push(escapeHtml(s.phone));
    const cleanedMemo = cleanMemoForDisplay(s.memo);
    if (cleanedMemo) parts.push(escapeHtml(cleanedMemo));
    if (showCoords && s.lat != null && s.lng != null) {
      parts.push(`${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`);
    }
    return parts.join(' · ');
  }

  // ---------- Storage 오류 배너 ----------
  function bindStorageErrors() {
    let lastShownAt = 0;
    window.addEventListener('storage-error', (e) => {
      const now = Date.now();
      if (now - lastShownAt < 4000) return;
      lastShownAt = now;
      const banner = $('#storage-error-banner');
      if (!banner) return;
      const detail = (e.detail || {});
      banner.innerHTML = `
        ⚠️ Azure 저장소 연결 오류 (${escapeHtml(String(detail.status || 'network'))}).
        브라우저 콘솔(F12)에서 자세한 메시지를 확인하세요.
        <br/><small>가능한 원인: 테이블 미생성 / CORS 미설정 / SAS 만료.</small>
      `;
      banner.classList.remove('hidden');
      setTimeout(() => banner.classList.add('hidden'), 8000);
    });
  }
})();
