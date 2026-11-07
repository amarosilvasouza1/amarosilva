/* Pianeon — painéis visuais em canvas (mostrador, piano roll, visualizadores e pista 3D) */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, bus, audio } = PN;

  const MONO = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  let C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue('--' + n).trim();
    C = {
      bg: v('bg'), panel: v('panel'), panel2: v('panel-2'), line: v('line'), grid: v('grid'), grid2: v('grid-2'),
      ink: v('ink'), muted: v('muted'), teal: v('teal'), tealSoft: v('teal-soft'), blue: v('blue'), blueSoft: v('blue-soft'),
      purple: v('purple'), red: v('red'), green: v('green'), amber: v('amber'), dark: v('dark'), darkInk: v('dark-ink'), bars: v('bars'),
    };
  }

  function alpha(color, a) {
    // aceita #rgb/#rrggbb
    if (!color || color[0] !== '#') return color;
    let c = color.slice(1);
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  class Panel {
    constructor(canvas, draw) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.draw = draw;
      this.w = 0;
      this.h = 0;
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    }
    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(this.cv.clientWidth));
      const h = Math.max(1, Math.floor(this.cv.clientHeight));
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.cv.width = Math.floor(w * dpr);
      this.cv.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dirty = true;
    }
    get visible() {
      return this.cv.offsetParent !== null && this.w > 4 && this.h > 4;
    }
  }

  function label(ctx, text, x, y, color, size = 10, weight = 500, align = 'left') {
    ctx.font = weight + ' ' + size + 'px ' + MONO;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Primeiro índice com time + 12s >= t (notas ordenadas por início). */
  function firstIndex(notes, t) {
    let lo = 0;
    let hi = notes.length;
    const target = t - 12;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const handColor = (n) => (n.hand === 'L' ? C.blue : C.teal);
  const handSoft = (n) => (n.hand === 'L' ? C.blueSoft : C.tealSoft);

  // ------------------------------------------------------------------ mostrador de compasso
  function drawDial(p, S) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2 + 2;
    const R = Math.min(w, h) / 2 - 20;
    if (R < 24) return;
    const ts = Math.max(1, Math.round(S.timeSig));
    const bp = S.beatPos;
    const bar = Math.floor(bp / ts) + 1;
    const frac = (((bp / ts) % 1) + 1) % 1;
    const curBeat = Math.floor(frac * ts);

    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    const ticks = ts * 4;
    for (let i = 0; i < ticks; i++) {
      const a = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
      const major = i % 4 === 0;
      const r0 = R - (major ? 13 : 5);
      ctx.strokeStyle = major ? C.ink : C.muted;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      if (major) {
        const b = i / 4;
        const lx = cx + Math.cos(a) * (R + 11);
        const ly = cy + Math.sin(a) * (R + 11) + 4;
        label(ctx, String(b + 1), lx, ly, b === curBeat ? C.blue : C.muted, 11, 600, 'center');
      }
    }

    // anel segmentado + arco de progresso
    const r1 = R * 0.44;
    const r2 = R * 0.68;
    const rm = (r1 + r2) / 2;
    const N = 32;
    ctx.lineWidth = r2 - r1;
    for (let k = 0; k < N; k++) {
      const a0 = -Math.PI / 2 + (k / N) * Math.PI * 2 + 0.03;
      const a1 = -Math.PI / 2 + ((k + 1) / N) * Math.PI * 2 - 0.03;
      ctx.strokeStyle = alpha(C.tealSoft, 0.55);
      ctx.beginPath();
      ctx.arc(cx, cy, rm, a0, a1);
      ctx.stroke();
    }
    if (frac > 0.002) {
      ctx.strokeStyle = C.teal;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, rm, -Math.PI / 2 + 0.04, -Math.PI / 2 + Math.max(0.05, frac * Math.PI * 2 - 0.04));
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // disco central
    const rc = R * 0.36;
    ctx.fillStyle = C.panel;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rc, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    label(ctx, 'COMPASSO', cx, cy - rc * 0.28, C.muted, Math.max(7, rc * 0.2), 500, 'center');
    label(ctx, String(Math.max(0, bar)), cx, cy + rc * 0.52, C.ink, Math.max(12, rc * 0.78), 600, 'center');

    // ponteiro
    const a = -Math.PI / 2 + frac * Math.PI * 2;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rc * 0.6, cy + Math.sin(a) * rc * 0.6);
    ctx.lineTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94);
    ctx.stroke();

    label(ctx, '♩ ' + Math.round(S.bpm), 8, h - 8, C.muted, 10, 500);
    label(ctx, ts + '/4', w - 8, h - 8, C.muted, 10, 500, 'right');
  }

  // ------------------------------------------------------------------ piano roll
  function drawRoll(p, S) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const labelW = 30;
    const top = 16;
    const [lo, hi] = S.rollRange;
    const rows = hi - lo + 1;
    const rowH = (h - top - 2) / rows;
    const secs = S.rollWindow;
    const gw = w - labelW;
    const x0 = labelW + gw * (S.song ? 0.22 : 0.84);
    const pps = gw / secs;
    const now = S.clock;
    const yOf = (m) => top + (hi - m) * rowH;

    for (let m = lo; m <= hi; m++) {
      const y = yOf(m);
      if (util.isBlack(m)) {
        ctx.fillStyle = C.grid2;
        ctx.fillRect(labelW, y, gw, rowH);
      }
      ctx.fillStyle = m % 12 === 0 ? C.line : C.grid;
      ctx.fillRect(labelW, y + rowH - (m % 12 === 0 ? 1 : 0.5), gw, m % 12 === 0 ? 1 : 0.5);
      if (m % 12 === 0 && rowH * 3 > 9) label(ctx, S.noteName(m), 4, y + rowH / 2 + 4, C.muted, 10, 500);
    }
    ctx.fillStyle = C.line;
    ctx.fillRect(labelW, top, 1, h - top);

    // linhas de compasso / tempo
    const tStart = now - (x0 - labelW) / pps;
    const tEnd = now + (w - x0) / pps;
    const B = S.beats;
    const pick = S.pickup || 0;
    let beat = Math.ceil(B.beatAt(tStart));
    const lastBeat = B.beatAt(tEnd);
    let guard = 0;
    for (; beat <= lastBeat && guard < 400; beat++, guard++) {
      const x = x0 + (B.timeAt(beat) - now) * pps;
      if (x < labelW) continue;
      const rel = beat - pick;
      const isBar = ((rel % S.timeSig) + S.timeSig) % S.timeSig === 0;
      ctx.fillStyle = isBar ? C.line : C.grid;
      ctx.fillRect(x, isBar ? 4 : top, isBar ? 1 : 0.5, h - (isBar ? 4 : top));
      if (isBar && rel >= 0) label(ctx, String(rel / S.timeSig + 1), x + 4, 12, C.muted, 10, 500);
    }

    // notas da música
    if (S.notes && S.notes.length) {
      const notes = S.notes;
      for (let i = firstIndex(notes, tStart); i < notes.length; i++) {
        const n = notes[i];
        if (n.time > tEnd) break;
        const m = S.rollUsesPlay ? n.playMidi : n.midi;
        if (m < lo || m > hi) continue;
        const xa = x0 + (n.time - now) * pps;
        const xb = x0 + (n.time + n.duration - now) * pps;
        if (xb < labelW) continue;
        const nh = Math.max(2, rowH * 0.62);
        const y = yOf(m) + (rowH - nh) / 2;
        const active = now >= n.time && now < n.time + n.duration;
        let col = n.time > now ? handSoft(n) : handColor(n);
        if (n.judge === 'miss') col = C.red;
        ctx.globalAlpha = S.mode !== 'watch' && !n.target ? 0.4 : 1;
        ctx.fillStyle = col;
        ctx.fillRect(Math.max(labelW, xa), y, Math.max(2, xb - Math.max(labelW, xa) - 1), nh);
        if (active) {
          ctx.fillStyle = handColor(n);
          ctx.fillRect(Math.max(labelW, xa), y - 1, Math.max(2, xb - Math.max(labelW, xa) - 1), nh + 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // notas tocadas por você (roxo)
    for (const l of S.live) {
      const end = l.end == null ? now : l.end;
      if (end < tStart || l.start > tEnd) continue;
      if (l.midi < lo || l.midi > hi) continue;
      const xa = Math.max(labelW, x0 + (l.start - now) * pps);
      const xb = x0 + (end - now) * pps;
      const nh = Math.max(2, rowH * 0.4);
      ctx.fillStyle = C.purple;
      ctx.fillRect(xa, yOf(l.midi) + (rowH - nh) / 2, Math.max(2, xb - xa), nh);
    }

    // agulha
    ctx.fillStyle = C.ink;
    ctx.fillRect(x0 - 1, 0, 2, h);
  }

  // ------------------------------------------------------------------ visualizadores de áudio
  const hist = { peaks: new Float32Array(260), loud: new Float32Array(260), idx: 0, loudS: 0 };
  const specPeaks = new Float32Array(32);

  function pushLevels() {
    const d = audio.getTimeData();
    let peak = 0;
    let sum = 0;
    if (d) {
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
      }
    }
    const rms = d ? Math.sqrt(sum / d.length) : 0;
    hist.loudS = hist.loudS * 0.9 + rms * 0.1;
    hist.idx = (hist.idx + 1) % hist.peaks.length;
    hist.peaks[hist.idx] = peak;
    hist.loud[hist.idx] = hist.loudS;
  }

  function panelTitle(ctx, a, b, colorB) {
    label(ctx, a, 9, 16, C.muted, 11, 500);
    if (b) {
      ctx.font = '500 11px ' + MONO;
      const wA = ctx.measureText(a).width;
      label(ctx, b, 9 + wA + 14, 16, colorB || C.blue, 11, 500);
    }
  }

  function drawWave(p) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const db = hist.loudS > 0.0001 ? 20 * Math.log10(hist.loudS) : -60;
    panelTitle(ctx, 'WAVEFORM', 'LOUDNESS ' + (db <= -59 ? '-∞' : db.toFixed(1)) + ' dB');
    const gx = 8;
    const gy = 26;
    const gw = w - 16;
    const gh = h - gy - 8;
    const mid = gy + gh / 2;
    const cols = Math.min(hist.peaks.length, Math.floor(gw / 3));
    for (let k = 0; k < cols; k++) {
      const i = (hist.idx - (cols - 1 - k) + hist.peaks.length * 4) % hist.peaks.length;
      const v = Math.min(1, hist.peaks[i] * 1.4);
      const bh = Math.max(1, v * gh * 0.95);
      ctx.fillStyle = k > cols - 8 ? C.ink : C.bars;
      ctx.fillRect(gx + k * 3, mid - bh / 2, 2, bh);
    }
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < cols; k++) {
      const i = (hist.idx - (cols - 1 - k) + hist.peaks.length * 4) % hist.peaks.length;
      const l = hist.loud[i] > 0.0001 ? (20 * Math.log10(hist.loud[i]) + 60) / 60 : 0;
      const y = gy + gh - util.clamp(l, 0, 1) * gh;
      if (k === 0) ctx.moveTo(gx + k * 3, y);
      else ctx.lineTo(gx + k * 3, y);
    }
    ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(gx - 0.5, gy - 0.5, gw + 1, gh + 1);
  }

  function drawScope(p) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    panelTitle(ctx, 'SCOPE');
    const st = audio.getStereo();
    const gy = 24;
    const gh = h - gy - 8;
    const mid = gy + gh / 2;
    ctx.fillStyle = C.grid;
    ctx.fillRect(6, mid, w - 12, 1);
    for (let k = 1; k < 4; k++) ctx.fillRect(6 + ((w - 12) * k) / 4, gy, 1, gh);
    if (!st) return;
    const [L, R] = st;
    let start = 0;
    for (let i = 1; i < L.length / 2; i++)
      if (L[i - 1] < 0 && L[i] >= 0) {
        start = i;
        break;
      }
    const N = Math.min(400, L.length - start);
    let peak = 0.02;
    for (let i = start; i < start + N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const g = (gh / 2) * 0.9 / Math.max(0.15, peak);
    [
      [R, C.bars],
      [L, C.blue],
    ].forEach(([buf, col]) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const x = 6 + (k / (N - 1)) * (w - 12);
        const y = mid - buf[start + k] * g;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  function drawSpectrum(p) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    panelTitle(ctx, 'SPECTRUM');
    const f = audio.getFreqData();
    const gy = 24;
    const gh = h - gy - 6;
    const bands = Math.max(8, Math.min(28, Math.floor((w - 12) / 7)));
    const bw = (w - 12) / bands;
    const sr = audio.ctx ? audio.ctx.sampleRate : 44100;
    const binHz = sr / 2 / (f ? f.length : 1024);
    for (let b = 0; b < bands; b++) {
      let v = 0;
      if (f) {
        const f0 = 40 * Math.pow(16000 / 40, b / bands);
        const f1 = 40 * Math.pow(16000 / 40, (b + 1) / bands);
        const i0 = Math.max(1, Math.floor(f0 / binHz));
        const i1 = Math.max(i0 + 1, Math.ceil(f1 / binHz));
        for (let i = i0; i < i1 && i < f.length; i++) v = Math.max(v, f[i]);
        v /= 255;
      }
      specPeaks[b] = Math.max(v, specPeaks[b] - 0.008);
      const x = 6 + b * bw;
      const bh = v * gh;
      ctx.fillStyle = C.ink;
      ctx.fillRect(x, gy + gh - bh, Math.max(1, bw - 2), bh);
      ctx.fillStyle = C.blue;
      ctx.fillRect(x, gy + gh - specPeaks[b] * gh - 3, Math.max(1, bw - 2), 2);
    }
  }

  function drawVector(p) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    panelTitle(ctx, 'VECTOR');
    const cx = w / 2;
    const cy = 22 + (h - 22) / 2;
    const r = Math.min(w, h - 26) / 2 - 6;
    if (r < 8) return;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy - r * 0.7);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
    ctx.moveTo(cx + r * 0.7, cy - r * 0.7);
    ctx.lineTo(cx - r * 0.7, cy + r * 0.7);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    const st = audio.getStereo();
    if (!st) return;
    const [L, R] = st;
    let peak = 0.05;
    for (let i = 0; i < L.length; i += 4) peak = Math.max(peak, Math.abs(L[i]) + Math.abs(R[i]));
    const g = (r * 0.95) / peak;
    ctx.fillStyle = alpha(C.blue, 0.55);
    for (let i = 0; i < L.length; i += 2) {
      const x = ((R[i] - L[i]) / Math.SQRT2) * g;
      const y = (-(L[i] + R[i]) / Math.SQRT2) * g;
      ctx.fillRect(cx + x - 1, cy + y - 1, 2, 2);
    }
  }

  function drawMap(p, S) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const pad = 8;
    if (!S.song) {
      label(ctx, 'MODO', w / 2, h / 2 - 4, C.muted, 11, 600, 'center');
      label(ctx, 'LIVRE', w / 2, h / 2 + 12, C.muted, 11, 600, 'center');
      return;
    }
    const dur = Math.max(1, S.song.duration);
    const [lo, hi] = S.song.range;
    const span = Math.max(12, hi - lo + 1);
    const xOf = (t) => pad + (t / dur) * (w - pad * 2);
    const yOf = (m) => h - pad - ((m - lo + 0.5) / span) * (h - pad * 2);
    for (const n of S.notes) {
      ctx.fillStyle = n.judge === 'miss' ? C.red : n.hand === 'L' ? C.blue : C.teal;
      ctx.globalAlpha = n.time < S.clock ? 1 : 0.55;
      ctx.fillRect(xOf(n.time), yOf(n.midi) - 1, Math.max(1.5, (n.duration / dur) * (w - pad * 2)), 2);
    }
    ctx.globalAlpha = 1;
    const x = xOf(util.clamp(S.clock, 0, dur));
    ctx.fillStyle = C.blue;
    ctx.fillRect(x - 1, 2, 2, h - 4);
  }

  const gram = { off: null, marks: [], lastMark: null };
  function drawGram(p, S) {
    const { ctx, w, h } = p;
    if (!gram.off || gram.off.width !== Math.floor(w) || gram.off.height !== Math.floor(h)) {
      gram.off = document.createElement('canvas');
      gram.off.width = Math.floor(w);
      gram.off.height = Math.floor(h);
      gram.octx = gram.off.getContext('2d');
      gram.octx.fillStyle = C.dark;
      gram.octx.fillRect(0, 0, w, h);
      gram.marks = [];
    }
    const o = gram.octx;
    const step = 2;
    o.drawImage(gram.off, 0, 0, gram.off.width, gram.off.height - step, 0, step, gram.off.width, gram.off.height - step);
    o.fillStyle = C.dark;
    o.fillRect(0, 0, w, step);
    const f = audio.getFreqData();
    if (f) {
      const sr = audio.ctx ? audio.ctx.sampleRate : 44100;
      const binHz = sr / 2 / f.length;
      const x0 = 38;
      const cols = Math.floor((w - x0) / 2);
      for (let c = 0; c < cols; c++) {
        const fr = 30 * Math.pow(12000 / 30, c / cols);
        const v = f[Math.min(f.length - 1, Math.round(fr / binHz))] / 255;
        if (v < 0.08) continue;
        o.fillStyle = v > 0.75 ? alpha('#e9fbff', v) : alpha(C.teal || '#22d3ee', Math.min(1, v * 1.3));
        o.fillRect(x0 + c * 2, 0, 2, step);
      }
      // linha de "agulha"
      o.fillStyle = 'rgba(80,120,255,0.18)';
      o.fillRect(x0 + cols * 0.5, 0, 1, step);
    }
    // marcas de tempo
    const t = S.clock;
    const mk = Math.floor(t / 4);
    if (gram.lastMark !== mk) {
      gram.lastMark = mk;
      gram.marks.push({ y: 0, text: util.formatTime(Math.max(0, mk * 4)) });
    }
    for (const m of gram.marks) m.y += step;
    gram.marks = gram.marks.filter((m) => m.y < h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(gram.off, 0, 0, w, h);
    for (const m of gram.marks) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(34, m.y, w - 34, 1);
      label(ctx, m.text, 4, m.y + 10, C.darkInk, 10, 500);
    }
  }

  // ------------------------------------------------------------------ pista 3D
  function drawHighway(p, S) {
    const { ctx, w, h } = p;
    ctx.clearRect(0, 0, w, h);
    const lanes = S.lanes;
    const n = lanes.length;
    const hitY = h - 58;
    const horizonY = 40;
    const vx = w / 2;
    const trackW = Math.min(w - 36, Math.max(260, n * 64));
    const left = vx - trackW / 2;
    const laneW = trackW / n;
    const LA = S.lookahead * (S.song ? S.speed : 1);
    const DEPTH = 6.5;
    const now = S.song ? S.t : S.clock;
    p.geo = { left, laneW, n, hitY, lanes };
    const proj = (x, dt) => {
      const d = Math.max(-0.12, dt / LA) * DEPTH;
      const s = 1 / (1 + d);
      return [vx + (x - vx) * s, horizonY + (hitY - horizonY) * s, s];
    };

    // piso
    const [ax, ay] = proj(left, -0.06 * LA);
    const [bx] = proj(left + trackW, -0.06 * LA);
    const [cx2, cy2] = proj(left + trackW, LA);
    const [dx] = proj(left, LA);
    const grd = ctx.createLinearGradient(0, cy2, 0, ay);
    grd.addColorStop(0, alpha(C.panel2, 0));
    grd.addColorStop(1, C.panel2);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, ay);
    ctx.lineTo(cx2, cy2);
    ctx.lineTo(dx, cy2);
    ctx.closePath();
    ctx.fill();

    // linhas das faixas
    ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      const x = left + i * laneW;
      const [x1, y1] = proj(x, -0.06 * LA);
      const [x2, y2] = proj(x, LA);
      ctx.strokeStyle = i === 0 || i === n ? C.line : C.grid;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // linhas de batida
    if (S.song) {
      const B = S.beats;
      const pick = S.pickup || 0;
      let beat = Math.ceil(B.beatAt(Math.max(now, -50)));
      const endB = B.beatAt(now + LA);
      for (let g = 0; beat <= endB && g < 64; beat++, g++) {
        const dt = B.timeAt(beat) - now;
        if (dt < 0) continue;
        const [xa, y] = proj(left, dt);
        const [xb] = proj(left + trackW, dt);
        const rel = beat - pick;
        const isBar = ((rel % S.timeSig) + S.timeSig) % S.timeSig === 0;
        ctx.strokeStyle = isBar ? C.line : alpha(C.grid, 0.8);
        ctx.lineWidth = isBar ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(xa, y);
        ctx.lineTo(xb, y);
        ctx.stroke();
      }
    }

    const laneX = (i) => left + (i + 0.5) * laneW;
    const beam = (i, color, strength) => {
      const xc = laneX(i);
      const hw = laneW * 0.2;
      const [x1, y1] = proj(xc - hw, 0);
      const [x2] = proj(xc + hw, 0);
      const [x3, y3] = proj(xc + hw, LA);
      const [x4] = proj(xc - hw, LA);
      const g = ctx.createLinearGradient(0, y3, 0, y1);
      g.addColorStop(0, alpha(color, 0));
      g.addColorStop(1, alpha(color, strength));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y3);
      ctx.closePath();
      ctx.fill();
    };

    // faixas acesas (acompanhamento e você)
    for (const i of S.autoLanes) beam(i, C.teal, 0.35);
    for (const [midi] of S.held) {
      const i = S.laneIndex.get(midi);
      if (i != null) beam(i, C.purple, 0.6);
    }

    // notas
    const tail = (xc, a, b, hw, color) => {
      const [x1, y1] = proj(xc - hw, a);
      const [x2] = proj(xc + hw, a);
      const [x3, y3] = proj(xc + hw, b);
      const [x4] = proj(xc - hw, b);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y3);
      ctx.closePath();
      ctx.fill();
    };
    if (S.song) {
      const notes = S.notes;
      const heads = [];
      for (let k = firstIndex(notes, now - 1); k < notes.length; k++) {
        const nt = notes[k];
        const dt0 = nt.time - now;
        if (dt0 > LA) break;
        const dt1 = nt.time + nt.duration - now;
        if (dt1 < -0.3 * S.speed) continue;
        const i = S.laneIndex.get(nt.playMidi);
        if (i == null) continue;
        const xc = laneX(i);
        const isHit = nt.judge && nt.judge !== 'miss';
        const col = nt.judge === 'miss' ? C.red : handColor(nt);
        const a = Math.max(dt0, 0);
        const b = Math.min(dt1, LA);
        if (b > a + 0.01) tail(xc, a, b, laneW * 0.13, alpha(col, isHit ? 0.75 : 0.4));
        if (!isHit && dt0 >= -0.2 * S.speed) heads.push([xc, dt0, col, nt]);
      }
      // cabeças de trás para frente (as mais próximas por cima)
      for (let k = heads.length - 1; k >= 0; k--) {
        const [xc, dt0, col, nt] = heads[k];
        const [x, y, s] = proj(xc, dt0);
        const r = util.clamp(laneW * 0.3 * s, 2, 17);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = alpha(C.ink, 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
        if (s > 0.55 && r > 9 && S.showKeyOnNotes) {
          const kl = S.keyLabel(nt.playMidi);
          if (kl) label(ctx, kl, x, y + 4, '#fff', Math.min(12, r * 0.9), 700, 'center');
        }
      }
    } else {
      // modo livre: o que você toca sobe pela pista
      for (const l of S.live) {
        const i = S.laneIndex.get(l.midi);
        if (i == null) continue;
        const a = (now - (l.end == null ? now : l.end)) * 1.0;
        const b = (now - l.start) * 1.0;
        if (a > LA) continue;
        const xc = laneX(i);
        tail(xc, Math.max(0, a), Math.min(LA, b), laneW * 0.16, alpha(C.purple, 0.45));
        const [x, y, s] = proj(xc, Math.min(LA, b));
        const r = util.clamp(laneW * 0.28 * s, 2, 15);
        ctx.fillStyle = C.purple;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // círculos de acerto
    const showLabels = laneW >= 22;
    const every = showLabels ? 1 : Math.ceil(22 / laneW);
    for (let i = 0; i < n; i++) {
      const xc = laneX(i);
      const r = util.clamp(laneW * 0.34, 3, 15);
      const midi = lanes[i];
      const held = S.held.has(midi);
      const autoOn = S.autoLanes.has(i);
      const hint = S.hintLanes.has(i);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = held ? C.purple : hint ? C.blue : C.line;
      ctx.fillStyle = held ? C.purple : autoOn ? C.teal : C.panel;
      ctx.beginPath();
      ctx.arc(xc, hitY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (held || hint) {
        ctx.strokeStyle = alpha(held ? C.purple : C.blue, held ? 0.45 : 0.35);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(xc, hitY, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (i % every === 0) {
        label(ctx, S.noteName(midi), xc, hitY - r - 8, held ? C.purple : C.muted, showLabels ? 10 : 9, 500, 'center');
        const kl = S.keyLabel(midi);
        if (kl) {
          ctx.font = '600 10px ' + MONO;
          const tw = Math.max(14, ctx.measureText(kl).width + 8);
          ctx.fillStyle = held ? C.purple : C.panel;
          ctx.strokeStyle = held ? C.purple : C.line;
          ctx.lineWidth = 1;
          rrect(ctx, xc - tw / 2, hitY + r + 6, tw, 15, 3);
          ctx.fill();
          ctx.stroke();
          label(ctx, kl, xc, hitY + r + 17, held ? '#fff' : C.ink, 10, 600, 'center');
        }
      }
    }

    // ondas de toque
    for (const rp of S.ripples) {
      const i = S.laneIndex.get(rp.midi);
      if (i == null) continue;
      const r0 = util.clamp(laneW * 0.34, 3, 15);
      ctx.strokeStyle = alpha(C.purple, 1 - rp.age / 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(laneX(i), hitY, r0 + rp.age * 60, 0, Math.PI * 2);
      ctx.stroke();
    }

    // textos de julgamento
    const jc = { perfect: C.teal, great: C.blue, good: C.purple, miss: C.red, wrong: C.red, hit: C.green };
    for (const pp of S.popups) {
      const i = S.laneIndex.get(pp.midi);
      const x = i != null ? laneX(i) : vx;
      const a = 1 - pp.age / 0.9;
      ctx.globalAlpha = Math.max(0, a);
      label(ctx, pp.text, util.clamp(x, 50, w - 50), hitY - 44 - pp.age * 46, jc[pp.kind] || C.ink, 12, 700, 'center');
    }
    ctx.globalAlpha = 1;

    // HUD
    const st = S.stats;
    if (S.mode === 'challenge') {
      label(ctx, 'PONTOS ' + String(Math.round(st.score)).padStart(7, '0'), 14, 22, C.ink, 14, 600);
      label(ctx, st.combo + ' COMBO  ×' + S.multiplier, w - 14, 22, C.blue, 13, 600, 'right');
    } else if (S.mode === 'practice') {
      label(ctx, 'CERTAS ' + String(st.correct).padStart(4, '0') + '   ERRADAS ' + String(st.wrong).padStart(3, '0'), 14, 22, C.ink, 13, 600);
      label(ctx, st.combo + ' SEGUIDAS', w - 14, 22, C.blue, 13, 600, 'right');
    } else if (S.mode === 'watch') {
      label(ctx, 'ASSISTINDO', 14, 22, C.ink, 13, 600);
      label(ctx, 'toque junto se quiser', w - 14, 22, C.muted, 11, 500, 'right');
    } else {
      label(ctx, 'MODO LIVRE', 14, 22, C.ink, 13, 600);
      label(ctx, 'toque qualquer tecla destacada', w - 14, 22, C.muted, 11, 500, 'right');
    }
    label(ctx, 'FAIXA ' + S.trackText, 14, h - 10, C.muted, 10, 500);
    label(ctx, Math.round(S.bpm * (S.song ? S.speed : 1)) + ' BPM', w - 14, h - 10, C.muted, 10, 500, 'right');

    if (S.waitingText) {
      ctx.font = '600 12px ' + MONO;
      const tw = ctx.measureText(S.waitingText).width + 24;
      ctx.fillStyle = alpha(C.blue, 0.12);
      ctx.strokeStyle = C.blue;
      rrect(ctx, vx - tw / 2, 34, tw, 24, 5);
      ctx.fill();
      ctx.stroke();
      label(ctx, S.waitingText, vx, 50, C.blue, 12, 600, 'center');
    }
    if (S.countdown) {
      ctx.globalAlpha = 0.85;
      label(ctx, S.countdown, vx, h * 0.48, C.ink, Math.min(110, h * 0.25), 700, 'center');
      ctx.globalAlpha = 1;
    }
    if (S.state === 'paused') {
      label(ctx, '❚❚ PAUSADO — ENTER para continuar', vx, h * 0.45, C.muted, 13, 600, 'center');
    }
  }

  const panels = {};
  const visuals = {
    MONO,
    init(map) {
      readColors();
      const fns = { dial: drawDial, roll: drawRoll, wave: drawWave, scope: drawScope, spec: drawSpectrum, vector: drawVector, map: drawMap, gram: drawGram, highway: drawHighway };
      for (const [k, cv] of Object.entries(map)) if (cv && fns[k]) panels[k] = new Panel(cv, fns[k]);
      bus.on('theme', () => {
        readColors();
        gram.off = null;
      });
    },
    frame(S) {
      if (audio.ctx) pushLevels();
      for (const p of Object.values(panels)) {
        if (!p.visible) continue;
        if (p.cv.width !== Math.floor(p.cv.clientWidth * p.dpr) || p.cv.height !== Math.floor(p.cv.clientHeight * p.dpr)) p.resize();
        try {
          p.draw(p, S);
        } catch (e) {
          if (!p._err) console.error(e);
          p._err = true;
        }
      }
    },
    panels,
    readColors,
  };
  PN.visuals = visuals;
})();
