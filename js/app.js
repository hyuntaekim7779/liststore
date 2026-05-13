/**
 * App orchestrator. Wires UI events to Stores / Maps / Roulette / Voting modules.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = { meal: 'lunch', selectedStoreId: null, voteTimer: null };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Maps.init('map');
    Roulette.init('roulette-canvas');

    bindMealTabs();
    bindStoreForm();
    bindRoulette();
    bindVoting();

    await switchMeal('lunch');
  }

  // ---------- Meal tabs ----------
  function bindMealTabs() {
    $$('.meal-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchMeal(btn.dataset.meal));
    });
  }

  async function switchMeal(meal) {
    state.meal = meal;
    state.selectedStoreId = null;
    $$('.meal-tab').forEach((b) => b.classList.toggle('active', b.dataset.meal === meal));
    await Stores.load(meal);
    await Voting.load(meal);
    renderStoreList();
    Maps.renderStores(Stores.get(meal));
    Roulette.setItems([]);
    $('#roulette-result').textContent = '';
    $('#btn-spin').disabled = true;
    renderVote();
  }

  // ---------- Store form ----------
  function bindStoreForm() {
    $('#store-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#store-name').value.trim();
      if (!name) return;

      let lat = $('#store-lat').value;
      let lng = $('#store-lng').value;
      const url = $('#store-url').value.trim();
      const address = $('#store-address').value.trim();

      // Try URL parse first if coordinates not provided.
      if ((!lat || !lng) && url) {
        const parsed = Maps.parseUrl(url);
        if (parsed) { lat = parsed.lat; lng = parsed.lng; }
      }
      // Then geocode address if still missing.
      if ((!lat || !lng) && address) {
        const r = await Maps.geocode(address);
        if (r) { lat = r.lat; lng = r.lng; }
      }

      await Stores.add(state.meal, {
        name, url, address, lat, lng,
        memo: $('#store-memo').value.trim(),
      });
      $('#store-form').reset();
      renderStoreList();
      Maps.renderStores(Stores.get(state.meal));
    });

    $('#btn-geocode').addEventListener('click', async () => {
      const address = $('#store-address').value.trim();
      const url = $('#store-url').value.trim();
      let result = null;
      if (url) result = Maps.parseUrl(url);
      if (!result && address) result = await Maps.geocode(address);
      if (result) {
        $('#store-lat').value = result.lat;
        $('#store-lng').value = result.lng;
      } else {
        alert('좌표를 찾지 못했습니다. 주소를 더 상세히 입력하거나, 위도/경도를 직접 입력해주세요.');
      }
    });
  }

  function renderStoreList() {
    const list = $('#store-list');
    const stores = Stores.get(state.meal);
    $('#store-count').textContent = `(${stores.length})`;
    list.innerHTML = '';
    if (stores.length === 0) {
      list.innerHTML = '<li style="border:none;background:transparent;color:#888;justify-content:center">등록된 가게가 없습니다.</li>';
      return;
    }
    stores.forEach((s) => {
      const li = document.createElement('li');
      li.dataset.id = s.id;
      if (state.selectedStoreId === s.id) li.classList.add('selected');
      li.innerHTML = `
        <div>
          <div class="s-name">${escapeHtml(s.name)}</div>
          <div class="s-meta">
            ${s.address ? escapeHtml(s.address) + ' · ' : ''}
            ${s.memo ? escapeHtml(s.memo) : ''}
            ${s.lat == null ? '<span style="color:#e44">좌표 없음</span>' : ''}
          </div>
        </div>
        <div class="s-actions">
          ${s.url ? `<button data-action="open">🔗</button>` : ''}
          <button class="delete" data-action="delete">삭제</button>
        </div>
      `;
      li.addEventListener('click', (e) => {
        const action = e.target.dataset && e.target.dataset.action;
        if (action === 'delete') {
          if (confirm(`"${s.name}" 삭제할까요?`)) {
            Stores.remove(state.meal, s.id).then(() => {
              renderStoreList();
              Maps.renderStores(Stores.get(state.meal));
            });
          }
          return;
        }
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
    // Pre-fill datetime-local fields with sensible defaults.
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
      // Show candidate preview in vote-candidates list before creating
      const previewVote = {
        candidates: picks.map((s) => ({ id: s.id, name: s.name })),
        votes: Object.fromEntries(picks.map((s) => [s.id, []])),
        startAt: Date.now() + 999999,
        endAt: Date.now() + 9999999,
      };
      renderVotePreview(previewVote);
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

  function renderVotePreview(previewVote) {
    window.__pendingVoteCandidates = previewVote.candidates;
    const ul = $('#vote-candidates');
    ul.innerHTML = '';
    previewVote.candidates.forEach((c) => {
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

    // Candidate buttons
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

    // Results
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

    // Re-render every second while pending/open to update countdown + auto status transitions.
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
})();
