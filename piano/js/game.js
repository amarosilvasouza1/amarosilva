/* Pianeon — reprodução de músicas e lógica dos modos de jogo */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus, audio } = PN;

  const MODES = {
    free: { name: 'Livre', explain: 'Toque à vontade. O que você toca aparece na tela.' },
    watch: { name: 'Ouvir', explain: 'A música toca sozinha e mostra quais teclas apertar. Ótimo para conhecer a música.' },
    practice: { name: 'Aprender', explain: 'A música para e espera. Ela só continua quando você acerta a tecla que pisca.' },
    challenge: { name: 'Jogar', explain: 'Valendo pontos. Aperte quando a nota encostar na linha; acertos seguidos multiplicam os pontos (até ×4).' },
  };
  // Janelas de acerto em segundos reais
  const WIN = { perfect: 0.05, great: 0.1, good: 0.16 };
  const POINTS = { perfect: 300, great: 200, good: 100 };
  const JUDGE_TEXT = { perfect: 'PERFEITO', great: 'ÓTIMO', good: 'BOM', miss: 'ERROU', wrong: 'NOTA ERRADA', hit: 'CERTO' };

  const freshStats = () => ({ score: 0, combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0, miss: 0, wrong: 0, correct: 0, total: 0 });

  class Player {
    constructor() {
      this.song = null;
      this.mode = 'free';
      this.hands = store.get('hands', { R: true, L: true });
      this.speed = store.get('speed', 1);
      this.state = 'idle'; // idle | playing | paused | waiting | finished
      this.t = 0;
      this.stats = freshStats();
      this.notes = [];
      this.targets = [];
      this.auto = [];
      this.groups = [];
      this.lanes = [];
      this.popups = [];
      this.ripples = [];
      this.live = []; // notas tocadas pelo usuário (para o piano roll)
      this.held = new Map(); // midi -> {hand, t}
      this.metronome = store.get('metronome', false);
      this.freeBpm = store.get('freeBpm', 100);
      this.fold = store.get('fold', true);
      this.level = store.get('level', 'medium'); // easy | medium | full
      this.playCount = 0;
      this.leadIn = store.get('leadIn', 2.6); // segundos reais antes da 1ª nota
      this.wall0 = performance.now() / 1000;
      this.lastBeat = null;
      this.results = null;
      this.lastResults = null;
    }

    wall() {
      return performance.now() / 1000 - this.wall0;
    }
    /** Tempo usado pelo piano roll / notas ao vivo. */
    clock() {
      return this.song ? this.t : this.wall();
    }
    get beats() {
      return PN.songs.beatsFromSong(this.song, this.freeBpm);
    }

    // ------------------------------------------------------------ carregar
    load(song, mode, opts = {}) {
      this.stop(true);
      this.song = song;
      this.mode = song ? mode || 'watch' : 'free';
      if (opts.hands) this.setHands(opts.hands, true);
      if (opts.speed) this.setSpeed(opts.speed);
      this.results = null;
      this._beatsCache = song ? PN.songs.beatsFromSong(song) : null;
      this._prepare();
      if (song) {
        const first = this.notes.length ? this.notes[0].time : 0;
        this.t = Math.min(0, first) - this.leadIn * this.speed;
        this.state = opts.autostart ? 'playing' : 'ready';
      } else {
        this.state = 'idle';
      }
      bus.emit('player:load', this);
      bus.emit('player:state', this.state);
    }

    _prepare() {
      const song = this.song;
      this.stats = freshStats();
      this.popups = [];
      this.autoIdx = 0;
      this.missIdx = 0;
      this.waitIdx = 0;
      this.lastBeat = null;
      if (!song) {
        this.notes = [];
        this.targets = [];
        this.auto = [];
        this.groups = [];
        this.computeLanes();
        return;
      }
      const playing = this.mode === 'practice' || this.mode === 'challenge';
      const roles = this.rolesFor(song);
      this.notes = [];
      song.notes.forEach((n, i) => {
        // papel da faixa: R/L = mão que você toca, A = o app acompanha, M = silenciada
        const role = roles && n.track != null ? roles[n.track] || 'A' : n.hand;
        if (role === 'M') return;
        const hand = role === 'R' || role === 'L' ? role : n.hand;
        this.notes.push({
          midi: n.midi,
          time: n.time,
          duration: n.duration,
          velocity: n.velocity,
          hand,
          track: n.track,
          i,
          target: playing && role !== 'A' && !!this.hands[hand],
          playMidi: n.midi,
          judge: null,
        });
      });
      this.applyLevel();
      this.applyFold();
      this.dedupeTargets();
      this.targets = this.notes.filter((n) => n.target);
      this.auto = this.notes.filter((n) => !n.target);
      this.stats.total = this.targets.length;
      this.playCount = this.targets.length;
      // grupos (acordes) para o modo praticar
      this.groups = [];
      for (const n of this.targets) {
        const g = this.groups[this.groups.length - 1];
        if (g && n.time - g.time < 0.035) {
          g.notes.push(n);
          g.pending.add(n.playMidi);
        } else this.groups.push({ time: n.time, notes: [n], pending: new Set([n.playMidi]) });
      }
      this.computeLanes();
    }

    /**
     * Deixa a parte do usuário tocável no teclado do computador:
     * Fácil = uma nota por vez em cada mão (melodia/baixo), Médio = até 2 por mão, Completo = tudo.
     * As notas tiradas continuam soando: o app toca junto.
     */
    applyLevel() {
      if (this.level === 'full') return;
      const keep = this.level === 'easy' ? 1 : 2;
      const minGap = this.level === 'easy' ? 0.12 : 0.07; // notas rápidas demais para o teclado
      for (const hand of ['R', 'L']) {
        const list = this.notes.filter((n) => n.target && n.hand === hand);
        let i = 0;
        let lastKept = -1;
        while (i < list.length) {
          const cluster = [list[i]];
          let j = i + 1;
          while (j < list.length && list[j].time - list[i].time < 0.035) cluster.push(list[j++]);
          cluster.sort((a, b) => (hand === 'R' ? b.midi - a.midi : a.midi - b.midi));
          if (lastKept >= 0 && list[i].time - lastKept < minGap) {
            for (const n of cluster) n.target = false;
          } else {
            cluster.slice(keep).forEach((n) => (n.target = false));
            lastKept = list[i].time;
          }
          i = j;
        }
      }
    }

    /** Depois de trazer notas para o alcance, duas notas iguais no mesmo instante viram uma só. */
    dedupeTargets() {
      const seen = new Map();
      for (const n of this.notes) {
        if (!n.target) continue;
        const key = n.playMidi + ':' + Math.round(n.time / 0.035);
        if (seen.has(key)) n.target = false;
        else seen.set(key, true);
      }
    }

    setLevel(l) {
      if (!['easy', 'medium', 'full'].includes(l)) return;
      this.level = l;
      store.set('level', l);
      if (this.song) this.restart(false);
    }

    /** Papéis das faixas de um MIDI com várias faixas (salvos por música). */
    rolesFor(song) {
      if (!song || !song.tracks || song.tracks.length < 2) return null;
      const saved = (store.get('roles', {}) || {})[song.id];
      if (saved) return saved;
      return Player.defaultRoles(song);
    }
    static defaultRoles(song) {
      const tracks = song.tracks.filter((t) => t.noteCount > 0);
      const roles = {};
      if (tracks.length <= 2) {
        const sorted = tracks.slice().sort((a, b) => b.avgPitch - a.avgPitch);
        roles[sorted[0].index] = 'R';
        if (sorted[1]) roles[sorted[1].index] = 'L';
        return roles;
      }
      // várias faixas: a mais aguda com bastante nota é a melodia, a mais grave é o baixo
      const total = tracks.reduce((s, t) => s + t.noteCount, 0);
      const big = tracks.filter((t) => t.noteCount >= total * 0.06);
      const pool = big.length ? big : tracks;
      const melody = pool.slice().sort((a, b) => b.avgPitch - a.avgPitch)[0];
      const bass = pool.filter((t) => t !== melody).sort((a, b) => a.avgPitch - b.avgPitch)[0];
      for (const t of tracks) roles[t.index] = 'A';
      roles[melody.index] = 'R';
      if (bass) roles[bass.index] = 'L';
      return roles;
    }
    setTrackRole(song, index, role) {
      const all = store.get('roles', {}) || {};
      const cur = Object.assign({}, this.rolesFor(song) || {});
      cur[index] = role;
      all[song.id] = cur;
      store.set('roles', all);
      if (this.song && this.song.id === song.id) this.restart(false);
    }

    /** Traz para o alcance do teclado as notas que o usuário precisa tocar. */
    applyFold() {
      const avail = PN.keymap.availableSet();
      if (!avail.size) return;
      const list = [...avail];
      const lo = Math.min(...list);
      const hi = Math.max(...list);
      for (const n of this.notes) {
        n.playMidi = n.midi;
        n.folded = false;
        if (!n.target || !this.fold || avail.has(n.midi)) continue;
        let m = n.midi;
        while (m < lo) m += 12;
        while (m > hi) m -= 12;
        if (!avail.has(m)) {
          let best = null;
          for (const a of list) if (a % 12 === n.midi % 12 && (best == null || Math.abs(a - n.midi) < Math.abs(best - n.midi))) best = a;
          if (best != null) m = best;
          else m = n.midi;
        }
        n.playMidi = m;
        n.folded = m !== n.midi;
      }
    }

    refold() {
      if (!this.song) {
        this.computeLanes();
        return;
      }
      this.applyFold();
      for (const g of this.groups) {
        g.pending = new Set(g.notes.filter((n) => !n.judge).map((n) => n.playMidi));
      }
      this.computeLanes();
    }

    /** Faixas da pista 3D: as notas que aparecem na música (ou o teclado inteiro no modo livre). */
    computeLanes() {
      let set;
      if (this.song) {
        const src = this.targets.length ? this.targets : this.notes;
        set = new Set(src.map((n) => n.playMidi));
      } else {
        set = new Set(Object.values(PN.keymap.map));
      }
      let lanes = [...set].sort((a, b) => a - b);
      if (!lanes.length) lanes = [60, 62, 64, 65, 67, 69, 71, 72];
      this.lanes = lanes;
      this.laneIndex = new Map(lanes.map((m, i) => [m, i]));
      bus.emit('player:lanes', lanes);
    }

    setHands(h, silent) {
      if (typeof h === 'string') h = { R: h.includes('R'), L: h.includes('L') };
      if (!h.R && !h.L) h = { R: true, L: true };
      this.hands = h;
      store.set('hands', h);
      if (!silent && this.song) this.restart(false);
    }
    setSpeed(s) {
      this.speed = util.clamp(Math.round(s * 100) / 100, 0.25, 2);
      store.set('speed', this.speed);
      if (this.state === 'ready' && this.song) {
        const first = this.notes.length ? this.notes[0].time : 0;
        this.t = Math.min(0, first) - this.leadIn * this.speed;
      }
      if (this.state === 'playing') {
        audio.cancelScheduled();
        this._resyncAuto();
      }
      bus.emit('player:speed', this.speed);
    }
    setFold(on) {
      this.fold = !!on;
      store.set('fold', this.fold);
      this.refold();
    }

    // ------------------------------------------------------------ transporte
    play() {
      if (!this.song) return;
      if (this.state === 'finished') return this.restart(true);
      if (this.state === 'ready') {
        this.state = 'playing';
        this._resyncAuto();
        bus.emit('player:state', this.state);
        return;
      }
      if (this.state === 'paused') {
        this.state = this._waitingGroup() ? 'waiting' : 'playing';
        this._resyncAuto();
        bus.emit('player:state', this.state);
      }
    }
    pause() {
      if (this.state === 'playing' || this.state === 'waiting') {
        this.state = 'paused';
        audio.cancelScheduled();
        bus.emit('player:state', this.state);
      }
    }
    toggle() {
      if (this.state === 'paused' || this.state === 'finished' || this.state === 'ready') this.play();
      else this.pause();
    }
    restart(autostart) {
      if (!this.song) return;
      this.load(this.song, this.mode, { autostart: !!autostart });
    }
    stop(silent) {
      audio.cancelScheduled();
      this.state = 'idle';
      if (!silent) bus.emit('player:state', this.state);
    }
    seek(t) {
      if (!this.song || this.mode === 'challenge') return;
      audio.cancelScheduled();
      this.t = util.clamp(t, -1, this.song.duration);
      // reinicia julgamentos depois do ponto
      for (const n of this.notes) if (n.time >= this.t) n.judge = null;
      this.waitIdx = this.groups.findIndex((g) => g.time >= this.t - 0.001);
      if (this.waitIdx < 0) this.waitIdx = this.groups.length;
      for (const g of this.groups) g.pending = new Set(g.notes.filter((n) => !n.judge).map((n) => n.playMidi));
      this.missIdx = 0;
      this._resyncAuto();
      if (this.state === 'waiting') this.state = 'playing';
      if (this.state === 'finished') this.state = 'paused';
      bus.emit('player:state', this.state);
    }
    _resyncAuto() {
      this.autoIdx = 0;
      while (this.autoIdx < this.auto.length && this.auto[this.autoIdx].time < this.t - 0.001) this.autoIdx++;
      this.lastBeat = null;
    }
    _waitingGroup() {
      if (this.mode !== 'practice') return null;
      const g = this.groups[this.waitIdx];
      return g && this.t >= g.time - 1e-6 ? g : null;
    }

    // ------------------------------------------------------------ quadro a quadro
    update(dt) {
      dt = Math.min(dt, 0.1);
      this._agePopups(dt);
      if (!this.song) {
        this._freeMetronome();
        return;
      }
      if (this.state !== 'playing' && this.state !== 'waiting') return;

      let nt = this.t + dt * this.speed;
      if (this.mode === 'practice') {
        const g = this.groups[this.waitIdx];
        if (g && nt >= g.time) {
          nt = g.time;
          if (this.state !== 'waiting') {
            this.state = 'waiting';
            bus.emit('player:state', this.state);
          }
        }
      }
      const prevT = this.t;
      this.t = nt;

      // acompanhamento automático (agendado com antecedência no relógio de áudio)
      let limit = this.t + 0.12 * this.speed;
      if (this.mode === 'practice') {
        const g = this.groups[this.waitIdx];
        if (g) limit = Math.min(limit, g.time - 1e-4);
        if (this.state === 'waiting') limit = Math.min(limit, this.t - 1e-4);
      }
      while (this.autoIdx < this.auto.length && this.auto[this.autoIdx].time < limit) {
        const n = this.auto[this.autoIdx++];
        if (n.time < this.t - 0.08 * this.speed) continue;
        audio.schedule(n.midi, n.velocity, audio.now + Math.max(0, (n.time - this.t) / this.speed), n.duration / this.speed);
      }

      if (this.metronome && this.state === 'playing') this._songMetronome(prevT);

      if (this.mode === 'challenge') {
        const late = WIN.good * this.speed;
        while (this.missIdx < this.targets.length && this.targets[this.missIdx].time < this.t - late) {
          const n = this.targets[this.missIdx++];
          if (!n.judge) {
            n.judge = 'miss';
            this.stats.miss++;
            this.stats.combo = 0;
            this._popup('miss', n.playMidi);
          }
        }
      }

      if (this.t > this.song.duration + 0.8 && (this.mode !== 'practice' || this.waitIdx >= this.groups.length)) this.finish();
    }

    _songMetronome(prevT) {
      const b = this._beatsCache;
      const b0 = Math.floor(b.beatAt(prevT));
      const b1 = Math.floor(b.beatAt(this.t));
      if (b1 > b0 && this.t >= 0) {
        const beat = b1;
        const when = audio.now + Math.max(0, (b.timeAt(beat) - this.t) / this.speed);
        const rel = beat - (this.song.pickup || 0);
        audio.click(when, ((rel % this.song.timeSig) + this.song.timeSig) % this.song.timeSig === 0);
      }
    }
    _freeMetronome() {
      if (!this.metronome || !audio.ctx) return;
      const beat = Math.floor((this.wall() * this.freeBpm) / 60);
      if (this.lastBeat !== beat) {
        if (this.lastBeat != null) audio.click(audio.now, beat % 4 === 0);
        this.lastBeat = beat;
      }
    }

    finish() {
      if (this.state === 'finished') return;
      this.state = 'finished';
      const s = this.stats;
      let acc;
      if (this.mode === 'challenge') acc = s.total ? (s.perfect + s.great * 0.8 + s.good * 0.5) / s.total : 1;
      else if (this.mode === 'practice') acc = s.correct + s.wrong ? s.correct / (s.correct + s.wrong) : 1;
      else acc = 1;
      const stars = acc >= 0.95 ? 5 : acc >= 0.85 ? 4 : acc >= 0.7 ? 3 : acc >= 0.5 ? 2 : 1;
      const res = { song: this.song, mode: this.mode, stats: Object.assign({}, s), accuracy: acc, stars, speed: this.speed, hands: this.hands, date: Date.now() };
      if (this.mode !== 'watch') {
        const key = this.song.id + ':' + this.mode;
        const best = store.get('best', {});
        const prev = best[key];
        res.newBest = !prev || (this.mode === 'challenge' ? s.score > prev.score : acc > prev.acc);
        if (res.newBest) {
          best[key] = { score: s.score, acc, stars, date: res.date };
          store.set('best', best);
        }
        res.prevBest = prev || null;
      }
      this.results = res;
      this.lastResults = res;
      bus.emit('player:state', this.state);
      bus.emit('player:finish', res);
    }

    static best(songId) {
      const best = store.get('best', {});
      return { practice: best[songId + ':practice'] || null, challenge: best[songId + ':challenge'] || null };
    }

    // ------------------------------------------------------------ entrada do usuário
    userOn(midi, vel) {
      const now = this.clock();
      this.held.set(midi, { t: now });
      this.live.push({ midi, start: now, end: null });
      if (this.live.length > 400) this.live.splice(0, this.live.length - 400);
      this.ripples.push({ midi, age: 0 });
      if (!this.song || this.mode === 'watch' || this.state === 'finished' || this.state === 'paused') return null;

      if (this.mode === 'practice') {
        const g = this.groups[this.waitIdx];
        const near = g && (this.state === 'waiting' || g.time - this.t <= 0.45 * this.speed);
        if (near && g.pending.has(midi)) {
          g.pending.delete(midi);
          for (const n of g.notes) if (n.playMidi === midi && !n.judge) n.judge = 'hit';
          this.stats.correct++;
          this.stats.combo++;
          this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
          this.stats.score += 100;
          if (!g.pending.size) {
            this.waitIdx++;
            if (this.state === 'waiting') {
              this.state = 'playing';
              bus.emit('player:state', this.state);
            }
          }
          this._popup('hit', midi);
          return 'hit';
        }
        // fora da hora de tocar (introdução, pausas longas): não conta como erro
        if (!near) return null;
        this.stats.wrong++;
        this.stats.combo = 0;
        this._popup('wrong', midi);
        return 'wrong';
      }

      if (this.mode === 'challenge') {
        if (this.t < -0.5) return null;
        const win = WIN.good * this.speed;
        let best = null;
        let bestD = Infinity;
        for (let i = this.missIdx; i < this.targets.length; i++) {
          const n = this.targets[i];
          if (n.time > this.t + win) break;
          if (n.judge || n.playMidi !== midi) continue;
          const d = Math.abs(n.time - this.t);
          if (d <= win && d < bestD) {
            best = n;
            bestD = d;
          }
        }
        // também procura notas um pouco antes do índice de "perdidas"
        for (let i = Math.max(0, this.missIdx - 8); i < this.missIdx; i++) {
          const n = this.targets[i];
          if (!n.judge && n.playMidi === midi && Math.abs(n.time - this.t) <= win && Math.abs(n.time - this.t) < bestD) {
            best = n;
            bestD = Math.abs(n.time - this.t);
          }
        }
        if (!best) {
          this.stats.wrong++;
          this.stats.combo = 0;
          this._popup('wrong', midi);
          return 'wrong';
        }
        const real = bestD / this.speed;
        const j = real <= WIN.perfect ? 'perfect' : real <= WIN.great ? 'great' : 'good';
        best.judge = j;
        this.stats[j]++;
        this.stats.combo++;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
        this.stats.score += POINTS[j] * this.multiplier();
        this._popup(j, midi);
        return j;
      }
      return null;
    }

    userOff(midi) {
      this.held.delete(midi);
      const now = this.clock();
      for (let i = this.live.length - 1; i >= 0; i--) {
        if (this.live[i].midi === midi && this.live[i].end == null) {
          this.live[i].end = Math.max(now, this.live[i].start + 0.04);
          break;
        }
      }
    }

    multiplier() {
      return Math.min(4, 1 + Math.floor(this.stats.combo / 10));
    }

    _popup(kind, midi) {
      this.popups.push({ kind, text: JUDGE_TEXT[kind], midi, age: 0 });
      if (this.popups.length > 12) this.popups.shift();
      bus.emit('player:judge', kind, midi);
    }
    _agePopups(dt) {
      for (const p of this.popups) p.age += dt;
      this.popups = this.popups.filter((p) => p.age < 0.9);
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < 0.6);
    }

    /** Resumo para a IA. */
    describe() {
      const s = this.stats;
      return {
        modo: MODES[this.mode].name,
        musica: this.song ? { id: this.song.id, titulo: this.song.title, compositor: this.song.composer, duracao_s: Math.round(this.song.duration) } : null,
        estado: this.state,
        tempo_s: this.song ? Math.max(0, Math.round(this.t * 10) / 10) : null,
        velocidade: Math.round(this.speed * 100) + '%',
        maos: (this.hands.R ? 'direita ' : '') + (this.hands.L ? 'esquerda' : ''),
        placar: this.mode === 'challenge' ? { pontos: s.score, combo: s.combo, perfeitos: s.perfect, otimos: s.great, bons: s.good, erros: s.miss, notas_erradas: s.wrong } : this.mode === 'practice' ? { certas: s.correct, erradas: s.wrong } : null,
      };
    }
  }

  PN.MODES = MODES;
  PN.JUDGE_TEXT = JUDGE_TEXT;
  PN.Player = Player;
  PN.player = new Player();
})();
