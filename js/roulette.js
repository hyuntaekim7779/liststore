/**
 * Roulette — canvas-based spinning wheel.
 * - 최대 5개 항목을 받아 룰렛으로 그리고 spin 시 한 항목을 선정.
 */
(function () {
  const COLORS = ['#5b6cff', '#ff9f43', '#10b981', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];

  const Roulette = {
    canvas: null,
    ctx: null,
    items: [],
    rotation: 0,
    spinning: false,
    onResult: null,

    init(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.draw();
    },

    setItems(items) {
      this.items = items.slice(0, 5);
      this.rotation = 0;
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
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('“랜덤 5개 뽑기” 를 눌러주세요', cx, cy);
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
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const label = truncate(this.items[i].name, 12);
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

    spin(onResult) {
      if (this.spinning || this.items.length === 0) return;
      this.spinning = true;
      this.onResult = onResult;

      const n = this.items.length;
      const seg = (Math.PI * 2) / n;
      const winnerIndex = Math.floor(Math.random() * n);
      // The pointer is at top center (-PI/2). We want the middle of winner segment to land there.
      const targetAngle = -Math.PI / 2 - (winnerIndex * seg + seg / 2);
      const fullSpins = 5 + Math.floor(Math.random() * 3); // 5–7 turns
      const finalRotation = targetAngle - fullSpins * Math.PI * 2;
      const startRotation = this.rotation;
      const delta = finalRotation - normalizeAngle(startRotation, finalRotation);
      const duration = 4200;
      const startTime = performance.now();

      const animate = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = easeOutCubic(t);
        this.rotation = startRotation + delta * eased;
        this.draw();
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          this.spinning = false;
          if (this.onResult) this.onResult(this.items[winnerIndex]);
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
