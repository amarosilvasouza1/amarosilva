/* Pianeon — mapeamento do teclado do computador → notas do piano */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus } = PN;

  const range = (prefix, chars) => [...chars].map((c) => prefix + c);
  const DIGITS = range('Digit', '1234567890');
  const ROW_Q = range('Key', 'QWERTYUIOP');
  const ROW_A = range('Key', 'ASDFGHJKL');
  const ROW_Z = range('Key', 'ZXCVBNM');

  /** Fileiras físicas do teclado para cada formato. off = recuo da fileira (em teclas). */
  const LAYOUTS = {
    abnt2: {
      name: 'ABNT2 (Brasil, com Ç)',
      rows: [
        { off: 0, keys: [...DIGITS, 'Minus', 'Equal'] },
        { off: 0.5, keys: [...ROW_Q, 'BracketLeft', 'BracketRight'] },
        { off: 0.75, keys: [...ROW_A, 'Semicolon', 'Quote', 'Backslash'] },
        { off: 0.25, keys: ['IntlBackslash', ...ROW_Z, 'Comma', 'Period', 'Slash', 'IntlRo'] },
      ],
    },
    ansi: {
      name: 'ANSI (EUA / internacional)',
      rows: [
        { off: 0, keys: [...DIGITS, 'Minus', 'Equal'] },
        { off: 0.5, keys: [...ROW_Q, 'BracketLeft', 'BracketRight', 'Backslash'] },
        { off: 0.75, keys: [...ROW_A, 'Semicolon', 'Quote'] },
        { off: 1.25, keys: [...ROW_Z, 'Comma', 'Period', 'Slash'] },
      ],
    },
    iso: {
      name: 'ISO (Europa / Portugal)',
      rows: [
        { off: 0, keys: [...DIGITS, 'Minus', 'Equal'] },
        { off: 0.5, keys: [...ROW_Q, 'BracketLeft', 'BracketRight'] },
        { off: 0.75, keys: [...ROW_A, 'Semicolon', 'Quote', 'Backslash'] },
        { off: 0.25, keys: ['IntlBackslash', ...ROW_Z, 'Comma', 'Period', 'Slash'] },
      ],
    },
  };

  const LABELS_US = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', IntlRo: '/', Space: 'ESPAÇO', Backquote: '`',
  };
  const LABELS_ABNT2 = { Backquote: "'", BracketLeft: '´', BracketRight: '[', Backslash: ']', Semicolon: 'Ç', Quote: '~', Slash: ';', IntlBackslash: '\\', IntlRo: '/' };
  const LABELS_ISO = { Backslash: '#', IntlBackslash: '\\' };
  const NUMPAD = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0'];

  const PRESETS = {
    full: {
      name: 'Teclado inteiro',
      desc: 'TODAS as teclas tocam. Cada fileira é uma oitava: começa em Dó na esquerda e vai até Si na direita. Fileira de baixo = grave, fileira dos números = agudo. Segure SHIFT para subir uma oitava.',
      shiftOctave: true,
      build(layout) {
        const m = {};
        const rows = LAYOUTS[layout].rows;
        rows.forEach((r, ri) => {
          const base = 36 + (rows.length - 1 - ri) * 12; // Z = Dó2, A = Dó3, Q = Dó4, números = Dó5
          r.keys.forEach((c, i) => (m[c] = base + i));
        });
        return m;
      },
    },
    tracker: {
      name: 'Estilo piano',
      desc: 'Duas fileiras por oitava, como em programas de música (FL Studio, Ableton). Z X C V… são as teclas brancas de baixo, S D G H J as pretas; Q W E R… é a oitava de cima. ~2,5 oitavas contínuas.',
      build() {
        const m = {};
        const n = 48; // Dó3
        const low = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash', 'IntlRo'];
        low.forEach((c, i) => (m[c] = n + i));
        const up = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight'];
        up.forEach((c, i) => (m[c] = n + 12 + i));
        m.IntlBackslash = n - 1;
        return m;
      },
    },
    vp: {
      name: 'Virtual Piano / Roblox',
      desc: 'Igual aos sites de "piano virtual": 1 2 3… Q W E… A S D… Z X C… são as teclas brancas (5 oitavas). Segure SHIFT para o sustenido (tecla preta). Funciona com partituras de letras.',
      shiftSharp: true,
      build() {
        const m = {};
        const codes = [...DIGITS, ...ROW_Q, ...ROW_A, ...ROW_Z];
        const steps = [0, 2, 4, 5, 7, 9, 11];
        codes.forEach((c, i) => (m[c] = 36 + Math.floor(i / 7) * 12 + steps[i % 7]));
        return m;
      },
    },
    garage: {
      name: 'Uma fileira',
      desc: 'Estilo "digitação musical": A S D F G H J K L são as brancas, W E T Y U O P as pretas. Z e X trocam a oitava. Ótimo para notebooks e teclados pequenos.',
      octaveKeys: { KeyZ: -1, KeyX: 1 },
      build() {
        const m = {};
        const keys = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
        keys.forEach((c, i) => (m[c] = 60 + i));
        return m;
      },
    },
    custom: {
      name: 'Personalizado',
      desc: 'Seu próprio mapa: escolha qualquer tecla para qualquer nota no editor.',
      build: () => ({}),
    },
  };

  const guessLayout = () => {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('pt-br')) return 'abnt2';
    if (lang.startsWith('pt') || lang.startsWith('en-gb') || lang.startsWith('de') || lang.startsWith('fr') || lang.startsWith('es') || lang.startsWith('it')) return 'iso';
    return 'ansi';
  };

  /** Desenho do teclado físico completo (larguras em "u" = 1 tecla). */
  function displayRows(layout) {
    const L = LAYOUTS[layout].rows;
    const k = (codes) => codes.map((c) => [c, 1]);
    const r0 = [['Backquote', 1], ...k(L[0].keys), ['Backspace', 2]];
    const bottom = [['ControlLeft', 1.75], ['AltLeft', 1.5], ['Space', 8], ['AltRight', 1.5], ['ControlRight', 2.25]];
    if (layout === 'ansi') {
      return [
        r0,
        [['Tab', 1.5], ...k(L[1].keys.slice(0, 12)), ['Backslash', 1.5]],
        [['CapsLock', 1.75], ...k(L[2].keys), ['Enter', 2.25]],
        [['ShiftLeft', 2.25], ...k(L[3].keys), ['ShiftRight', 2.75]],
        bottom,
      ];
    }
    const zKeys = L[3].keys;
    return [
      r0,
      [['Tab', 1.5], ...k(L[1].keys), ['Enter', 1.5]],
      [['CapsLock', 1.75], ...k(L[2].keys), ['Enter', 1.25, 'tail']],
      [['ShiftLeft', 1.25], ...k(zKeys), ['ShiftRight', 15 - 1.25 - zKeys.length]],
      bottom,
    ];
  }
  const ARROWS = [
    [null, ['ArrowUp', 1], null],
    [['ArrowLeft', 1], ['ArrowDown', 1], ['ArrowRight', 1]],
  ];

  const keymap = {
    PRESETS,
    LAYOUTS,
    preset: store.get('kb.v', 0) >= 2 ? store.get('kb.preset', 'full') : 'full',
    layout: store.get('kb.layout', guessLayout()),
    octave: store.get('kb.octave', 0),
    custom: store.get('kb.custom', null),
    DISPLAY: null, // definido abaixo
    numpadBass: store.get('kb.numpad', false),
    velocity: store.get('kb.velocity', 0.78),
    sustainKey: 'Space',
    layoutLabels: null, // vindo de navigator.keyboard.getLayoutMap()
    map: {},
    reverse: new Map(), // midi -> [{code, shift}]
    active: new Map(), // code -> midi
    capturing: null,
    enabled: true,

    init() {
      if (!PRESETS[this.preset]) this.preset = 'full';
      if (store.get('kb.v', 0) < 2) {
        this.octave = 0;
        store.set('kb.v', 2);
      }
      if (!LAYOUTS[this.layout]) this.layout = 'abnt2';
      this.rebuild();
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard
          .getLayoutMap()
          .then((lm) => {
            this.layoutLabels = lm;
            bus.emit('keymap');
          })
          .catch(() => {});
      }
      window.addEventListener('keydown', (e) => this._down(e));
      window.addEventListener('keyup', (e) => this._up(e));
      window.addEventListener('blur', () => this.releaseAll());
    },

    rebuild() {
      let base = this.preset === 'custom' ? Object.assign({}, this.custom || PRESETS.full.build(this.layout)) : PRESETS[this.preset].build(this.layout);
      if (this.numpadBass) NUMPAD.forEach((c, i) => (base[c] = [36, 38, 40, 41, 43, 45, 47, 48, 50, 35][i]));
      const shift = this.octave * 12;
      // nos mapas prontos, só usa teclas que existem no formato escolhido
      const onLayout = new Set(LAYOUTS[this.layout].rows.flatMap((r) => r.keys));
      this.map = {};
      for (const [code, midi] of Object.entries(base)) {
        if (this.preset !== 'custom' && !onLayout.has(code) && !NUMPAD.includes(code)) continue;
        const m = midi + shift;
        if (m >= 21 && m <= 108) this.map[code] = m;
      }
      this.reverse = new Map();
      const add = (midi, code, sh) => {
        if (!this.reverse.has(midi)) this.reverse.set(midi, []);
        this.reverse.get(midi).push({ code, shift: sh });
      };
      for (const [code, midi] of Object.entries(this.map)) add(midi, code, false);
      if (PRESETS[this.preset].shiftSharp) {
        for (const [code, midi] of Object.entries(this.map)) if (util.isBlack(midi + 1)) add(midi + 1, code, true);
      }
      if (PRESETS[this.preset].shiftOctave) {
        for (const [code, midi] of Object.entries(this.map)) if (midi + 12 <= 108 && !this.reverse.has(midi + 12)) add(midi + 12, code, true);
      }
      this._avail = new Set(this.reverse.keys());
      store.set('kb.preset', this.preset);
      store.set('kb.layout', this.layout);
      store.set('kb.octave', this.octave);
      store.set('kb.numpad', this.numpadBass);
      if (this.custom) store.set('kb.custom', this.custom);
      bus.emit('keymap');
    },

    setPreset(id) {
      if (!PRESETS[id]) return;
      if (id === 'custom' && !this.custom) this.custom = this.baseMap();
      store.set('kb.v', 2);
      this.preset = id;
      this.octave = 0;
      this.rebuild();
    },
    setLayout(id) {
      if (!LAYOUTS[id]) return;
      this.layout = id;
      this.rebuild();
    },
    shiftOctave(d) {
      this.octave = util.clamp(this.octave + d, -3, 3);
      this.rebuild();
      bus.emit('toast', 'Oitava ' + (this.octave > 0 ? '+' : '') + this.octave);
    },
    setVelocity(v) {
      this.velocity = util.clamp(v, 0.1, 1);
      store.set('kb.velocity', this.velocity);
    },
    /** Mapa sem a transposição de oitava (para editar). */
    baseMap() {
      const out = {};
      const shift = this.octave * 12;
      for (const [c, m] of Object.entries(this.map)) if (!NUMPAD.includes(c)) out[c] = m - shift;
      return out;
    },
    assign(code, midi) {
      if (this.preset !== 'custom') {
        this.custom = this.baseMap();
        this.preset = 'custom';
        this.octave = 0;
      }
      if (midi == null) delete this.custom[code];
      else this.custom[code] = midi;
      this.rebuild();
    },
    clearMidi(midi) {
      if (this.preset !== 'custom') {
        this.custom = this.baseMap();
        this.preset = 'custom';
        this.octave = 0;
      }
      for (const [c, m] of Object.entries(this.custom)) if (m === midi) delete this.custom[c];
      this.rebuild();
    },
    exportJson() {
      return JSON.stringify({ app: 'pianeon', version: 1, layout: this.layout, map: this.baseMap() }, null, 2);
    },
    importJson(txt) {
      const d = JSON.parse(txt);
      if (!d || typeof d.map !== 'object') throw new Error('Arquivo de mapa inválido');
      const clean = {};
      for (const [c, m] of Object.entries(d.map)) if (/^[A-Za-z0-9]+$/.test(c) && Number.isInteger(m) && m >= 21 && m <= 108) clean[c] = m;
      this.custom = clean;
      this.preset = 'custom';
      this.octave = 0;
      if (LAYOUTS[d.layout]) this.layout = d.layout;
      this.rebuild();
    },

    availableSet() {
      return this._avail || new Set();
    },
    resolve(code, shift) {
      const m = this.map[code];
      if (m == null) return null;
      if (shift && PRESETS[this.preset].shiftSharp && util.isBlack(m + 1)) return m + 1;
      if (shift && PRESETS[this.preset].shiftOctave && m + 12 <= 108) return m + 12;
      return m;
    },
    shiftMeaning() {
      const p = PRESETS[this.preset];
      return p.shiftSharp ? 'SUSTENIDO ♯' : p.shiftOctave ? 'OITAVA ↑' : '';
    },
    /** Rótulo visível da tecla, respeitando o layout real do usuário quando possível. */
    label(code) {
      if (this.layoutLabels && this.layoutLabels.get(code)) {
        const l = this.layoutLabels.get(code);
        return l === ' ' ? 'ESPAÇO' : l.toUpperCase();
      }
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit\d$/.test(code)) return code.slice(5);
      if (/^Numpad\d$/.test(code)) return 'N' + code.slice(6);
      const extra = this.layout === 'abnt2' ? LABELS_ABNT2 : this.layout === 'iso' ? LABELS_ISO : {};
      return extra[code] || LABELS_US[code] || code;
    },
    /** Texto curto da(s) tecla(s) que tocam uma nota: "Q", "⇧T"… */
    keyLabelFor(midi) {
      const best = this.bestCode(midi);
      return best ? (best.shift ? '⇧' : '') + this.label(best.code) : '';
    },
    /** Melhor tecla para mostrar: sem Shift, existente no layout, letra > número > símbolo. */
    bestCode(midi) {
      const list = this.reverse.get(midi);
      if (!list || !list.length) return null;
      const onLayout = new Set(LAYOUTS[this.layout].rows.flatMap((r) => r.keys));
      const score = (x) => (x.shift ? 100 : 0) + (onLayout.has(x.code) ? 0 : 50) + (/^Key/.test(x.code) ? 0 : /^Digit/.test(x.code) ? 1 : /^Numpad/.test(x.code) ? 3 : 2);
      return list.slice().sort((a, b) => score(a) - score(b))[0];
    },
    codesFor(midi) {
      return this.reverse.get(midi) || [];
    },

    /** Próxima tecla pressionada vai para o callback (editor de mapa). */
    capture(cb) {
      this.capturing = cb;
    },

    _isTyping(e) {
      const t = e.target;
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
    },
    _down(e) {
      if (this.capturing) {
        if (e.code === 'Escape') {
          this.capturing(null);
        } else {
          this.capturing(e.code);
        }
        this.capturing = null;
        e.preventDefault();
        return;
      }
      if (this._isTyping(e) || !this.enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let special = this._special(e);
      if (special === 'metronome' && this.map[e.code] != null) special = null;
      if (special) {
        e.preventDefault();
        if (!e.repeat) bus.emit('key:special', special, true);
        return;
      }
      const octKeys = PRESETS[this.preset].octaveKeys;
      if (octKeys && octKeys[e.code] != null) {
        e.preventDefault();
        if (!e.repeat) this.shiftOctave(octKeys[e.code]);
        return;
      }
      const midi = this.resolve(e.code, e.shiftKey);
      if (midi == null) return;
      e.preventDefault();
      if (e.repeat || this.active.has(e.code)) return;
      this.active.set(e.code, midi);
      bus.emit('key:on', midi, this.velocity, e.code);
    },
    _up(e) {
      if (e.code === this.sustainKey) {
        bus.emit('key:special', 'sustain', false);
        return;
      }
      const midi = this.active.get(e.code);
      if (midi == null) return;
      this.active.delete(e.code);
      bus.emit('key:off', midi, e.code);
    },
    _special(e) {
      switch (e.code) {
        case this.sustainKey:
          return 'sustain';
        case 'ArrowLeft':
          return 'octDown';
        case 'ArrowRight':
          return 'octUp';
        case 'ArrowUp':
          return 'speedUp';
        case 'ArrowDown':
          return 'speedDown';
        case 'Enter':
          return 'playPause';
        case 'Escape':
          return 'escape';
        case 'Backspace':
          return 'restart';
        case 'ShiftLeft':
        case 'ShiftRight':
          return null;
        case 'Tab':
          return 'mic';
        case 'Backquote':
          return 'metronome';
        default:
          return null;
      }
    },
    releaseAll() {
      for (const [code, midi] of this.active) bus.emit('key:off', midi, code);
      this.active.clear();
      bus.emit('key:special', 'sustain', false);
    },
  };

  keymap.displayRows = displayRows;
  keymap.ARROWS = ARROWS;
  PN.keymap = keymap;
})();
