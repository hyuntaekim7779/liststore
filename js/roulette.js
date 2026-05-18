/**
 * Roulette — canvas-based spinning wheel.
 * - 기본 랜덤 후보(최대 5개) + 선택 룰렛(최대 10개)
 * - 외부에서 지정한 winnerId/startAt/duration으로 동기화 재생 가능
 */
(function () {
  const COLORS = ['#5b6cff', '#ff9f43', '#10b981', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];
  const DEFAULT_DURATION = 4200;
  const MIN_ITEMS = 2;
  const MAX_ITEMS = 10;

  const Roulette = {
    canvas: null,
    ctx: null,
    items: [],
    rotation: 0,
    spinning: false,
    onResult: null,
    spinSessionId: '',

    init(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.draw();
    },

    setItems(items) {
      const safe = Array.isArray(items) ? items.filter((it) => it && it.id && it.name) : [];
      this.items = safe.slice(0, MAX_ITEMS);
      this.rotation = 0;
      this.spinning = false;
      this.spinSessionId = '';
      this.draw();
    },

    draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 8;
      ctx.clearRect(0, 0, W, H);

      if (this.items.length === 0) {
        ctx.fillStyle = '#eef0ff';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#888';
        ctx.font = '700 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('“랜덤/선택 룰렛” 버튼으로 후보를 준비하세요', cx, cy);
        return;
      }

      const n = this.items.length;
      const seg = (Math.PI * 2) / n;

      for (let i = 0; i < n; i++) {
        const start = this.rotation + i * seg;
        const end = start + seg;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, end);
        ctx.closePath();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // label
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(start + seg / 2);
        ctx.fillStyle = '#fff';
        ctx.font = n <= 5 ? '800 18px sans-serif' : '800 15px sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 3;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const label = truncate(this.items[i].name, n <= 5 ? 14 : 11);
        ctx.fillText(label, r - 12, 0);
        ctx.restore();
      }

      // hub
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#5b6cff';
      ctx.lineWidth = 3;
      ctx.stroke();
    },

    getWinnerById(winnerId) {
      if (!winnerId) return null;
      return this.items.find((it) => String(it.id) === String(winnerId)) || null;
    },

    spin(onResult) {
      if (this.spinning || this.items.length < MIN_ITEMS) return null;
      const winner = this.items[Math.floor(Math.random() * this.items.length)];
      const session = {
        id: `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        winnerId: winner.id,
        startAt: Date.now(),
        durationMs: DEFAULT_DURATION,
      };
      this.play(session, onResult);
      return session;
    },

    play(session, onResult) {
      if (!session || !session.winnerId || !Array.isArray(this.items) || this.items.length < MIN_ITEMS) return;
      const winner = this.getWinnerById(session.winnerId);
      if (!winner) return;
      const duration = Math.max(1000, Number(session.durationMs) || DEFAULT_DURATION);
      const startAt = Number(session.startAt) || Date.now();
      const elapsed = Math.max(0, Date.now() - startAt);
      const sessionId = String(session.id || `${session.winnerId}:${startAt}:${duration}`);
      this.spinning = true;
      this.onResult = onResult;
      this.spinSessionId = sessionId;

      const n = this.items.length;
      const seg = (Math.PI * 2) / n;
      const winnerIndex = this.items.findIndex((it) => String(it.id) === String(session.winnerId));
      if (winnerIndex < 0) {
        this.spinning = false;
        return;
      }
      // The pointer is at top center (-PI/2). We want the middle of winner segment to land there.
      const targetAngle = -Math.PI / 2 - (winnerIndex * seg + seg / 2);
      const fullSpins = 5 + Math.floor(Math.random() * 3); // 5–7 turns
      const finalRotation = targetAngle - fullSpins * Math.PI * 2;
      const startRotation = this.rotation;
      const delta = finalRotation - normalizeAngle(startRotation, finalRotation);
      const startTime = performance.now() - Math.min(elapsed, duration);

      const animate = (now) => {
        if (this.spinSessionId !== sessionId) return;
        const t = Math.min(1, (now - startTime) / duration);
        const eased = easeOutCubic(t);
        this.rotation = startRotation + delta * eased;
        this.draw();
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          this.spinning = false;
          if (this.onResult) this.onResult(winner);
        }
      };
      requestAnimationFrame(animate);
    },
  };

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function normalizeAngle(start, target) {
    // Keep start such that target < start (so we spin in negative dir).
    while (target > start) start += Math.PI * 2;
    return start;
  }

  window.Roulette = Roulette;
})();
