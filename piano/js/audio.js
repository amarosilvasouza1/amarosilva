/* Pianeon — motor de áudio: piano de cauda com samples reais + sintetizadores */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus } = PN;

  // Samples do Salamander Grand Piano (licença CC-BY 3.0, por Alexander Holm),
  // hospedados pelo projeto Tone.js.
  const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
  const SAMPLE_NAMES = ['A0'];
  for (let o = 1; o <= 7; o++) SAMPLE_NAMES.push('C' + o, 'D#' + o, 'F#' + o, 'A' + o);
  SAMPLE_NAMES.push('C8');

  // Violão, guitarra, harpa, violino, flauta e xilofone: amostras do projeto
  // tonejs-instruments (Nicholaus Brosowsky), vindas de fontes livres
  // (VSCO 2 Community Edition, Karoryfer e Freesound/quartertone).
  const TJI = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';
  const SAMPLE_SETS = {
    grand: { base: SAMPLE_BASE, names: SAMPLE_NAMES, maxDist: 6, gain: 0.95, release: (m) => (m >= 89 ? 0.6 : m < 48 ? 0.22 : 0.15), fallback: 'softpiano' },
    nylon: {
      base: TJI + 'guitar-nylon/',
      names: ['B1', 'D2', 'E2', 'F#2', 'G#2', 'A2', 'B2', 'C#3', 'D3', 'E3', 'F#3', 'G3', 'A3', 'B3', 'C#4', 'D#4', 'E4', 'F#4', 'G#4', 'A4', 'B4', 'C#5', 'D5', 'E5', 'F#5', 'G#5', 'A5', 'A#5'],
      maxDist: 12, gain: 1.1, release: () => 0.12, fallback: 'pluck',
    },
    eguitar: {
      base: TJI + 'guitar-electric/',
      names: ['C#2', 'E2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6'],
      maxDist: 12, gain: 0.85, release: () => 0.08, fallback: 'pluck',
    },
    harp: {
      base: TJI + 'harp/',
      names: ['E1', 'G1', 'B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6', 'F6', 'A6', 'B6', 'D7', 'F7'],
      maxDist: 12, gain: 1.0, release: () => 0.8, fallback: 'pluck',
    },
    violin: {
      base: TJI + 'violin/',
      names: ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7'],
      maxDist: 12, gain: 0.8, release: () => 0.22, fallback: 'pad',
    },
    flute: {
      base: TJI + 'flute/',
      names: ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7'],
      maxDist: 12, gain: 0.85, release: () => 0.14, fallback: 'pad',
    },
    xylo: {
      base: TJI + 'xylophone/',
      names: ['G4', 'C5', 'G5', 'C6', 'G6', 'C7', 'G7', 'C8'],
      maxDist: 14, gain: 0.9, release: () => 0.35, fallback: 'musicbox',
    },
  };

  const INSTRUMENTS = [
    { id: 'grand', name: 'Piano de cauda', group: 'Teclas' },
    { id: 'epiano', name: 'Piano elétrico', group: 'Teclas' },
    { id: 'softpiano', name: 'Piano suave (sem internet)', group: 'Teclas' },
    { id: 'organ', name: 'Órgão', group: 'Teclas' },
    { id: 'nylon', name: 'Violão', group: 'Cordas' },
    { id: 'eguitar', name: 'Guitarra', group: 'Cordas' },
    { id: 'harp', name: 'Harpa', group: 'Cordas' },
    { id: 'violin', name: 'Violino', group: 'Cordas' },
    { id: 'flute', name: 'Flauta', group: 'Sopro e percussão' },
    { id: 'xylo', name: 'Xilofone', group: 'Sopro e percussão' },
    { id: 'musicbox', name: 'Caixinha de música', group: 'Sopro e percussão' },
    { id: 'synth', name: 'Synth', group: 'Eletrônicos' },
    { id: 'pad', name: 'Pad (cordas sintéticas)', group: 'Eletrônicos' },
  ];

  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.instrument = store.get('instrument', 'grand');
      this.volume = store.get('volume', 0.8);
      this.reverbAmount = store.get('reverb', 0.25);
      this.sets = {}; // id -> { state, map: Map(midi -> AudioBuffer) }
      for (const id of Object.keys(SAMPLE_SETS)) this.sets[id] = { state: 'idle', map: new Map() };
      this.samples = this.sets.grand.map; // compatibilidade
      if (!INSTRUMENTS.some((i) => i.id === this.instrument)) this.instrument = 'grand';
      this.live = new Map(); // midi -> voice (notas tocadas pelo usuário)
      this.held = new Set(); // teclas fisicamente pressionadas
      this.sustain = false;
      this.scheduled = new Set(); // vozes agendadas (autoplay)
      this.allVoices = [];
      this.maxVoices = 72; // acima disso, a nota mais antiga é cortada
    }

    /** Cria/resume o AudioContext (precisa de um gesto do usuário). */
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this._buildGraph();
        if (SAMPLE_SETS[this.instrument]) this.loadSamples(this.instrument);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    get now() {
      return this.ctx ? this.ctx.currentTime : 0;
    }

    get latency() {
      if (!this.ctx) return 0;
      return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    }

    _buildGraph() {
      const ctx = this.ctx;
      this.bus = ctx.createGain();
      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this._makeImpulse(1.8, 2.6); // reverb mais curto = menos processamento
      this.master = ctx.createGain();
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -12;
      this.comp.knee.value = 12;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.25;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.splitter = ctx.createChannelSplitter(2);
      this.anL = ctx.createAnalyser();
      this.anR = ctx.createAnalyser();
      this.anL.fftSize = this.anR.fftSize = 1024;
      this._timeBuf = new Float32Array(this.analyser.fftSize);
      this._freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
      this._lBuf = new Float32Array(this.anL.fftSize);
      this._rBuf = new Float32Array(this.anR.fftSize);

      this.bus.connect(this.dry);
      this.bus.connect(this.convolver);
      this.convolver.connect(this.wet);
      this.dry.connect(this.master);
      this.wet.connect(this.master);
      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);
      this.comp.connect(this.analyser);
      this.comp.connect(this.splitter);
      this.splitter.connect(this.anL, 0);
      this.splitter.connect(this.anR, 1);
      this.setVolume(this.volume);
      this.setReverb(this.reverbAmount);
    }

    _makeImpulse(seconds, decay) {
      const ctx = this.ctx;
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          // ruído filtrado (mais escuro com o tempo) e decaimento exponencial
          const white = Math.random() * 2 - 1;
          const k = 0.35 + 0.6 * t;
          lp = lp + (white - lp) * (1 - k);
          const pre = i < rate * 0.012 ? 0 : 1;
          d[i] = lp * Math.pow(1 - t, decay) * pre;
        }
      }
      return buf;
    }

    setVolume(v) {
      this.volume = util.clamp(v, 0, 1);
      store.set('volume', this.volume);
      if (this.master) this.master.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.02);
    }

    setReverb(v) {
      this.reverbAmount = util.clamp(v, 0, 1);
      store.set('reverb', this.reverbAmount);
      if (this.wet) {
        this.wet.gain.setTargetAtTime(this.reverbAmount * 0.9, this.ctx.currentTime, 0.03);
        this.dry.gain.setTargetAtTime(1 - this.reverbAmount * 0.35, this.ctx.currentTime, 0.03);
      }
    }

    setInstrument(id) {
      if (!INSTRUMENTS.some((i) => i.id === id)) return;
      this.instrument = id;
      store.set('instrument', id);
      if (SAMPLE_SETS[id] && this.ctx) this.loadSamples(id);
      bus.emit('instrument', id);
    }

    /** Dados para os visualizadores (reutiliza buffers). */
    getTimeData() {
      if (!this.analyser) return null;
      this.analyser.getFloatTimeDomainData(this._timeBuf);
      return this._timeBuf;
    }
    getFreqData() {
      if (!this.analyser) return null;
      this.analyser.getByteFrequencyData(this._freqBuf);
      return this._freqBuf;
    }
    getStereo() {
      if (!this.anL) return null;
      this.anL.getFloatTimeDomainData(this._lBuf);
      this.anR.getFloatTimeDomainData(this._rBuf);
      return [this._lBuf, this._rBuf];
    }
    /** Nível RMS (0..1). */
    getLevel() {
      const d = this.getTimeData();
      if (!d) return 0;
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      return Math.sqrt(sum / d.length);
    }

    get sampleState() {
      return this.sets.grand.state;
    }
    stateOf(id) {
      return this.sets[id] ? this.sets[id].state : 'none';
    }

    /** Baixa as gravações de um instrumento (só na primeira vez que ele é escolhido). */
    async loadSamples(id = 'grand') {
      const def = SAMPLE_SETS[id];
      const set = this.sets[id];
      if (!def || !set || set.state === 'loading' || set.state === 'ready') return;
      if (!this.ctx) return;
      set.state = 'loading';
      let done = 0;
      let failed = 0;
      const total = def.names.length;
      bus.emit('samples:progress', 0, total, id);
      const queue = def.names.slice();
      const worker = async () => {
        while (queue.length) {
          const name = queue.shift();
          try {
            const res = await fetch(def.base + name.replace('#', 's') + '.mp3');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const arr = await res.arrayBuffer();
            const buf = await this.ctx.decodeAudioData(arr);
            set.map.set(util.nameToMidi(name), buf);
          } catch (e) {
            failed++;
          }
          done++;
          bus.emit('samples:progress', done, total, id);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      set.state = failed === total ? 'error' : 'ready';
      bus.emit(set.state === 'ready' ? 'samples:ready' : 'samples:error', failed, id);
    }

    _nearestSample(midi, id = 'grand') {
      const def = SAMPLE_SETS[id];
      let best = null;
      let bestD = 99;
      for (const [m, buf] of this.sets[id].map) {
        const d = Math.abs(m - midi);
        if (d < bestD) {
          bestD = d;
          best = { midi: m, buf };
        }
      }
      return bestD <= def.maxDist ? best : null;
    }

    // ---------------------------------------------------------------- vozes
    _voice(midi, vel, when) {
      let inst = this.instrument;
      const def = SAMPLE_SETS[inst];
      if (def) {
        const s = this._nearestSample(midi, inst);
        if (s) return this._sampleVoice(midi, vel, when, s, def);
        inst = def.fallback; // enquanto as gravações carregam (ou sem internet)
      }
      switch (inst) {
        case 'pluck':
          return this._pluckVoice(midi, vel, when);
        case 'epiano':
          return this._epianoVoice(midi, vel, when);
        case 'synth':
          return this._synthVoice(midi, vel, when);
        case 'pad':
          return this._padVoice(midi, vel, when);
        case 'organ':
          return this._organVoice(midi, vel, when);
        case 'musicbox':
          return this._musicBoxVoice(midi, vel, when);
        default:
          return this._softPianoVoice(midi, vel, when);
      }
    }

    _finishVoice(v, out, release, extraStop) {
      // Liga a saída da voz ao barramento (com posição estéreo por altura,
      // como microfones sobre um piano real) e prepara o "stop" com release suave.
      let tail = out;
      if (this.ctx.createStereoPanner) {
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = util.clamp((v.midi - 64) / 50, -0.65, 0.65);
        out.connect(pan);
        tail = pan;
      }
      tail.connect(this.bus);
      v.out = out;
      v.stop = (t) => {
        if (v.stopped) return;
        v.stopped = true;
        const ctx = this.ctx;
        t = Math.max(t == null ? ctx.currentTime : t, v.start);
        const r = v.fastRelease ? 0.03 : release;
        try {
          out.gain.cancelScheduledValues(t);
          out.gain.setTargetAtTime(0, t, r);
        } catch (e) {}
        const end = t + r * 7;
        for (const n of v.sources) {
          try {
            n.stop(end);
          } catch (e) {}
        }
        if (extraStop) extraStop(t, r);
        setTimeout(() => {
          try {
            out.disconnect();
            if (tail !== out) tail.disconnect();
          } catch (e) {}
        }, (end - ctx.currentTime) * 1000 + 200);
      };
      this.allVoices.push(v);
      if (this.allVoices.length > this.maxVoices) {
        const old = this.allVoices.shift();
        old.fastRelease = true;
        old.stop();
      }
      return v;
    }

    _sampleVoice(midi, vel, when, s, def = SAMPLE_SETS.grand) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 900 + Math.pow(vel, 1.7) * 17000;
      filt.Q.value = 0.3;
      const g = ctx.createGain();
      const amp = (0.12 + 0.88 * Math.pow(vel, 1.5)) * def.gain;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, when + 0.004);
      src.connect(filt).connect(g);
      src.start(when);
      const v = { midi, start: when, sources: [src] };
      return this._finishVoice(v, g, def.release(midi));
    }

    /** Corda dedilhada sintetizada (usada enquanto as gravações de violão/guitarra/harpa carregam). */
    _pluckVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.8;
      filt.frequency.setValueAtTime(Math.min(14000, f * (4 + vel * 10)), when);
      filt.frequency.exponentialRampToValueAtTime(Math.max(150, f * 1.3), when + 0.7);
      const sources = [];
      [
        ['triangle', 1, 0],
        ['sawtooth', 0.22, 3],
      ].forEach(([type, a, det]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = a;
        o.connect(g).connect(filt);
        o.start(when);
        sources.push(o);
      });
      const out = ctx.createGain();
      const amp = 0.28 * (0.25 + 0.75 * vel);
      out.gain.setValueAtTime(0, when);
      out.gain.linearRampToValueAtTime(amp, when + 0.002);
      out.gain.setTargetAtTime(0, when + 0.002, util.clamp(1.1 * Math.sqrt(220 / f), 0.2, 1.8));
      filt.connect(out);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.1);
    }

    _softPianoVoice(midi, vel, when) {
      // Piano sintetizado (aditivo) — funciona sem internet.
      const ctx = this.ctx;
      const f = freq(midi);
      const out = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(Math.min(18000, f * (3 + vel * 10)), when);
      filt.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), when + 2.5);
      filt.connect(out);
      const sources = [];
      const decay = util.clamp(2.6 * Math.sqrt(220 / f), 0.35, 5);
      const partials = [1, 0.5, 0.32, 0.18, 0.1, 0.06];
      partials.forEach((a, i) => {
        const n = i + 1;
        const pf = f * n * Math.sqrt(1 + 0.00035 * n * n);
        if (pf > 16000) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = pf;
        const pg = ctx.createGain();
        const amp = a * (0.6 + vel * 0.4);
        pg.gain.setValueAtTime(0, when);
        pg.gain.linearRampToValueAtTime(amp, when + 0.003);
        pg.gain.setTargetAtTime(0, when + 0.003, decay / (1 + i * 0.7));
        o.connect(pg).connect(filt);
        o.start(when);
        sources.push(o);
      });
      out.gain.value = 0.22 * (0.2 + 0.8 * vel);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.14);
    }

    _epianoVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f;
      const modG = ctx.createGain();
      modG.gain.setValueAtTime(f * (1.2 + vel * 2.5), when);
      modG.gain.setTargetAtTime(f * 0.25, when, 0.5);
      mod.connect(modG).connect(car.frequency);
      const tine = ctx.createOscillator();
      tine.frequency.value = f * 14;
      const tineG = ctx.createGain();
      tineG.gain.setValueAtTime(f * 3 * vel, when);
      tineG.gain.setTargetAtTime(0, when, 0.03);
      tine.connect(tineG).connect(car.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(1, when + 0.003);
      env.gain.setTargetAtTime(0.0, when + 0.003, util.clamp(2.2 * Math.sqrt(262 / f), 0.6, 4));
      car.connect(env);
      const out = ctx.createGain();
      out.gain.value = 0.2 * (0.25 + 0.75 * vel);
      // tremolo leve
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.5;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.05;
      const trem = ctx.createGain();
      trem.gain.value = 1;
      lfo.connect(lfoG).connect(trem.gain);
      env.connect(trem).connect(out);
      [car, mod, tine, lfo].forEach((o) => o.start(when));
      const v = { midi, start: when, sources: [car, mod, tine, lfo] };
      return this._finishVoice(v, out, 0.18);
    }

    _synthVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 6;
      filt.frequency.setValueAtTime(f * 1.5, when);
      filt.frequency.linearRampToValueAtTime(Math.min(16000, f * (3 + vel * 9)), when + 0.02);
      filt.frequency.setTargetAtTime(f * 2.5, when + 0.02, 0.25);
      const sources = [];
      [-8, 8].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(filt);
        o.start(when);
        sources.push(o);
      });
      const sub = ctx.createOscillator();
      sub.type = 'square';
      sub.frequency.value = f / 2;
      const subG = ctx.createGain();
      subG.gain.value = 0.25;
      sub.connect(subG).connect(filt);
      sub.start(when);
      sources.push(sub);
      const out = ctx.createGain();
      const amp = 0.11 * (0.3 + 0.7 * vel);
      out.gain.setValueAtTime(0, when);
      out.gain.linearRampToValueAtTime(amp, when + 0.008);
      out.gain.setTargetAtTime(amp * 0.6, when + 0.01, 0.2);
      filt.connect(out);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.12);
    }

    _padVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = Math.min(9000, f * 6);
      const sources = [];
      [-12, -4, 5, 12].forEach((c) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = c;
        o.connect(filt);
        o.start(when);
        sources.push(o);
      });
      const out = ctx.createGain();
      const amp = 0.06 * (0.4 + 0.6 * vel);
      out.gain.setValueAtTime(0, when);
      out.gain.linearRampToValueAtTime(amp, when + 0.35);
      filt.connect(out);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.45);
    }

    _organVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi);
      const out = ctx.createGain();
      const sources = [];
      [
        [0.5, 0.5],
        [1, 1],
        [2, 0.6],
        [3, 0.45],
        [4, 0.3],
        [6, 0.15],
        [8, 0.12],
      ].forEach(([r, a]) => {
        if (f * r > 15000) return;
        const o = ctx.createOscillator();
        o.frequency.value = f * r;
        const g = ctx.createGain();
        g.gain.value = a;
        o.connect(g).connect(out);
        o.start(when);
        sources.push(o);
      });
      const amp = 0.05;
      out.gain.setValueAtTime(0, when);
      out.gain.linearRampToValueAtTime(amp, when + 0.012);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.05);
    }

    _musicBoxVoice(midi, vel, when) {
      const ctx = this.ctx;
      const f = freq(midi + 12);
      const out = ctx.createGain();
      const sources = [];
      [
        [1, 1, 1.2],
        [3.0, 0.25, 0.3],
        [5.4, 0.12, 0.12],
      ].forEach(([r, a, d]) => {
        const o = ctx.createOscillator();
        o.frequency.value = f * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(a, when + 0.002);
        g.gain.setTargetAtTime(0, when + 0.002, d);
        o.connect(g).connect(out);
        o.start(when);
        sources.push(o);
      });
      out.gain.value = 0.16 * (0.3 + 0.7 * vel);
      const v = { midi, start: when, sources };
      return this._finishVoice(v, out, 0.5);
    }

    // ------------------------------------------------------- API ao vivo
    noteOn(midi, vel = 0.8) {
      if (!this.ensure()) return;
      const prev = this.live.get(midi);
      if (prev) {
        prev.fastRelease = true;
        prev.stop();
      }
      const v = this._voice(midi, util.clamp(vel, 0.05, 1), this.ctx.currentTime);
      this.live.set(midi, v);
      this.held.add(midi);
    }

    noteOff(midi) {
      this.held.delete(midi);
      if (this.sustain) return;
      const v = this.live.get(midi);
      if (v) {
        v.stop();
        this.live.delete(midi);
      }
    }

    setSustain(on) {
      this.sustain = !!on;
      bus.emit('sustain', this.sustain);
      if (!on) {
        for (const [midi, v] of this.live) {
          if (!this.held.has(midi)) {
            v.stop();
            this.live.delete(midi);
          }
        }
      }
    }

    /** Agenda uma nota (usado no modo assistir/acompanhamento). */
    schedule(midi, vel, when, dur) {
      if (!this.ensure()) return null;
      const t = Math.max(when, this.ctx.currentTime);
      const v = this._voice(midi, util.clamp(vel, 0.05, 1), t);
      v.stop(t + Math.max(0.05, dur));
      v.stopped = false; // permite cancelamento antecipado (pausa)
      v._plannedEnd = t + Math.max(0.05, dur);
      this.scheduled.add(v);
      const clear = () => this.scheduled.delete(v);
      setTimeout(clear, (v._plannedEnd - this.ctx.currentTime) * 1000 + 1500);
      return v;
    }

    cancelScheduled() {
      const now = this.now;
      for (const v of this.scheduled) {
        if (v.start > now) {
          // ainda não começou: silencia já
          try {
            v.out.gain.cancelScheduledValues(0);
            v.out.gain.value = 0;
          } catch (e) {}
          for (const s of v.sources) {
            try {
              s.stop();
            } catch (e) {}
          }
        } else {
          v.stopped = false;
          v.fastRelease = true;
          v.stop(now);
        }
      }
      this.scheduled.clear();
    }

    allNotesOff() {
      this.cancelScheduled();
      for (const v of this.live.values()) v.stop();
      this.live.clear();
      this.held.clear();
    }

    /** Clique de metrônomo. */
    click(when, accent) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.frequency.value = accent ? 1760 : 1175;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(accent ? 0.25 : 0.15, when + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
      o.connect(g).connect(this.master);
      o.start(when);
      o.stop(when + 0.08);
    }
  }

  PN.INSTRUMENTS = INSTRUMENTS;
  PN.audio = new AudioEngine();
})();
