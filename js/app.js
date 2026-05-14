/**
 * App orchestrator. meal tabs + settings UI.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const MEAL_TYPES = ['lunch', 'dinner', 'fridayLunch'];

  const state = {
    activeTab: 'lunch',           // meal tab key | 'settings'
    meal: 'lunch',                // 현재 작업 대상 식사 타입
    selectedStoreId: null,
    voteTimer: null,
    pickingForStoreId: null,      // 좌표 지정 모드 대상
    people: [],
    cautions: [],
    cautionStoreBlocks: {},
    assignments: { outside: [], lunchbox: [] },
    assignmentsResetDate: '',
    settingsSubtab: 'people',
    randomHistoryByMeal: { lunch: [], dinner: [], fridayLunch: [] },
    mainStoreSearch: '',
    settingsStoreSearch: '',
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    updateStorageStatus();
    Maps.init('map');
    Roulette.init('roulette-canvas');

    bindTabs();
    bindStoreForm();
    bindAutoAdd();
    bindStoreSearch();
    bindRoulette();
    bindVoting();
    bindPeopleAndCautions();
    bindSettingsSubtabs();
    bindRandomHistoryManager();
    bindTitleQuickSwitch();
    bindMapActions();
    bindStorageErrors();

    // 식사 타입 데이터 미리 로드
    for (const meal of MEAL_TYPES) {
      await Stores.load(meal);
      await Voting.load(meal);
      await loadRandomHistoryForMeal(meal);
    }
    await loadPeopleData();

    await switchTab(getInitialMealTabBySeoulTime());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Maps.isPickMode()) cancelPickMode();
    });

    startPolling();
    startDailyAssignmentsResetWatcher();
    startVoteAutoResetWatcher();
    startTodayGroupTitleWatcher();
    updateTodayGroupTitle();
    renderPeopleAndAssignments();
    renderCautions();
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

  const PEOPLE_KEY = 'ls.people.v1';
  const CAUTION_KEY = 'ls.cautions.v1';
  const ASSIGN_KEY = 'ls.assignments.v1';
  const ASSIGN_RESET_KEY = 'ls.assignments.reset.date.v1';
  const ROLE_OPTIONS = ['사원 (선임)', '대리', '과장', '차장', '부장', '이사', '팀장님'];
  const RANDOM_BLOCK_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
  const HISTORY_ADMIN_PASSWORD = 'MTP2026';

  async function loadPeopleData() {
    let bundle = null;
    if (window.Storage && typeof window.Storage.getPeopleBundle === 'function') {
      try {
        bundle = await window.Storage.getPeopleBundle();
      } catch (e) {
        console.warn('getPeopleBundle failed, fallback to local:', e);
      }
    }
    if (!bundle) {
      bundle = {
        people: safeLocalParse(PEOPLE_KEY, []),
        cautions: safeLocalParse(CAUTION_KEY, []),
        cautionStoreBlocks: {},
        assignments: safeLocalParse(ASSIGN_KEY, { outside: [], lunchbox: [] }),
        resetDate: localStorage.getItem(ASSIGN_RESET_KEY) || '',
      };
    }
    state.people = normalizePeople(bundle.people || []);
    state.cautions = normalizeCautions(bundle.cautions || []);
    state.cautionStoreBlocks = normalizeCautionStoreBlocks(bundle.cautionStoreBlocks || {});
    const peopleNames = new Set(state.people.map((p) => p.name));
    state.cautions = state.cautions.filter((c) => peopleNames.has(c.name));
    Object.keys(state.cautionStoreBlocks).forEach((name) => {
      if (!peopleNames.has(name)) delete state.cautionStoreBlocks[name];
    });
    const loadedAssign = bundle.assignments || { outside: [], lunchbox: [] };
    state.assignments = {
      outside: Array.isArray(loadedAssign.outside) ? loadedAssign.outside : [],
      lunchbox: Array.isArray(loadedAssign.lunchbox) ? loadedAssign.lunchbox : [],
    };
    state.assignmentsResetDate = String(bundle.resetDate || '');
    normalizeAssignments();
    maybeResetAssignmentsAtTwoPm();
  }

  function savePeopleData() {
    persistPeopleBundle();
  }

  function normalizePeople(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((p) => {
        // 구버전 호환: ["홍길동", ...] 형태도 사람 목록으로 복원
        if (typeof p === 'string') {
          return {
            id: uid('p'),
            name: p.trim(),
            role: '사원 (선임)',
          };
        }
        return {
          id: p && p.id ? String(p.id) : uid('p'),
          name: p && p.name ? String(p.name).trim() : '',
          role: ROLE_OPTIONS.includes(p && p.role) ? p.role : '사원 (선임)',
        };
      })
      .filter((p) => p.name);
  }

  function saveCautions() {
    persistPeopleBundle();
  }

  function normalizeCautions(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((c) => ({
        id: c && c.id ? String(c.id) : uid('c'),
        name: c && c.name ? String(c.name).trim() : '',
        note: c && c.note ? String(c.note).trim() : '',
      }))
      .filter((c) => c.name && c.note);
  }

  function normalizeCautionStoreBlocks(input) {
    if (!input || typeof input !== 'object') return {};
    const out = {};
    Object.entries(input).forEach(([name, keys]) => {
      const normalizedName = String(name || '').trim();
      if (!normalizedName) return;
      const list = Array.isArray(keys) ? keys : [];
      const cleaned = Array.from(new Set(list.map((k) => String(k || '').trim()).filter(Boolean)));
      if (cleaned.length) out[normalizedName] = cleaned;
    });
    return out;
  }

  function saveAssignments() {
    normalizeAssignments();
    persistPeopleBundle();
  }

  function persistPeopleBundle() {
    const bundle = {
      people: state.people,
      cautions: state.cautions,
      cautionStoreBlocks: state.cautionStoreBlocks,
      assignments: state.assignments,
      resetDate: state.assignmentsResetDate || '',
    };
    if (window.Storage && typeof window.Storage.savePeopleBundle === 'function') {
      window.Storage.savePeopleBundle(bundle).catch((e) => {
        console.warn('savePeopleBundle failed, fallback to local:', e);
        localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.people));
        localStorage.setItem(CAUTION_KEY, JSON.stringify(state.cautions));
        localStorage.setItem(ASSIGN_KEY, JSON.stringify(state.assignments));
        localStorage.setItem(ASSIGN_RESET_KEY, state.assignmentsResetDate || '');
      });
      return;
    }
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(state.people));
    localStorage.setItem(CAUTION_KEY, JSON.stringify(state.cautions));
    localStorage.setItem(ASSIGN_KEY, JSON.stringify(state.assignments));
    localStorage.setItem(ASSIGN_RESET_KEY, state.assignmentsResetDate || '');
  }

  function safeLocalParse(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function normalizeAssignments() {
    const all = new Set(state.people.map((p) => p.name));
    state.assignments.outside = Array.from(new Set(state.assignments.outside.filter((n) => all.has(n))));
    state.assignments.lunchbox = Array.from(new Set(state.assignments.lunchbox.filter((n) => all.has(n))));
    const outsideSet = new Set(state.assignments.outside);
    state.assignments.lunchbox = state.assignments.lunchbox.filter((n) => !outsideSet.has(n));
  }

  function maybeResetAssignmentsAtTwoPm() {
    const seoul = getSeoulDateTimeParts();
    if (seoul.hour < 14) return false;
    const lastResetDate = state.assignmentsResetDate || '';
    if (lastResetDate === seoul.dateKey) return false;
    state.assignments = { outside: [], lunchbox: [] };
    state.assignmentsResetDate = seoul.dateKey;
    saveAssignments();
    return true;
  }

  function startDailyAssignmentsResetWatcher() {
    setInterval(() => {
      const resetDone = maybeResetAssignmentsAtTwoPm();
      updateTodayGroupTitle();
      if (!resetDone) return;
      renderPeopleAndAssignments();
      if (MEAL_TYPES.includes(state.activeTab)) {
        renderStoreList();
        Maps.renderStores(getVisibleStores());
      }
    }, 60 * 1000);
  }

  function getSeoulDateTimeParts() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value || '0000';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    const day = parts.find((p) => p.type === 'day')?.value || '01';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return {
      dateKey: `${year}-${month}-${day}`,
      hour,
      minute,
    };
  }

  function updateTodayGroupTitle() {
    const titleEl = $('#today-group-title');
    if (!titleEl) return;
    titleEl.textContent = getTodayGroupTitleBySeoulTime();
  }

  function getTodayGroupTitleBySeoulTime() {
    // 사용자가 식사 탭을 직접 선택한 경우 탭 기준 문구를 우선 반영
    if (state.activeTab === 'lunch' || state.activeTab === 'fridayLunch') {
      return '오늘 점심🍽️';
    }
    if (state.activeTab === 'dinner') {
      return '오늘 저녁 및 회식🍺';
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const minutesFromMidnight = hour * 60 + minute;
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);

    if (isWeekday && minutesFromMidnight >= (9 * 60) && minutesFromMidnight <= (13 * 60)) {
      return '오늘 점심🍽️';
    }
    if (isWeekday && minutesFromMidnight >= (13 * 60 + 1) && minutesFromMidnight <= (19 * 60 + 30)) {
      return '오늘 저녁 및 회식🍺';
    }
    return '오늘 점심🍽️';
  }

  function startTodayGroupTitleWatcher() {
    setInterval(() => {
      updateTodayGroupTitle();
    }, 60 * 1000);
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

  function startVoteAutoResetWatcher() {
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        for (const meal of MEAL_TYPES) {
          await Voting.load(meal);
        }
        if (MEAL_TYPES.includes(state.activeTab)) {
          renderVote();
        }
      } catch (e) {
        console.warn('vote auto reset watcher failed:', e);
      } finally {
        running = false;
      }
    }, 60 * 1000);
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
      for (const meal of MEAL_TYPES) {
        await Stores.load(meal);
        await loadRandomHistoryForMeal(meal);
      }
      await Voting.load(state.meal);
      await loadPeopleData();
    } catch (e) {
      console.warn('poll failed:', e);
      return;
    }
    renderPeopleAndAssignments();
    renderCautions();
    // 활성 탭 기준으로 UI 갱신
    if (MEAL_TYPES.includes(state.activeTab)) {
      renderStoreList();
      Maps.renderStores(getVisibleStores());
      renderVote();
    } else if (state.activeTab === 'settings') {
      renderSettingsStoreList();
      if (state.settingsSubtab === 'history') renderRandomHistoryManager();
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

  function bindSettingsSubtabs() {
    $$('.settings-subtab').forEach((btn) => {
      btn.addEventListener('click', () => switchSettingsSubtab(btn.dataset.settingsTab));
    });
  }

  function bindStoreSearch() {
    const mainSearch = $('#store-search-main');
    if (mainSearch) {
      mainSearch.addEventListener('input', () => {
        state.mainStoreSearch = (mainSearch.value || '').trim().toLowerCase();
        renderStoreList();
      });
    }

    const syncSettingsSearch = (nextValue, sourceEl) => {
      state.settingsStoreSearch = (nextValue || '').trim().toLowerCase();
      const top = $('#store-search-settings-top');
      const list = $('#store-search-settings-list');
      [top, list].forEach((el) => {
        if (!el || el === sourceEl) return;
        el.value = nextValue || '';
      });
      if (state.activeTab === 'settings') renderSettingsStoreList();
    };

    const settingsTop = $('#store-search-settings-top');
    if (settingsTop) {
      settingsTop.addEventListener('input', () => {
        syncSettingsSearch(settingsTop.value, settingsTop);
      });
    }
    const settingsList = $('#store-search-settings-list');
    if (settingsList) {
      settingsList.addEventListener('input', () => {
        syncSettingsSearch(settingsList.value, settingsList);
      });
    }
  }

  function switchSettingsSubtab(tab) {
    state.settingsSubtab = tab;
    $$('.settings-subtab').forEach((b) => b.classList.toggle('active', b.dataset.settingsTab === tab));
    $$('.settings-subpanel').forEach((panel) =>
      panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab)
    );
    if (tab === 'taste-care') {
      renderCautionPersonOptions();
    }
    if (tab === 'history') {
      Promise.all(MEAL_TYPES.map((meal) => loadRandomHistoryForMeal(meal)))
        .then(() => renderRandomHistoryManager());
    }
  }

  function bindPeopleAndCautions() {
    const addPersonBtn = $('#btn-add-person');
    if (addPersonBtn) {
      addPersonBtn.addEventListener('click', () => {
        const input = $('#person-name');
        const roleEl = $('#person-role');
        const name = (input && input.value || '').trim();
        const role = roleEl && ROLE_OPTIONS.includes(roleEl.value) ? roleEl.value : '사원 (선임)';
        if (!name) return;
        if (state.people.some((p) => p.name === name)) {
          alert('이미 등록된 대상자입니다.');
          return;
        }
        state.people.push({ id: uid('p'), name, role });
        if (input) input.value = '';
        if (roleEl) roleEl.value = '사원 (선임)';
        savePeopleData();
        saveAssignments();
        renderPeopleAndAssignments();
        renderCautions();
        renderCautionPersonOptions();
      });
    }

    const addCautionBtn = $('#btn-add-caution');
    if (addCautionBtn) {
      addCautionBtn.addEventListener('click', () => {
        const nameEl = $('#caution-person');
        const noteEl = $('#caution-note');
        const name = (nameEl && nameEl.value || '').trim();
        const note = (noteEl && noteEl.value || '').trim();
        if (!name || !note) {
          alert('대상자와 주의 내용을 모두 입력해주세요.');
          return;
        }
        if (state.cautions.some((c) => c.name === name && c.note === note)) {
          alert('이미 동일한 주의 태그가 등록되어 있습니다.');
          return;
        }
        state.cautions.push({ id: uid('c'), name, note });
        if (noteEl) noteEl.value = '';
        saveCautions();
        renderCautions();
      });
    }

    const cautionPersonEl = $('#caution-person');
    if (cautionPersonEl) {
      cautionPersonEl.addEventListener('change', () => {
        renderCautionStoreBlockSummary();
      });
    }

    const cautionStoreBtn = $('#btn-caution-store-blocks');
    if (cautionStoreBtn) {
      cautionStoreBtn.addEventListener('click', async () => {
        const personEl = $('#caution-person');
        const personName = (personEl && personEl.value || '').trim();
        if (!personName) {
          alert('먼저 대상자를 선택해주세요.');
          return;
        }
        const selected = await openCautionStoreBlocksEditor(personName);
        if (!selected) return;
        if (selected.length) state.cautionStoreBlocks[personName] = selected;
        else delete state.cautionStoreBlocks[personName];
        saveCautions();
        renderCautions();
        renderCautionStoreBlockSummary();
      });
    }

    ['outside', 'lunchbox', 'pool'].forEach((group) => {
      const zone = $(`#drop-${group}`);
      if (!zone) return;
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const name = e.dataTransfer && e.dataTransfer.getData('text/plain');
        if (!name) return;
        movePersonToGroup(name, group);
      });
    });
  }

  function movePersonToGroup(name, group) {
    state.assignments.outside = state.assignments.outside.filter((n) => n !== name);
    state.assignments.lunchbox = state.assignments.lunchbox.filter((n) => n !== name);
    if (group === 'outside') state.assignments.outside.push(name);
    if (group === 'lunchbox') state.assignments.lunchbox.push(name);
    saveAssignments();
    renderPeopleAndAssignments();
  }

  function renderPeopleAndAssignments() {
    normalizeAssignments();
    renderCautionPersonOptions();
    renderPersonSettingsList();

    const outside = $('#drop-outside');
    const lunchbox = $('#drop-lunchbox');
    const pool = $('#drop-pool');
    if (!outside || !lunchbox || !pool) return;
    outside.innerHTML = '';
    lunchbox.innerHTML = '';
    pool.innerHTML = '';

    const outsideSet = new Set(state.assignments.outside);
    const lunchboxSet = new Set(state.assignments.lunchbox);
    const allNames = state.people.map((p) => p.name);
    const poolNames = allNames.filter((n) => !outsideSet.has(n) && !lunchboxSet.has(n));

    state.assignments.outside.forEach((name) => outside.appendChild(buildPersonTag(name)));
    state.assignments.lunchbox.forEach((name) => lunchbox.appendChild(buildPersonTag(name)));
    poolNames.forEach((name) => pool.appendChild(buildPersonTag(name)));

    $('#count-outside').textContent = `총 ${state.assignments.outside.length}명`;
    $('#count-lunchbox').textContent = `총 ${state.assignments.lunchbox.length}명`;
    const poolCount = $('#count-pool');
    if (poolCount) poolCount.textContent = `총 ${poolNames.length}명`;
  }

  function buildPersonTag(name) {
    const matched = state.people.find((p) => p.name === name);
    const role = matched && matched.role ? matched.role : '';
    const cautionNotes = getCautionNotesByName(name);
    const hasCaution = cautionNotes.length > 0;
    const tag = document.createElement('span');
    tag.className = 'person-tag';
    tag.draggable = true;
    tag.textContent = '';
    const label = document.createElement('span');
    label.className = 'person-tag-label';
    const personText = role ? `${name} ${role}` : name;
    label.textContent = hasCaution ? `📢 ${personText}` : personText;
    tag.appendChild(label);
    if (hasCaution) {
      tag.title = `입맛 보호 메모\n- ${cautionNotes.join('\n- ')}`;
    } else {
      tag.removeAttribute('title');
    }
    tag.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', name);
      e.dataTransfer.effectAllowed = 'move';
    });
    return tag;
  }

  function renderPersonSettingsList() {
    const list = $('#person-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.people.length) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 대상자가 없습니다.</li>';
      return;
    }
    state.people.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(p.name)}</div>
          <div class="s-meta">${escapeHtml(p.role)}</div>
        </div>
        <div class="s-actions">
          <button data-action="edit">✏️</button>
          <button data-action="delete">삭제</button>
        </div>`;
      li.addEventListener('click', (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        if (action === 'edit') {
          editPerson(p.id);
          return;
        }
        if (action !== 'delete') return;
        state.cautions = state.cautions.filter((c) => c.name !== p.name);
        delete state.cautionStoreBlocks[p.name];
        state.people = state.people.filter((x) => x.id !== p.id);
        savePeopleData();
        saveCautions();
        saveAssignments();
        renderPeopleAndAssignments();
        renderCautions();
      });
      list.appendChild(li);
    });
  }

  function editPerson(personId) {
    const idx = state.people.findIndex((p) => p.id === personId);
    if (idx < 0) return;
    const current = state.people[idx];
    const nextName = prompt('대상자 이름을 수정하세요.', current.name);
    if (nextName == null) return;
    const name = nextName.trim();
    if (!name) {
      alert('이름은 비워둘 수 없습니다.');
      return;
    }
    if (state.people.some((p, i) => i !== idx && p.name === name)) {
      alert('이미 등록된 대상자 이름입니다.');
      return;
    }
    const nextRole = prompt(
      `직책을 입력하세요.\n가능: ${ROLE_OPTIONS.join(', ')}`,
      current.role || '사원 (선임)'
    );
    if (nextRole == null) return;
    const role = nextRole.trim();
    if (!ROLE_OPTIONS.includes(role)) {
      alert('직책은 사원 (선임)/대리/과장/차장/부장/이사/팀장님 중에서 입력해주세요.');
      return;
    }
    const oldName = current.name;
    state.people[idx] = { ...current, name, role };
    // 분류 태그는 이름 문자열로 저장되므로 이름 변경 시 함께 치환
    state.assignments.outside = state.assignments.outside.map((n) => (n === oldName ? name : n));
    state.assignments.lunchbox = state.assignments.lunchbox.map((n) => (n === oldName ? name : n));
    state.cautions = state.cautions.map((c) => (c.name === oldName ? { ...c, name } : c));
    if (state.cautionStoreBlocks[oldName]) {
      state.cautionStoreBlocks[name] = [...state.cautionStoreBlocks[oldName]];
      delete state.cautionStoreBlocks[oldName];
    }
    savePeopleData();
    saveAssignments();
    saveCautions();
    renderPeopleAndAssignments();
    renderCautions();
  }

  function renderCautions() {
    const list = $('#caution-list');
    renderCautionPersonOptions();
    renderCautionStoreBlockSummary();
    if (!list) return;
    list.innerHTML = '';
    const hasBlocks = Object.keys(state.cautionStoreBlocks).length > 0;
    if (!state.cautions.length && !hasBlocks) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 입맛 보호 태그가 없습니다.</li>';
      return;
    }
    const grouped = new Map();
    state.cautions.forEach((c) => {
      if (!grouped.has(c.name)) grouped.set(c.name, []);
      grouped.get(c.name).push(c);
    });
    Object.keys(state.cautionStoreBlocks).forEach((name) => {
      if (!grouped.has(name)) grouped.set(name, []);
    });
    Array.from(grouped.entries()).forEach(([name, entries]) => {
      const li = document.createElement('li');
      const blockedKeys = Array.isArray(state.cautionStoreBlocks[name]) ? state.cautionStoreBlocks[name] : [];
      const blockedNames = blockedKeys.map((k) => getStoreLabelByBlockKey(k)).filter(Boolean);
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(name)}</div>
          <div class="caution-tags">
            ${entries.map((c) => `<button class="caution-chip" data-action="delete" data-id="${escapeHtml(c.id)}" title="삭제">${escapeHtml(c.note)} ✕</button>`).join('')}
          </div>
          ${blockedNames.length ? `<div class="s-meta">못가는 가게: ${escapeHtml(blockedNames.join(', '))}</div>` : ''}
        </div>
        <div class="s-actions">
          <button class="caution-edit-btn" data-action="edit-blocks" data-name="${escapeHtml(name)}" title="못가는 가게 수정">✍️</button>
        </div>`;
      li.addEventListener('click', (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        const targetId = e.target.dataset && e.target.dataset.id;
        const targetName = e.target.dataset && e.target.dataset.name;
        if (action === 'edit-blocks' && targetName) {
          openCautionStoreBlocksEditor(targetName).then((selected) => {
            if (!selected) return;
            if (selected.length) state.cautionStoreBlocks[targetName] = selected;
            else delete state.cautionStoreBlocks[targetName];
            saveCautions();
            renderCautions();
            renderPeopleAndAssignments();
          });
          return;
        }
        if (action !== 'delete' || !targetId) return;
        state.cautions = state.cautions.filter((x) => x.id !== targetId);
        saveCautions();
        renderPeopleAndAssignments();
        renderCautions();
      });
      list.appendChild(li);
    });
  }

  async function switchTab(tab) {
    cancelPickMode();
    state.activeTab = tab;
    updateTodayGroupTitle();
    $$('.meal-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'settings') {
      $('#panel-meal').classList.add('hidden');
      $('#panel-settings').classList.remove('hidden');
      $$('input[name="reg-meal"]').forEach((r) => { r.checked = (r.value === state.meal); });
      renderSettingsStoreList();
      switchSettingsSubtab(state.settingsSubtab || 'people');
      return;
    }

    // meal tabs
    state.meal = tab;
    state.selectedStoreId = null;
    await Voting.load(state.meal);
    $('#panel-settings').classList.add('hidden');
    $('#panel-meal').classList.remove('hidden');

    renderStoreList();
    Maps.renderStores(getVisibleStores());
    Roulette.setItems([]);
    $('#roulette-result').textContent = '';
    $('#btn-spin').disabled = true;
    renderVote();
  }

  function bindTitleQuickSwitch() {
    const title = $('#app-title');
    if (!title) return;
    title.addEventListener('click', async () => {
      await switchTab(getInitialMealTabBySeoulTime());
    });
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

    let store;
    try {
      store = await Stores.add(meal, {
        name: finalName,
        url: url || '',
        address: address || '',
        lat, lng,
        memo: (memo || '').trim(),
        placeId: placeId || null,
        phone: phone || null,
        category: category || null,
      });
    } catch (e) {
      setStatus('error', e && e.message ? e.message : '가게 등록 중 오류가 발생했습니다.');
      return null;
    }

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
      const memo = $('#reg-memo').value.trim();
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

      const result = await registerStoreSmart({ meal, url, memo, statusCb: setStatus });
      if (!result) return;

      $('#reg-url').value = '';
      $('#reg-memo').value = '';
      state.meal = meal;
      $$('input[name="reg-meal"]').forEach((r) => { r.checked = (r.value === meal); });
      renderSettingsStoreList();
      // 현재 선택한 식사 탭이 활성이라면 지도/리스트도 즉시 갱신
      if (state.activeTab === meal) {
        renderStoreList();
        Maps.renderStores(getVisibleStores());
      }
      if (result.warnNoCoords) beginPickMode(result.store.id);
    });
  }

  function bindMapActions() {
    const moveBtn = $('#btn-map-my-location');
    if (!moveBtn) return;
    moveBtn.addEventListener('click', async () => {
      const loc = await Maps.moveToFixedLocation();
      if (!loc) return;
      const hint = $('#map-hint');
      if (hint) {
        hint.textContent = `📍 ${loc.name} (${loc.address}) 위치로 이동했습니다.`;
      }
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

      try {
        await Stores.add(meal, {
          name, url, address,
          lat: lat || null,
          lng: lng || null,
          memo: $('#store-memo').value.trim(),
        });
      } catch (err) {
        alert(err && err.message ? err.message : '가게 등록 중 오류가 발생했습니다.');
        return;
      }
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
    let stores = getVisibleStoresForMeal(state.meal, { includeMeta: true });
    const q = state.settingsStoreSearch || '';
    if (q) {
      stores = stores.filter((s) => String(s.name || '').toLowerCase().includes(q));
    }
    $('#settings-store-count').textContent = `(${stores.length})`;
    list.innerHTML = '';
    if (stores.length === 0) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 가게가 없습니다.</li>';
      return;
    }
    stores.forEach((s) => {
      const li = document.createElement('li');
      const sourceMeal = s.__sourceMeal || state.meal;
      const mirrored = Boolean(s.__isMirrored);
      const noCoords = (s.lat == null || s.lng == null);
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(s.name)}
            ${noCoords ? '<span class="s-badge warn">좌표 미확인</span>' : ''}
            ${mirrored ? `<span class="s-badge">중복표시·원본:${mealLabel(sourceMeal)}</span>` : ''}
          </div>
          <div class="s-meta">
            ${buildStoreMetaHtml(s, true)}
          </div>
        </div>
        <div class="s-actions">
          ${s.url ? `<button data-action="open">🔗</button>` : ''}
          <button data-action="edit-memo">메모 수정</button>
          <button data-action="edit-visibility">중복 허용</button>
          ${mirrored ? '' : '<button data-action="edit-caution-tags">주의 태그</button>'}
          ${mirrored ? '' : '<button class="pick" data-action="pick">📍 지도에서 지정</button>'}
          <button class="delete" data-action="delete">삭제</button>
        </div>
      `;
      li.addEventListener('click', async (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        if (action === 'delete') {
          const targetLabel = mirrored ? `${mealLabel(sourceMeal)}(원본)` : mealLabel(sourceMeal);
          if (confirm(`"${s.name}" 삭제할까요?\n삭제 대상: ${targetLabel}`)) {
            await Stores.remove(sourceMeal, s.id);
            renderSettingsStoreList();
          }
          return;
        }
        if (action === 'open') { window.open(s.url, '_blank', 'noopener'); return; }
        if (action === 'edit-memo') {
          const edited = prompt(`"${s.name}" 메모를 수정하세요.`, s.memo || '');
          if (edited === null) return;
          await Stores.update(sourceMeal, s.id, { memo: edited });
          renderSettingsStoreList();
          if (MEAL_TYPES.includes(state.activeTab) && state.activeTab === state.meal) {
            renderStoreList();
            Maps.renderStores(getVisibleStores());
          }
          return;
        }
        if (action === 'edit-visibility') {
          await openDuplicateVisibilityMenu(s, sourceMeal);
          return;
        }
        if (action === 'edit-caution-tags') {
          await openStoreCautionTagsMenu(s, sourceMeal);
          return;
        }
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
    const stores = getVisibleStoresForMeal(state.meal, { includeMeta: false });
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
    let stores = getVisibleStores();
    const q = state.mainStoreSearch || '';
    if (q) {
      stores = stores.filter((s) => String(s.name || '').toLowerCase().includes(q));
    }
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
    $('#btn-pick-roulette').addEventListener('click', async () => {
      try {
        const picks = await pickRandomFromVisible(5, { source: 'roulette' });
        if (picks.length < 2) {
          alert('5일 제외 규칙으로 인해 후보가 부족합니다. 설정 > 기록 관리에서 삭제하거나 가게를 추가해주세요.');
          return;
        }
        Roulette.setItems(picks);
        $('#btn-spin').disabled = false;
        $('#roulette-result').textContent = `후보 ${picks.length}곳을 무작위로 선정했습니다.`;
        $('#roulette-result').classList.remove('winner');
      } catch (e) {
        console.warn('roulette pick failed:', e);
        alert('후보 선정 중 오류가 발생했습니다.');
      }
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

    $('#btn-pick-vote').addEventListener('click', async () => {
      const count = Math.max(2, Math.min(10, parseInt($('#vote-candidate-count').value, 10) || 4));
      try {
        const picks = await pickRandomFromVisible(count, { source: 'voteCandidate' });
        if (picks.length < 2) {
          alert('5일 제외 규칙으로 인해 후보가 부족합니다. 설정 > 기록 관리에서 삭제하거나 가게를 추가해주세요.');
          return;
        }
        renderVotePreview(picks);
      } catch (e) {
        console.warn('vote candidate pick failed:', e);
        alert('후보 선정 중 오류가 발생했습니다.');
      }
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

    const historyBtn = $('#btn-vote-history');
    if (historyBtn) {
      historyBtn.addEventListener('click', async () => {
        await Voting.loadHistory(state.meal);
        openVoteHistoryModal(state.meal);
      });
    }
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

  function openVoteHistoryModal(meal) {
    const rows = [...Voting.getHistory(meal)]
      .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    const backdrop = document.createElement('div');
    backdrop.className = 'visibility-modal-backdrop';
    const mealName = mealLabel(meal);
    const itemsHtml = rows.length
      ? rows.map((row) => {
        const when = formatSeoulDateTime(row.endAt || row.createdAt || row.archivedAt);
        const winnerText = formatWinnerText(row);
        return `
          <li>
            <div class="vote-history-title">${escapeHtml(when)} · ${escapeHtml(mealName)}</div>
            <div><strong>결과:</strong> ${escapeHtml(winnerText)}</div>
            <div class="vote-history-meta">${escapeHtml(formatScoreText(row))}</div>
          </li>
        `;
      }).join('')
      : '<li><div class="vote-history-meta">기록된 이전 투표가 없습니다.</div></li>';
    backdrop.innerHTML = `
      <div class="visibility-modal" role="dialog" aria-modal="true">
        <h3>🕘 이전 투표 기록</h3>
        <p class="muted">${escapeHtml(mealName)} 탭의 과거 최종 결과입니다.</p>
        <ul class="vote-history-list">${itemsHtml}</ul>
        <div class="actions">
          <button type="button" data-action="close">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    const closeBtn = backdrop.querySelector('[data-action="close"]');
    if (closeBtn) closeBtn.addEventListener('click', close);
  }

  function formatWinnerText(row) {
    const winners = Array.isArray(row && row.winners) ? row.winners : [];
    if (!winners.length) return '무효(득표 없음)';
    if (winners.length === 1) {
      return `${winners[0].name} (${winners[0].count}표)`;
    }
    return `공동 1위: ${winners.map((w) => `${w.name}(${w.count}표)`).join(', ')}`;
  }

  function formatScoreText(row) {
    const scores = Array.isArray(row && row.scores) ? row.scores : [];
    if (!scores.length) return '후보 정보 없음';
    return scores.map((s) => `${s.name} ${s.count}표`).join(' · ');
  }

  function formatSeoulDateTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const date = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return date.replace(/\.\s*$/, '');
  }

  async function loadRandomHistoryForMeal(meal) {
    if (!window.Storage || typeof window.Storage.getRandomHistory !== 'function') {
      state.randomHistoryByMeal[meal] = [];
      return [];
    }
    try {
      const rows = await window.Storage.getRandomHistory(meal);
      const list = Array.isArray(rows) ? rows : [];
      state.randomHistoryByMeal[meal] = list
        .filter((r) => r && r.storeId && r.createdAt)
        .map((r) => ({
          id: String(r.id || uid('rh')),
          storeId: String(r.storeId),
          storeName: String(r.storeName || ''),
          source: String(r.source || 'roulette'),
          createdAt: Number(r.createdAt || 0),
          meal: meal,
        }));
    } catch (e) {
      console.warn('getRandomHistory failed:', e);
      state.randomHistoryByMeal[meal] = [];
    }
    return state.randomHistoryByMeal[meal];
  }

  function getRecentRandomBlockedIds(meal) {
    const rows = Array.isArray(state.randomHistoryByMeal[meal]) ? state.randomHistoryByMeal[meal] : [];
    const minTs = Date.now() - RANDOM_BLOCK_WINDOW_MS;
    return new Set(rows.filter((r) => r.createdAt >= minTs).map((r) => r.storeId));
  }

  async function appendRandomHistory(meal, stores, source) {
    if (!window.Storage || typeof window.Storage.saveRandomHistory !== 'function') return;
    const now = Date.now();
    const records = stores.map((s) => ({
      id: uid('rh'),
      storeId: s.id,
      storeName: s.name,
      source: source || 'roulette',
      createdAt: now,
    }));
    for (const rec of records) {
      await window.Storage.saveRandomHistory(meal, rec);
    }
    await loadRandomHistoryForMeal(meal);
    if (state.settingsSubtab === 'history') renderRandomHistoryManager();
  }

  function bindRandomHistoryManager() {
    const mealFilter = $('#random-history-meal');
    if (mealFilter) {
      mealFilter.addEventListener('change', () => {
        renderRandomHistoryManager();
      });
    }
    const clearAllBtn = $('#btn-random-history-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (!verifyHistoryAdminPassword()) return;
        const targetMeal = (mealFilter && mealFilter.value) || 'all';
        const meals = targetMeal === 'all' ? MEAL_TYPES : [targetMeal];
        if (!confirm(`${targetMeal === 'all' ? '전체 식사 탭' : mealLabel(targetMeal)} 기록을 모두 삭제할까요?`)) return;
        for (const meal of meals) {
          if (window.Storage && typeof window.Storage.clearRandomHistory === 'function') {
            await window.Storage.clearRandomHistory(meal);
          }
          state.randomHistoryByMeal[meal] = [];
        }
        renderRandomHistoryManager();
      });
    }
  }

  function renderRandomHistoryManager() {
    const list = $('#random-history-list');
    if (!list) return;
    const mealFilter = ($('#random-history-meal') && $('#random-history-meal').value) || 'all';
    const meals = mealFilter === 'all' ? MEAL_TYPES : [mealFilter];
    const rows = meals
      .flatMap((meal) => (state.randomHistoryByMeal[meal] || []).map((r) => ({ ...r, meal })))
      .sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">기록이 없습니다.</li>';
      return;
    }
    rows.forEach((row) => {
      const li = document.createElement('li');
      const sourceText = row.source === 'voteCandidate' ? '투표 후보 선정' : '랜덤 룰렛 후보';
      const until = formatSeoulDateTime(row.createdAt + RANDOM_BLOCK_WINDOW_MS);
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(row.storeName || row.storeId)}</div>
          <div class="s-meta">${escapeHtml(mealLabel(row.meal))} · ${escapeHtml(sourceText)} · ${escapeHtml(formatSeoulDateTime(row.createdAt))} (차단 만료: ${escapeHtml(until)})</div>
        </div>
        <div class="s-actions"><button data-action="delete" data-meal="${escapeHtml(row.meal)}" data-id="${escapeHtml(row.id)}">삭제</button></div>
      `;
      li.addEventListener('click', async (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        const rid = e.target.dataset && e.target.dataset.id;
        const meal = e.target.dataset && e.target.dataset.meal;
        if (action !== 'delete' || !rid || !meal) return;
        if (!verifyHistoryAdminPassword()) return;
        if (!confirm('해당 기록을 삭제할까요?')) return;
        if (window.Storage && typeof window.Storage.deleteRandomHistory === 'function') {
          await window.Storage.deleteRandomHistory(meal, rid);
        }
        await loadRandomHistoryForMeal(meal);
        renderRandomHistoryManager();
      });
      list.appendChild(li);
    });
  }

  function verifyHistoryAdminPassword() {
    const input = prompt('기록 삭제 비밀번호를 입력하세요.');
    if (input === null) return false;
    if (input !== HISTORY_ADMIN_PASSWORD) {
      alert('비밀번호가 올바르지 않습니다.');
      return false;
    }
    return true;
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

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function getInitialMealTabBySeoulTime() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const minutesFromMidnight = hour * 60 + minute;

    const monToThu = ['Mon', 'Tue', 'Wed', 'Thu'];
    const isFriday = weekday === 'Fri';
    const isWeekday = monToThu.includes(weekday) || isFriday;

    // 09:00 ~ 13:00
    const inMorningLunchWindow = minutesFromMidnight >= (9 * 60) && minutesFromMidnight <= (13 * 60);
    if (inMorningLunchWindow) {
      if (isFriday) return 'fridayLunch';
      if (monToThu.includes(weekday)) return 'lunch';
    }

    // 13:30 ~ 19:00
    const inDinnerWindow = minutesFromMidnight >= (13 * 60 + 30) && minutesFromMidnight <= (19 * 60);
    if (isWeekday && inDinnerWindow) return 'dinner';

    return 'lunch';
  }

  function toLocalDtInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function getVisibleStores() {
    return getVisibleStoresForMeal(state.meal, { includeMeta: false });
  }

  function getVisibleStoresForMeal(targetMeal, options = {}) {
    const includeMeta = options.includeMeta === true;
    const merged = [];
    MEAL_TYPES.forEach((baseMeal) => {
      Stores.get(baseMeal).forEach((store) => {
        const visibleMeals = getStoreVisibleMeals(store, baseMeal);
        if (!visibleMeals.includes(targetMeal)) return;
        merged.push(includeMeta ? {
          ...store,
          __sourceMeal: baseMeal,
          __isMirrored: baseMeal !== targetMeal,
        } : store);
      });
    });
    return dedupeStoresByUrl(merged);
  }

  function dedupeStoresByUrl(stores) {
    const seen = new Set();
    const out = [];
    stores.forEach((s) => {
      const key = normalizeUrlForCompare(s.url) || `${s.name}|${s.address || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    });
    return out;
  }

  function normalizeUrlForCompare(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      u.hash = '';
      u.protocol = u.protocol.toLowerCase();
      u.hostname = u.hostname.toLowerCase();
      if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
      return u.toString();
    } catch {
      return raw;
    }
  }

  async function pickRandomFromVisible(n, options = {}) {
    const source = options.source || 'roulette';
    await loadRandomHistoryForMeal(state.meal);
    const blockedByRecent = getRecentRandomBlockedIds(state.meal);
    const arr = getVisibleStores().filter((s) => !isBlockedByCaution(s) && !blockedByRecent.has(s.id));
    const out = [];
    while (arr.length && out.length < n) {
      const idx = Math.floor(Math.random() * arr.length);
      out.push(arr.splice(idx, 1)[0]);
    }
    if (out.length) {
      await appendRandomHistory(state.meal, out, source);
    }
    return out;
  }

  function isBlockedByCaution(store) {
    const cautionNames = new Set(state.cautions.map((c) => c.name));
    const eatingOut = state.assignments.outside.filter((n) => cautionNames.has(n));
    const hasStoreBlocks = state.assignments.outside.some((name) => {
      const keys = state.cautionStoreBlocks[name];
      return Array.isArray(keys) && keys.length > 0;
    });
    if (!eatingOut.length && !hasStoreBlocks) return false;
    const blockedFor = Array.isArray(store.avoidFor) ? store.avoidFor : [];
    if (blockedFor.some((name) => eatingOut.includes(name))) return true;
    const blockedStoreKeys = new Set();
    state.assignments.outside.forEach((name) => {
      const keys = Array.isArray(state.cautionStoreBlocks[name]) ? state.cautionStoreBlocks[name] : [];
      keys.forEach((k) => blockedStoreKeys.add(k));
    });
    if (!blockedStoreKeys.size) return false;
    const storeKey = getStoreBlockKeyFromStore(store, state.meal);
    return blockedStoreKeys.has(storeKey);
  }

  function getStoreVisibleMeals(store, sourceMeal) {
    if (Array.isArray(store.visibleMeals) && store.visibleMeals.length) {
      return [...new Set(store.visibleMeals.filter((m) => MEAL_TYPES.includes(m)))];
    }
    const meals = [sourceMeal];
    if (store.showInFridayLunchTab || store.showInCompanionLunchTab) meals.push('fridayLunch');
    return [...new Set(meals)];
  }

  function mealLabel(meal) {
    return ({
      lunch: '점심',
      fridayLunch: '금요일 점심',
      dinner: '저녁',
    }[meal] || meal);
  }

  async function openDuplicateVisibilityMenu(store, sourceMeal) {
    const current = getStoreVisibleMeals(store, sourceMeal);
    const selected = await showMultiSelectModal({
      title: '중복 허용 설정',
      subtitle: `"${store.name}" 노출 탭을 선택하세요.`,
      options: [
        { value: 'lunch', label: '점심' },
        { value: 'fridayLunch', label: '금요일 점심' },
        { value: 'dinner', label: '저녁' },
      ],
      selected: current,
      saveLabel: '저장',
      requireAtLeastOne: true,
    });
    if (!selected) return;
    await Stores.update(sourceMeal, store.id, {
      visibleMeals: selected,
      showInFridayLunchTab: false,
      showInCompanionLunchTab: false,
    });
    renderSettingsStoreList();
    if (MEAL_TYPES.includes(state.activeTab)) {
      renderStoreList();
      Maps.renderStores(getVisibleStores());
    }
  }

  async function openStoreCautionTagsMenu(store, sourceMeal) {
    if (!state.cautions.length) {
      alert('주의 대상자를 먼저 등록해주세요.');
      return;
    }
    const cautionMap = new Map();
    state.cautions.forEach((c) => {
      if (!cautionMap.has(c.name)) cautionMap.set(c.name, []);
      cautionMap.get(c.name).push(c.note);
    });
    const selected = await showMultiSelectModal({
      title: '주의 태그 설정',
      subtitle: `"${store.name}" 에서 식사 주의가 필요한 대상자를 선택하세요.`,
      options: Array.from(cautionMap.entries()).map(([name, notes]) => ({
        value: name,
        label: `${name} · ${Array.from(new Set(notes)).join(', ')}`,
      })),
      selected: Array.isArray(store.avoidFor) ? store.avoidFor : [],
      saveLabel: '태그 저장',
      requireAtLeastOne: false,
    });
    if (!selected) return;
    await Stores.update(sourceMeal, store.id, { avoidFor: selected });
    renderSettingsStoreList();
    if (MEAL_TYPES.includes(state.activeTab)) {
      renderStoreList();
      Maps.renderStores(getVisibleStores());
    }
  }

  function showMultiSelectModal(config) {
    const title = config.title || '선택';
    const subtitle = config.subtitle || '';
    const options = Array.isArray(config.options) ? config.options : [];
    const selectedSet = new Set(Array.isArray(config.selected) ? config.selected : []);
    const saveLabel = config.saveLabel || '저장';
    const requireAtLeastOne = config.requireAtLeastOne === true;
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'visibility-modal-backdrop';
      backdrop.innerHTML = `
        <div class="visibility-modal" role="dialog" aria-modal="true">
          <h3>${escapeHtml(title)}</h3>
          <p class="muted">${escapeHtml(subtitle)}</p>
          ${options.map((op) => (
            `<label><input type="checkbox" value="${escapeHtml(op.value)}" ${selectedSet.has(op.value) ? 'checked' : ''}/> ${escapeHtml(op.label)}</label>`
          )).join('')}
          <div class="actions">
            <button type="button" data-action="cancel">취소</button>
            <button type="button" data-action="save">${escapeHtml(saveLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      const close = (result) => {
        backdrop.remove();
        resolve(result);
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(null);
      });
      backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
      backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
        const checked = Array.from(backdrop.querySelectorAll('input[type="checkbox"]:checked'))
          .map((el) => el.value)
          .filter((m) => options.some((op) => op.value === m));
        if (requireAtLeastOne && !checked.length) {
          alert('최소 1개 탭은 선택해야 합니다.');
          return;
        }
        close(checked);
      });
    });
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
    if (Array.isArray(s.avoidFor) && s.avoidFor.length) {
      parts.push(`주의: ${escapeHtml(s.avoidFor.join(', '))}`);
    }
    if (showCoords && s.lat != null && s.lng != null) {
      parts.push(`${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`);
    }
    return parts.join(' · ');
  }

  function getCautionNotesByName(name) {
    return state.cautions
      .filter((c) => c.name === name)
      .map((c) => c.note)
      .filter((note, idx, arr) => note && arr.indexOf(note) === idx);
  }

  function renderCautionStoreBlockSummary() {
    const summary = $('#caution-store-block-summary');
    const personEl = $('#caution-person');
    if (!summary || !personEl) return;
    const personName = (personEl.value || '').trim();
    if (!personName) {
      summary.textContent = '선택된 못가는 가게가 없습니다.';
      return;
    }
    const blockedKeys = Array.isArray(state.cautionStoreBlocks[personName]) ? state.cautionStoreBlocks[personName] : [];
    if (!blockedKeys.length) {
      summary.textContent = `${personName} 대상자의 못가는 가게가 없습니다.`;
      return;
    }
    const blockedNames = blockedKeys.map((k) => getStoreLabelByBlockKey(k)).filter(Boolean);
    summary.textContent = `${personName} 제외 가게: ${blockedNames.join(', ')}`;
  }

  function getStoreBlockOptions() {
    const seen = new Set();
    const out = [];
    MEAL_TYPES.forEach((meal) => {
      Stores.get(meal).forEach((store) => {
        const key = getStoreBlockKeyFromStore(store, meal);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push({
          value: key,
          label: `${mealLabel(meal)} · ${store.name}`,
        });
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function getStoreBlockOptionsByMeal() {
    const byMeal = {
      lunch: [],
      fridayLunch: [],
      dinner: [],
    };
    MEAL_TYPES.forEach((meal) => {
      const visible = getVisibleStoresForMeal(meal, { includeMeta: true });
      visible.forEach((store) => {
        const key = getStoreBlockKeyFromStore(store, meal);
        if (!key) return;
        byMeal[meal].push({
          value: key,
          label: store.name,
          memo: cleanMemoForDisplay(store.memo || ''),
        });
      });
    });
    MEAL_TYPES.forEach((meal) => {
      byMeal[meal].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    });
    return byMeal;
  }

  function getStoreLabelByBlockKey(blockKey) {
    const byMeal = getStoreBlockOptionsByMeal();
    const all = [...byMeal.lunch, ...byMeal.fridayLunch, ...byMeal.dinner];
    const found = all.find((op) => op.value === blockKey);
    return found ? found.label : blockKey;
  }

  function getStoreBlockKeyFromStore(store, mealFallback) {
    const normUrl = normalizeUrlForCompare(store && store.url);
    if (normUrl) return `url:${normUrl}`;
    const sourceMeal = (store && store.__sourceMeal) || mealFallback || state.meal || 'lunch';
    return `id:${sourceMeal}:${store && store.id ? store.id : ''}`;
  }

  function openCautionStoreBlocksEditor(personName) {
    const byMeal = getStoreBlockOptionsByMeal();
    const totalCount = MEAL_TYPES.reduce((sum, meal) => sum + byMeal[meal].length, 0);
    if (!totalCount) {
      alert('등록된 가게가 없어 선택할 수 없습니다.');
      return Promise.resolve(null);
    }
    const selectedSet = new Set(
      Array.isArray(state.cautionStoreBlocks[personName]) ? state.cautionStoreBlocks[personName] : []
    );
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'visibility-modal-backdrop';
      backdrop.innerHTML = `
        <div class="visibility-modal store-block-modal" role="dialog" aria-modal="true">
          <h3>못가는 가게 선택</h3>
          <p class="muted">${escapeHtml(personName)} 대상자의 제외 가게를 설정하세요.</p>
          <div class="store-block-tabs">
            <button type="button" class="store-block-tab active" data-meal="lunch">점심</button>
            <button type="button" class="store-block-tab" data-meal="fridayLunch">금요일 점심</button>
            <button type="button" class="store-block-tab" data-meal="dinner">저녁</button>
          </div>
          <div class="store-block-list" id="store-block-list"></div>
          <div class="actions">
            <button type="button" data-action="cancel">취소</button>
            <button type="button" data-action="save">저장</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const listEl = backdrop.querySelector('#store-block-list');
      let activeMeal = 'lunch';
      const renderMealList = () => {
        const options = byMeal[activeMeal] || [];
        if (!options.length) {
          listEl.innerHTML = '<div class="vote-history-meta">해당 식사 탭에 등록된 가게가 없습니다.</div>';
          return;
        }
        listEl.innerHTML = options.map((op) => `
          <label class="store-block-option">
            <input type="checkbox" value="${escapeHtml(op.value)}" ${selectedSet.has(op.value) ? 'checked' : ''}/>
            <span class="store-block-option-text">
              <span class="store-block-option-name">${escapeHtml(op.label)}</span>
              ${op.memo ? `<span class="store-block-option-memo">${escapeHtml(op.memo)}</span>` : ''}
            </span>
          </label>
        `).join('');
        Array.from(listEl.querySelectorAll('input[type="checkbox"]')).forEach((cb) => {
          cb.addEventListener('change', () => {
            if (cb.checked) selectedSet.add(cb.value);
            else selectedSet.delete(cb.value);
          });
        });
      };

      const close = (result) => {
        backdrop.remove();
        resolve(result);
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(null);
      });
      Array.from(backdrop.querySelectorAll('.store-block-tab')).forEach((btn) => {
        btn.addEventListener('click', () => {
          activeMeal = btn.dataset.meal;
          Array.from(backdrop.querySelectorAll('.store-block-tab'))
            .forEach((el) => el.classList.toggle('active', el === btn));
          renderMealList();
        });
      });
      backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
      backdrop.querySelector('[data-action="save"]').addEventListener('click', () => {
        close(Array.from(selectedSet));
      });
      renderMealList();
    });
  }

  function renderCautionPersonOptions() {
    const personSelect = $('#caution-person');
    if (!personSelect) return;
    const prev = personSelect.value;
    personSelect.innerHTML = '<option value="">대상자를 선택하세요</option>';
    state.people.forEach((p) => {
      const op = document.createElement('option');
      op.value = p.name;
      op.textContent = p.role ? `${p.name} ${p.role}` : p.name;
      personSelect.appendChild(op);
    });
    if (state.people.some((p) => p.name === prev)) {
      personSelect.value = prev;
    } else {
      personSelect.value = '';
    }
    renderCautionStoreBlockSummary();
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
