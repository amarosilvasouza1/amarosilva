/* Pianeon — interface: liga teclado, áudio, jogo, visual e IA */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus, audio, keymap, player, visuals, songs, midi, ai, voice } = PN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = util.escapeHtml;

  const settings = Object.assign(
    {
      theme: null,
      names: /^pt/i.test(navigator.language || '') ? 'solfege' : 'letters',
      lookahead: 2.4,
      keyOnNotes: true,
      focus: false,
      // celular/tablet sem teclado: começa com o desenho do teclado recolhido
      kbCollapsed: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches && window.innerWidth < 920),
    },
    store.get('settings', {})
  );
  const saveSettings = () => store.set('settings', settings);

  // ------------------------------------------------------------------ utilidades de UI
  function noteName(m) {
    return settings.names === 'solfege' ? util.midiToNamePt(m) + (Math.floor(m / 12) - 1) : util.midiToName(m);
  }

  function toast(msg, kind, actions) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    for (const a of actions || []) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.onclick = () => {
        a.fn();
        el.remove();
      };
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), actions && actions.length ? 7000 : 3200);
  }
  bus.on('toast', toast);

  function applyTheme() {
    const th = settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = th;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = th === 'dark' ? '#0b0d12' : '#e4e6ea';
    bus.emit('theme', th);
  }

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function downloadSongMidi(song) {
    const bytes = midi.writeMidi(song.notes, { bpm: song.bpm || 120, title: song.title });
    download((song.title || 'pianeon').replace(/[\\/:*?"<>|]+/g, '_') + '.mid', new Blob([bytes], { type: 'audio/midi' }));
  }

  // ------------------------------------------------------------------ modais
  function anyModalOpen() {
    return !!document.querySelector('.modal.open');
  }
  function syncKeyboardEnabled() {
    keymap.enabled = !anyModalOpen() || $('#mKeys').classList.contains('open');
  }
  function openModal(id) {
    $('#' + id).classList.add('open');
    syncKeyboardEnabled();
  }
  function closeModal(id) {
    $('#' + id).classList.remove('open');
    if (id === 'mKeys') {
      keymap.capturing = null;
      selectedStrip = null;
    }
    syncKeyboardEnabled();
  }
  function closeAllModals() {
    $$('.modal.open').forEach((m) => closeModal(m.id));
  }
  $$('.modal').forEach((m) => {
    m.addEventListener('pointerdown', (e) => {
      if (e.target === m) closeModal(m.id);
    });
    $$('[data-close]', m).forEach((b) => (b.onclick = () => closeModal(m.id)));
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && anyModalOpen() && !keymap.capturing) {
        const open = $$('.modal.open');
        closeModal(open[open.length - 1].id);
        e.stopPropagation();
      }
    },
    true
  );

  // ------------------------------------------------------------------ teclado do computador desenhado
  const kbEl = $('#kb');
  const previewEl = $('#keycapsPreview');
  let midiEls = new Map(); // midi -> [el]
  let codeEls = new Map(); // code -> [el]
  const pressedCount = new Map();

  const FN_KEY = {
    Backquote: null, Backspace: '⌫', Tab: 'Tab', CapsLock: 'Caps', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt Gr', Space: 'Espaço', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  };
  function fnMeaning(code) {
    switch (code) {
      case 'Backquote': return 'metrô';
      case 'Backspace': return 'recomeçar';
      case 'Tab': return 'microfone';
      case 'Enter': return 'tocar';
      case 'ShiftLeft': case 'ShiftRight': return keymap.shiftMeaning().toLowerCase();
      case 'Space': return 'pedal';
      case 'ArrowLeft': return 'oit. −';
      case 'ArrowRight': return 'oit. +';
      case 'ArrowUp': return 'vel. +';
      case 'ArrowDown': return 'vel. −';
      default: return '';
    }
  }

  function makeKey(spec) {
    if (!spec) {
      const g = document.createElement('span');
      g.className = 'kc ghost';
      return g;
    }
    const [code, w, extra] = spec;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kc' + (extra === 'tail' ? ' tail' : '');
    b.dataset.code = code;
    b.style.setProperty('--w', w);
    b.innerHTML = '<span class="kc-note"></span><span class="kc-key"></span>';
    return b;
  }

  function buildKb(container) {
    container.innerHTML = '';
    const main = document.createElement('div');
    main.className = 'kb-main';
    for (const row of keymap.displayRows(keymap.layout)) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      row.forEach((k) => r.appendChild(makeKey(k)));
      main.appendChild(r);
    }
    const arrows = document.createElement('div');
    arrows.className = 'kb-arrows';
    for (const row of keymap.ARROWS) {
      const r = document.createElement('div');
      r.className = 'kb-row';
      row.forEach((k) => r.appendChild(makeKey(k)));
      arrows.appendChild(r);
    }
    container.appendChild(main);
    container.appendChild(arrows);
    labelKb(container);
    sizeKb(container);
  }

  function sizeKb(c) {
    const w = c.clientWidth || (c.parentElement && c.parentElement.clientWidth) || 900;
    const u = util.clamp((w - 8) / 19, 30, 62);
    c.style.setProperty('--u', u + 'px');
  }

  function labelKb(c) {
    const preset = keymap.PRESETS[keymap.preset];
    const mIndex = new Map();
    const cIndex = new Map();
    const add = (map, k, el) => {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(el);
    };
    for (const b of $$('.kc[data-code]', c)) {
      const code = b.dataset.code;
      add(cIndex, code, b);
      const noteEl = b.querySelector('.kc-note');
      const keyEl = b.querySelector('.kc-key');
      b.classList.remove('black', 'c-note', 'empty', 'fn', 'useful');
      delete b.dataset.midi;
      const m = keymap.map[code];
      if (m == null && (code in FN_KEY || b.style.getPropertyValue('--w') !== '1')) {
        // tecla de função
        b.classList.add('fn');
        const meaning = b.classList.contains('tail') ? '' : fnMeaning(code);
        noteEl.textContent = meaning;
        keyEl.textContent = FN_KEY[code] || keymap.label(code);
        if (meaning) b.classList.add('useful');
        if (code === 'Space') b.classList.toggle('sustain-on', audio.sustain);
        continue;
      }
      keyEl.textContent = keymap.label(code);
      if (preset.octaveKeys && preset.octaveKeys[code] != null) {
        noteEl.textContent = preset.octaveKeys[code] < 0 ? 'oit. −' : 'oit. +';
        b.classList.add('fn', 'useful');
        continue;
      }
      if (m == null) {
        noteEl.textContent = '';
        b.classList.add('empty');
        continue;
      }
      b.dataset.midi = m;
      noteEl.textContent = noteName(m);
      if (util.isBlack(m)) b.classList.add('black');
      if (m % 12 === 0) b.classList.add('c-note');
      add(mIndex, m, b);
      if (preset.shiftSharp && util.isBlack(m + 1)) add(mIndex, m + 1, b);
    }
    if (c === kbEl) {
      midiEls = mIndex;
      codeEls = cIndex;
    }
  }

  function markKey(midi, on) {
    const n = (pressedCount.get(midi) || 0) + (on ? 1 : -1);
    if (n <= 0) pressedCount.delete(midi);
    else pressedCount.set(midi, n);
    const els = (midiEls.get(midi) || []).concat($$('.kc[data-midi="' + midi + '"]', previewEl));
    for (const el of els) el.classList.toggle('on', n > 0);
    $$('.pk[data-midi="' + midi + '"]').forEach((el) => el.classList.toggle('on', n > 0));
  }

  let prevHint = new Set();
  let prevAuto = new Set();
  function updateKeyStates(hint, auto) {
    const diff = (prev, next, cls) => {
      for (const m of prev) if (!next.has(m)) for (const el of midiEls.get(m) || []) el.classList.remove(cls);
      for (const m of next) if (!prev.has(m)) for (const el of midiEls.get(m) || []) el.classList.add(cls);
    };
    diff(prevHint, hint, 'hint');
    diff(prevAuto, auto, 'auto');
    prevHint = hint;
    prevAuto = auto;
  }

  // qualquer tecla apertada "afunda" no desenho
  function pressVisual(code, down) {
    for (const el of codeEls.get(code) || []) el.classList.toggle('down', down);
    if ($('#mKeys').classList.contains('open')) $$('.kc[data-code="' + code + '"]', previewEl).forEach((el) => el.classList.toggle('down', down));
  }
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const tag = (t && t.tagName ? t.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey) return;
    pressVisual(e.code, true);
  });
  window.addEventListener('keyup', (e) => pressVisual(e.code, false));
  window.addEventListener('blur', () => $$('.kc.down').forEach((el) => el.classList.remove('down')));

  function bindKbPointer(container) {
    const active = new Map(); // pointerId -> midi | 'sustain'
    container.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.kc');
      if (!b) return;
      e.preventDefault();
      const code = b.dataset.code;
      if (b.dataset.midi) {
        const m = Number(b.dataset.midi);
        active.set(e.pointerId, m);
        noteOn(m, keymap.velocity);
      } else if (code === 'Space') {
        active.set(e.pointerId, 'sustain');
        bus.emit('key:special', 'sustain', true);
      } else {
        const map = { Enter: 'playPause', Backspace: 'restart', Tab: 'mic', Backquote: 'metronome', ArrowLeft: 'octDown', ArrowRight: 'octUp', ArrowUp: 'speedUp', ArrowDown: 'speedDown' };
        if (map[code]) bus.emit('key:special', map[code], true);
        const oct = keymap.PRESETS[keymap.preset].octaveKeys;
        if (oct && oct[code] != null) keymap.shiftOctave(oct[code]);
      }
      try {
        b.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    const end = (e) => {
      const v = active.get(e.pointerId);
      if (v == null) return;
      active.delete(e.pointerId);
      if (v === 'sustain') bus.emit('key:special', 'sustain', false);
      else noteOff(v);
    };
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
  }

  const PRESET_HINT = {
    full: 'Cada fileira é uma oitava. O Q é o Dó central e o Shift sobe uma oitava.',
    tracker: 'Z X C V B N M são as teclas brancas e S D G H J as pretas. A fileira do Q é a oitava de cima.',
    vp: 'Números e letras são as teclas brancas. Segure Shift para o sustenido.',
    garage: 'A S D F G H J K L são as brancas, W E T Y U O P as pretas. Z e X mudam a oitava.',
    custom: 'Mapa personalizado. Dá para mudar em Trocar mapa.',
  };

  // ------------------------------------------------------------------ notas
  const recentNotes = [];
  function noteOn(m, vel) {
    audio.noteOn(m, vel);
    const r = player.userOn(m, vel);
    if (!r) visuals.burst(m, 'note');
    recorder.on(m, vel);
    markKey(m, true);
    recentNotes.push({ m, t: performance.now() });
    if (recentNotes.length > 40) recentNotes.shift();
  }
  function noteOff(m) {
    audio.noteOff(m);
    player.userOff(m);
    recorder.off(m);
    markKey(m, false);
  }
  bus.on('key:on', (m, v) => noteOn(m, v));
  bus.on('key:off', (m) => noteOff(m));
  bus.on('midi:on', (m, v) => noteOn(m, v));
  bus.on('midi:off', (m) => noteOff(m));
  bus.on('midi:sustain', (on) => bus.emit('key:special', 'sustain', on));
  bus.on('player:judge', (kind, midi) => visuals.burst(midi, kind));

  bus.on('key:special', (name, down) => {
    switch (name) {
      case 'sustain':
        audio.setSustain(down);
        $('#sustainInd').classList.toggle('on', down);
        $$('.kc[data-code="Space"]').forEach((el) => el.classList.toggle('sustain-on', down));
        break;
      case 'metronome':
        if (down) {
          setMetronome(!player.metronome);
          toast('Metrônomo ' + (player.metronome ? 'ligado' : 'desligado') + '.');
        }
        break;
      case 'octDown':
        keymap.shiftOctave(-1);
        break;
      case 'octUp':
        keymap.shiftOctave(1);
        break;
      case 'speedUp':
        setSpeed(player.speed + 0.1);
        break;
      case 'speedDown':
        setSpeed(player.speed - 0.1);
        break;
      case 'playPause':
        if (player.song) player.toggle();
        else openLibrary();
        break;
      case 'escape':
        if ($('#chat').classList.contains('open')) closeChat();
        else if (player.song) player.pause();
        break;
      case 'restart':
        player.restart(false);
        break;
      case 'mic':
        toggleMic();
        break;
    }
  });

  // ------------------------------------------------------------------ gravação
  const recorder = {
    active: false,
    t0: 0,
    notes: [],
    open: new Map(),
    now() {
      return performance.now() / 1000 - this.t0;
    },
    toggle() {
      if (this.active) this.stop();
      else this.start();
    },
    start() {
      audio.ensure();
      this.active = true;
      this.t0 = performance.now() / 1000;
      this.notes = [];
      this.open.clear();
      $('#btnRecord').classList.add('on');
      $('#btnRecord').querySelector('span').textContent = 'Parar';
      $('#recInd').classList.remove('hidden');
      toast('Gravando. Aperte Parar quando terminar.');
    },
    stop() {
      this.active = false;
      for (const m of [...this.open.keys()]) this.off(m);
      $('#btnRecord').classList.remove('on');
      $('#btnRecord').querySelector('span').textContent = 'Gravar';
      $('#recInd').classList.add('hidden');
      if (!this.notes.length) {
        toast('Nada gravado.');
        return;
      }
      const t0 = Math.min(...this.notes.map((n) => n.time));
      const notes = this.notes.map((n) => Object.assign({}, n, { time: n.time - t0, hand: n.midi >= 60 ? 'R' : 'L' })).sort((a, b) => a.time - b.time);
      const title = 'Gravação ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const song = songs.finalizeSong({ id: 'u-' + util.uid(), title, composer: 'Você', difficulty: 2, bpm: 120, timeSig: 4, source: 'rec', tags: ['gravação'], notes });
      songs.library.add(song);
      toast('"' + title + '" salva na biblioteca.', null, [
        { label: 'Ouvir', fn: () => loadSong(song, 'watch') },
        { label: 'Baixar .mid', fn: () => downloadSongMidi(song) },
      ]);
    },
    on(m, vel) {
      if (!this.active) return;
      if (this.open.has(m)) this.off(m);
      this.open.set(m, { midi: m, time: this.now(), velocity: vel });
    },
    off(m) {
      const n = this.open.get(m);
      if (!n) return;
      this.open.delete(m);
      n.duration = Math.max(0.05, this.now() - n.time);
      this.notes.push(n);
    },
  };

  // ------------------------------------------------------------------ cabeçalho e transporte
  function loadSong(song, mode, opts) {
    if (!song) return;
    audio.ensure();
    closeAllModals();
    player.load(song, mode || 'practice', opts);
  }

  function setSpeed(s) {
    player.setSpeed(s);
  }
  bus.on('player:speed', (s) => {
    $('#speed').value = Math.round(s * 100);
    $('#speedVal').textContent = Math.round(s * 100) + '%';
  });

  function updateHeader() {
    const s = player.song;
    $('#songTitle').textContent = s ? s.title : 'Modo livre';
    $('#songMeta').textContent = s
      ? [s.composer, PN.MODES[player.mode].name, util.formatTime(s.duration)].filter(Boolean).join(' · ')
      : 'toque à vontade · escolha uma música na lista para aprender';
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === player.mode));
    updatePlayBtn();
    updateReady();
    renderSidebar();
  }
  function updatePlayBtn() {
    const playing = player.state === 'playing' || player.state === 'waiting';
    $('#btnPlay').innerHTML = '<svg class="i"><use href="#i-' + (playing ? 'pause' : 'play') + '"/></svg>';
    updateReady();
  }

  // cartão "COMEÇAR"
  function updateReady() {
    const s = player.song;
    const show = !!s && player.state === 'ready';
    $('#readyCard').classList.toggle('hidden', !show);
    if (!show) return;
    $('#rcMode').textContent = PN.MODES[player.mode].name;
    $('#rcTitle').textContent = s.title;
    $('#rcSub').textContent = [s.composer, util.formatTime(s.duration), ['muito fácil', 'fácil', 'médio', 'difícil', 'muito difícil'][s.difficulty - 1]].filter(Boolean).join(', ');
    $('#rcExplain').textContent = PN.MODES[player.mode].explain;
    $$('#rcModes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === player.mode));
    const hk = player.hands.R && player.hands.L ? 'LR' : player.hands.R ? 'R' : 'L';
    $$('#rcHands button').forEach((b) => b.classList.toggle('on', b.dataset.hand === hk));
    const noHands = player.mode === 'watch' || !s.hands.L || !s.hands.R;
    $('#rcHands').classList.toggle('hidden', noHands);
    $('#rcHandsLabel').classList.toggle('hidden', noHands);
    $('#rcSpeed').textContent = Math.round(player.speed * 100) + '%';
  }
  $$('#rcModes button').forEach((b) => (b.onclick = () => player.song && loadSong(player.song, b.dataset.mode)));
  $$('#rcHands button').forEach(
    (b) =>
      (b.onclick = () => {
        player.setHands(b.dataset.hand);
        updateReady();
      })
  );
  $('#rcSlower').onclick = () => setSpeed(player.speed - 0.1);
  $('#rcFaster').onclick = () => setSpeed(player.speed + 0.1);
  $('#rcStart').onclick = () => {
    audio.ensure();
    player.play();
  };
  bus.on('player:speed', updateReady);

  bus.on('player:load', () => {
    updateHeader();
    closeModal('mResults');
  });
  bus.on('player:state', updatePlayBtn);
  bus.on('player:finish', (res) => {
    if (res.mode === 'watch') {
      toast('Acabou. Quer tentar tocar?', null, [
        { label: 'Aprender', fn: () => loadSong(res.song, 'practice') },
        { label: 'Jogar', fn: () => loadSong(res.song, 'challenge') },
      ]);
      return;
    }
    setTimeout(() => showResults(res), 500);
  });

  $('#btnPlay').onclick = () => {
    audio.ensure();
    if (player.song) player.toggle();
    else openLibrary();
  };
  $('#btnRestart').onclick = () => player.restart(false);
  $$('#modeSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        const mode = b.dataset.mode;
        if (mode === 'free') return player.load(null);
        if (!player.song) {
          toast('Escolha uma música na lista ao lado.');
          if (window.innerWidth <= 920) openLibrary('all');
          sbFilterPending = mode;
          return;
        }
        loadSong(player.song, mode);
      })
  );
  $('#speed').oninput = (e) => setSpeed(Number(e.target.value) / 100);
  $('#btnRecord').onclick = () => recorder.toggle();
  $('#btnSongs').onclick = () => openLibrary('all');
  $('#btnKeys').onclick = () => openKeys();
  $('#btnSettings').onclick = () => openSettings('sound');
  $('#btnAI').onclick = () => toggleChat();
  $('#btnTheme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    settings.theme = cur === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  };
  $('#btnFocus').onclick = () => setFocus(!settings.focus);
  function setFocus(on) {
    settings.focus = on;
    saveSettings();
    document.body.classList.toggle('focus', on);
    $('#setFocus').checked = on;
    $('#btnFocus').innerHTML = '<svg class="i"><use href="#i-panel-right-' + (on ? 'open' : 'close') + '"/></svg>';
  }
  $('#btnFull').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  };
  $('#metroInd').onclick = () => setMetronome(!player.metronome);
  function setMetronome(on) {
    player.metronome = on;
    store.set('metronome', on);
    $('#metroInd').classList.toggle('on', on);
    $('#setMetro').checked = on;
  }

  // progresso / mapa: clique para pular
  function seekFromEvent(e, el) {
    if (!player.song) return;
    if (player.mode === 'challenge') {
      toast('No desafio não dá para pular — use ⟲ para recomeçar.');
      return;
    }
    const r = el.getBoundingClientRect();
    const ratio = util.clamp((e.clientX - r.left) / r.width, 0, 1);
    player.seek(ratio * player.song.duration);
  }
  $('#progress').addEventListener('pointerdown', (e) => seekFromEvent(e, e.currentTarget));

  // tocar clicando no piano desenhado
  (function () {
    const cv = $('#cvPiano');
    const active = new Map();
    cv.addEventListener('pointerdown', (e) => {
      const p = visuals.panels.piano;
      if (!p || !p.geo) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let m = null;
      for (const bk of p.geo.blacks) if (x >= bk.x && x <= bk.x + bk.w && y <= bk.h) m = bk.m;
      if (m == null) m = p.geo.whites[Math.floor(x / p.geo.ww)];
      if (m == null) return;
      active.set(e.pointerId, m);
      noteOn(m, keymap.velocity);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    const end = (e) => {
      const m = active.get(e.pointerId);
      if (m == null) return;
      active.delete(e.pointerId);
      noteOff(m);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  })();

  // tocar clicando/tocando nas faixas da pista
  (function () {
    const cv = $('#cvHighway');
    const active = new Map();
    cv.addEventListener('pointerdown', (e) => {
      const p = visuals.panels.highway;
      if (!p || !p.geo) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const g = p.geo;
      if (y < g.hitY - 140) return;
      const i = Math.floor((x - g.left) / g.laneW);
      if (i < 0 || i >= g.n) return;
      const m = g.lanes[i];
      active.set(e.pointerId, m);
      noteOn(m, keymap.velocity);
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    const end = (e) => {
      const m = active.get(e.pointerId);
      if (m == null) return;
      active.delete(e.pointerId);
      noteOff(m);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  })();

  // ------------------------------------------------------------------ lista de músicas (lateral)
  const SOURCE_BADGE = { midi: 'midi', ai: 'ia', sheet: 'letras', rec: 'gravação', notation: 'notação' };
  let sbFilter = 'all';
  let sbFilterPending = null;
  // miniatura: um pedacinho do piano roll da própria música
  const thumbCache = new Map();
  function thumbFor(s) {
    const key = s.id + ':' + s.notes.length;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const W = 54;
    const H = 34;
    const span = Math.min(s.duration, 12) || 1;
    const [lo, hi] = s.range;
    const rows = Math.max(12, hi - lo + 1);
    let rects = '';
    for (const n of s.notes) {
      if (n.time > span) break;
      const x = (n.time / span) * W;
      const w = Math.max(1, (Math.min(n.duration, span - n.time) / span) * W - 0.5);
      const y = H - 3 - ((n.midi - lo) / rows) * (H - 6);
      rects += '<rect x="' + x.toFixed(1) + '" y="' + (y - 1).toFixed(1) + '" width="' + w.toFixed(1) + '" height="2" fill="' + (n.hand === 'L' ? '#6f97ff' : '#2cc4cf') + '"/>';
    }
    const html = '<span class="thumb"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + rects + '</svg></span>';
    thumbCache.set(key, html);
    return html;
  }
  const level = (d) => '<span class="level" title="dificuldade ' + d + ' de 5">' + [1, 2, 3, 4, 5].map((k) => '<i class="' + (k <= d ? 'on' : '') + '" style="height:' + (3 + k * 1.6) + 'px"></i>').join('') + '</span>';
  function renderSidebar() {
    const el = $('#songList');
    if (!el) return;
    const q = $('#sbSearch').value.trim().toLowerCase();
    let list = songs.library.all();
    if (sbFilter === 'mine') list = list.filter((s) => s.source !== 'builtin');
    else if (sbFilter !== 'all') list = list.filter((s) => s.cat === sbFilter);
    if (q) list = list.filter((s) => (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
    if (!list.length) {
      el.innerHTML = '<div class="lib-empty">' + (sbFilter === 'mine' ? 'Nada aqui ainda. Importe um MIDI ou grave algo.' : 'Nenhuma música encontrada.') + '</div>';
      return;
    }
    const cur = player.song && player.song.id;
    el.innerHTML = list
      .map((s) => {
        const best = PN.Player.best(s.id);
        const b = best.challenge || best.practice;
        const badge = SOURCE_BADGE[s.source] ? '<span class="badge' + (s.source === 'ai' ? ' ai' : '') + '">' + SOURCE_BADGE[s.source] + '</span>' : '';
        return (
          '<button class="song' + (s.id === cur ? ' on' : '') + '" data-id="' + esc(s.id) + '">' + thumbFor(s) +
          '<span style="min-width:0"><div class="t">' + esc(s.title) + badge + '</div><div class="s">' + esc(s.composer || '—') + '</div>' +
          '<div class="m">' + level(s.difficulty) + '<span>' + util.formatTime(s.duration) + '</span>' +
          (b ? '<span class="best">' + '★'.repeat(b.stars) + '</span>' : '') + '</div></span></button>'
        );
      })
      .join('');
  }
  $('#songList').addEventListener('click', (e) => {
    const b = e.target.closest('.song');
    if (!b) return;
    const song = songs.library.get(b.dataset.id);
    const mode = sbFilterPending || (player.song && player.mode !== 'free' ? player.mode : 'practice');
    sbFilterPending = null;
    loadSong(song, mode);
  });
  $$('#sbChips button').forEach(
    (b) =>
      (b.onclick = () => {
        sbFilter = b.dataset.f;
        $$('#sbChips button').forEach((x) => x.classList.toggle('on', x === b));
        renderSidebar();
      })
  );
  $('#sbSearch').oninput = util.debounce(renderSidebar, 100);
  $('#sbImport').onclick = () => openLibrary('import');
  $('#sbAskAi').onclick = () => {
    openChat();
    $('#chatText').value = 'Coloca uma música fácil pra eu aprender: ';
    setTimeout(() => {
      $('#chatText').focus();
      autoGrow();
    }, 60);
  };
  bus.on('library', renderSidebar);

  // ------------------------------------------------------------------ biblioteca
  let libTab = 'all';
  function openLibrary(tab) {
    if (tab) setLibTab(tab);
    renderLibrary();
    openModal('mLibrary');
  }
  function setLibTab(tab) {
    libTab = tab;
    $$('#libTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#libImport').classList.toggle('hidden', tab !== 'import');
    $('#libList').classList.toggle('hidden', tab === 'import');
    $('#libSearch').classList.toggle('hidden', tab === 'import');
  }
  $$('#libTabs button').forEach(
    (b) =>
      (b.onclick = () => {
        setLibTab(b.dataset.tab);
        renderLibrary();
      })
  );
  $('#libSearch').oninput = util.debounce(renderLibrary, 120);

  function renderLibrary() {
    const q = $('#libSearch').value.trim().toLowerCase();
    let list = songs.library.all();
    if (libTab === 'builtin') list = list.filter((s) => s.source === 'builtin');
    if (libTab === 'mine') list = list.filter((s) => s.source !== 'builtin');
    if (q) list = list.filter((s) => (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
    const el = $('#libList');
    if (!list.length) {
      el.innerHTML = '<div class="lib-empty">' + (libTab === 'mine' ? 'Nenhuma música sua ainda. Importe um MIDI, cole uma partitura de letras ou grave algo.' : 'Nada encontrado.') + '</div>';
      return;
    }
    el.innerHTML = list
      .map((s) => {
        const best = PN.Player.best(s.id);
        const b = best.challenge || best.practice;
        const bestTxt = b ? '★'.repeat(b.stars) + '<span style="opacity:.3">' + '★'.repeat(5 - b.stars) + '</span>' + (best.challenge ? ' <b>' + best.challenge.score + '</b>' : '') : '—';
        const badge = SOURCE_BADGE[s.source] ? '<span class="badge' + (s.source === 'ai' ? ' ai' : '') + '">' + SOURCE_BADGE[s.source] + '</span>' : '';
        const mine = s.source !== 'builtin';
        return (
          '<div class="lib-row" data-id="' + esc(s.id) + '">' +
          thumbFor(s) +
          '<div style="min-width:0"><div class="lib-title">' + esc(s.title) + badge + '</div><div class="lib-sub">' + esc(s.composer || '') + (s.composer ? ' · ' : '') + s.notes.length + ' notas</div></div>' +
          '<span class="lib-dur">' + util.formatTime(s.duration) + '</span>' +
          '<span class="lib-best">' + bestTxt + '</span>' +
          '<div class="lib-actions"><button class="tb" data-act="watch">Ouvir</button><button class="tb" data-act="practice">Aprender</button><button class="tb" data-act="challenge">Jogar</button>' +
          (mine ? '<button class="tb" data-act="dl" title="Baixar .mid"><svg class="i"><use href="#i-download"/></svg></button><button class="tb" data-act="del" title="Apagar"><svg class="i"><use href="#i-trash-2"/></svg></button>' : '') +
          '</div></div>'
        );
      })
      .join('');
  }
  $('#libList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.lib-row').dataset.id;
    const song = songs.library.get(id);
    if (!song) return;
    const act = btn.dataset.act;
    if (act === 'dl') downloadSongMidi(song);
    else if (act === 'del') {
      if (confirm('Apagar "' + song.title + '"?')) {
        songs.library.remove(id);
        if (player.song && player.song.id === id) player.load(null);
        renderLibrary();
      }
    } else loadSong(song, act);
  });
  bus.on('library', () => {
    if ($('#mLibrary').classList.contains('open')) renderLibrary();
  });

  // importação
  async function importFiles(files) {
    let last = null;
    for (const f of files) {
      if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name) || /^audio\/(?!midi|x-midi)/.test(f.type)) {
        toast('"' + f.name + '" é um arquivo de áudio. Aqui só entra MIDI (.mid).', 'warn');
        continue;
      }
      try {
        const parsed = midi.parseMidi(await f.arrayBuffer());
        if (!parsed.notes.length) throw new Error('nenhuma nota encontrada');
        const song = songs.songFromMidi(parsed, f.name);
        songs.library.add(song);
        last = song;
      } catch (e) {
        toast('Não consegui ler "' + f.name + '": ' + e.message, 'err');
      }
    }
    if (last) {
      toast('"' + last.title + '" adicionada (' + last.notes.length + ' notas).', null, [
        { label: 'Ouvir', fn: () => loadSong(last, 'watch') },
        { label: 'Aprender', fn: () => loadSong(last, 'practice') },
      ]);
      if ($('#mLibrary').classList.contains('open')) {
        setLibTab('mine');
        renderLibrary();
      }
    }
    return last;
  }
  $('#fileInput').onchange = (e) => {
    importFiles([...e.target.files]);
    e.target.value = '';
  };
  const dz = $('#dropZone');
  dz.addEventListener('click', (e) => {
    if (e.target === dz || e.target.classList.contains('drop-icon')) $('#fileInput').click();
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    $('#dragOverlay').classList.remove('hidden');
    dz.classList.add('over');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      $('#dragOverlay').classList.add('hidden');
      dz.classList.remove('over');
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dragOverlay').classList.add('hidden');
    dz.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]);
  });

  $('#vpAdd').onclick = () => {
    const txt = $('#vpText').value.trim();
    if (!txt) return toast('Cole a partitura de letras primeiro.');
    const song = songs.parseVPSheet(txt, { bpm: Number($('#vpBpm').value) || 100, title: $('#vpTitle').value.trim() || 'Partitura de letras' });
    if (!song.notes.length) return toast('Não encontrei notas nessa partitura.', 'warn');
    songs.library.add(song);
    toast('"' + song.title + '" adicionada.', null, [{ label: 'Aprender', fn: () => loadSong(song, 'practice') }]);
    $('#vpText').value = '';
  };
  $('#ntAdd').onclick = () => {
    const song = songs.makeSong({ title: $('#ntTitle').value.trim() || 'Minha música', bpm: Number($('#ntBpm').value) || 100, right: $('#ntRight').value, left: $('#ntLeft').value, source: 'notation', tags: ['notação'] });
    if (song.errors && song.errors.length) toast(song.errors.slice(0, 2).join(' · '), 'warn');
    if (!song.notes.length) return;
    songs.library.add(song);
    toast('"' + song.title + '" adicionada.', null, [{ label: 'Aprender', fn: () => loadSong(song, 'practice') }]);
  };

  async function downloadMidiUrl(url, title) {
    if (!/^https?:\/\//i.test(url)) throw new Error('A URL precisa começar com http:// ou https://');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      throw new Error('o site bloqueou o download pelo navegador (CORS) ou está fora do ar');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('o servidor respondeu ' + res.status);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 5 * 1024 * 1024) throw new Error('arquivo grande demais');
    const parsed = midi.parseMidi(buf);
    if (!parsed.notes.length) throw new Error('o arquivo não tem notas');
    const name = title || decodeURIComponent(url.split('/').pop().split('?')[0]);
    const song = songs.songFromMidi(parsed, name);
    songs.library.add(song);
    return song;
  }
  $('#urlAdd').onclick = async () => {
    const url = $('#urlInput').value.trim();
    try {
      const song = await downloadMidiUrl(url);
      toast('"' + song.title + '" baixada.', null, [{ label: 'Aprender', fn: () => loadSong(song, 'practice') }]);
      $('#urlInput').value = '';
    } catch (e) {
      toast('Não deu para baixar: ' + e.message, 'err');
    }
  };

  // ------------------------------------------------------------------ editor de teclado
  let selectedStrip = null;
  function openKeys() {
    renderKeysModal();
    openModal('mKeys');
  }
  function renderKeysModal() {
    $('#presetGrid').innerHTML = Object.entries(keymap.PRESETS)
      .map(([id, p]) => '<button class="preset' + (keymap.preset === id ? ' on' : '') + '" data-preset="' + id + '"><b>' + esc(p.name.toUpperCase()) + '</b><span>' + esc(p.desc) + '</span></button>')
      .join('');
    $('#kbLayout').innerHTML = Object.entries(keymap.LAYOUTS)
      .map(([id, l]) => '<option value="' + id + '"' + (keymap.layout === id ? ' selected' : '') + '>' + esc(l.name) + '</option>')
      .join('');
    $('#octVal').textContent = (keymap.octave > 0 ? '+' : '') + keymap.octave;
    $('#kbVel').value = Math.round(keymap.velocity * 100);
    $('#kbVelVal').textContent = Math.round(keymap.velocity * 100) + '%';
    $('#kbNumpad').checked = keymap.numpadBass;
    buildKb(previewEl);
    renderStrip();
  }
  $('#presetGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b) keymap.setPreset(b.dataset.preset);
  });
  $('#kbLayout').onchange = (e) => keymap.setLayout(e.target.value);
  $('#octMinus').onclick = () => keymap.shiftOctave(-1);
  $('#octPlus').onclick = () => keymap.shiftOctave(1);
  $('#kbVel').oninput = (e) => {
    keymap.setVelocity(Number(e.target.value) / 100);
    $('#kbVelVal').textContent = e.target.value + '%';
  };
  $('#kbNumpad').onchange = (e) => {
    keymap.numpadBass = e.target.checked;
    keymap.rebuild();
  };
  $('#kbExport').onclick = () => download('pianeon-teclado.json', keymap.exportJson(), 'application/json');
  $('#kbImport').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      keymap.importJson(await f.text());
      toast('Mapa importado!');
    } catch (err) {
      toast('Arquivo inválido: ' + err.message, 'err');
    }
  };
  $('#kbReset').onclick = () => {
    keymap.setPreset('full');
    toast('Voltou para o mapa padrão.');
  };
  bindKbPointer(previewEl);
  $('#kbChange').onclick = () => openKeys();
  $('#kbToggle').onclick = () => {
    settings.kbCollapsed = !settings.kbCollapsed;
    saveSettings();
    $('#keysArea').classList.toggle('collapsed', settings.kbCollapsed);
    $('#kbToggle').textContent = settings.kbCollapsed ? 'Mostrar' : 'Ocultar';
    if (!settings.kbCollapsed) sizeKb(kbEl);
  };

  function renderStrip() {
    const lo = 36;
    const hi = 96;
    const whiteW = 30;
    const inner = document.createElement('div');
    inner.className = 'piano-inner';
    let wx = 0;
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!util.isBlack(m)) whites.push(m);
    inner.style.width = whites.length * whiteW + 'px';
    for (let m = lo; m <= hi; m++) {
      const k = document.createElement('div');
      const black = util.isBlack(m);
      k.className = 'pk ' + (black ? 'b' : 'w') + (selectedStrip === m ? ' sel' : '');
      k.dataset.midi = m;
      const labels = keymap
        .codesFor(m)
        .map((x) => (x.shift ? '⇧' : '') + keymap.label(x.code))
        .slice(0, 2)
        .join(' ');
      k.innerHTML = '<span class="lbl">' + esc(labels) + '</span><span class="nm">' + esc(m % 12 === 0 || black ? noteName(m) : noteName(m).replace(/\d+$/, '')) + '</span>';
      if (black) {
        k.style.left = wx - whiteW * 0.3 + 'px';
        k.style.width = whiteW * 0.6 + 'px';
      } else {
        k.style.left = wx + 'px';
        k.style.width = whiteW + 'px';
        wx += whiteW;
      }
      inner.appendChild(k);
    }
    const strip = $('#pianoStrip');
    const sl = strip.scrollLeft;
    strip.innerHTML = '';
    strip.appendChild(inner);
    strip.scrollLeft = sl || (whites.indexOf(48) * whiteW || 0);
  }
  const RESERVED = new Set(['Space', 'Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']);
  $('#pianoStrip').addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.pk');
    if (!k) return;
    const m = Number(k.dataset.midi);
    audio.noteOn(m, 0.7);
    setTimeout(() => audio.noteOff(m), 250);
    selectedStrip = m;
    renderStrip();
    $('#assignStatus').textContent = 'Aperte a tecla do computador para ' + noteName(m) + '… (Delete remove, Esc cancela)';
    keymap.capture((code) => {
      selectedStrip = null;
      if (!code) $('#assignStatus').textContent = 'Cancelado.';
      else if (code === 'Delete' || code === 'Backspace') {
        keymap.clearMidi(m);
        $('#assignStatus').textContent = noteName(m) + ' ficou sem tecla.';
      } else if (RESERVED.has(code)) {
        $('#assignStatus').textContent = 'Essa tecla é reservada para comandos. Escolha outra.';
      } else {
        keymap.assign(code, m);
        $('#assignStatus').textContent = keymap.label(code) + ' → ' + noteName(m) + ' ✓';
      }
      renderStrip();
    });
  });

  bus.on('keymap', () => {
    if (kbEl._layout !== keymap.layout) {
      buildKb(kbEl);
      kbEl._layout = keymap.layout;
    } else labelKb(kbEl);
    prevHint = new Set();
    prevAuto = new Set();
    $('#presetName').textContent = keymap.PRESETS[keymap.preset].name + ', ' + keymap.LAYOUTS[keymap.layout].name.split(' (')[0];
    $('#keysHint').textContent = PRESET_HINT[keymap.preset] || '';
    $('#octInd').textContent = 'oitava ' + (keymap.octave > 0 ? '+' : '') + keymap.octave;
    player.refold();
    if ($('#mKeys').classList.contains('open')) renderKeysModal();
  });

  // ------------------------------------------------------------------ ajustes
  function openSettings(tab) {
    fillSettings();
    setSetTab(tab || 'sound');
    openModal('mSettings');
  }
  function setSetTab(tab) {
    $$('#setTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('.set-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
  }
  $$('#setTabs button').forEach((b) => (b.onclick = () => setSetTab(b.dataset.tab)));

  function fillSettings() {
    $('#setInstrument').innerHTML = PN.INSTRUMENTS.map((i) => '<option value="' + i.id + '"' + (audio.instrument === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('');
    $('#setVolume').value = Math.round(audio.volume * 100);
    $('#setReverb').value = Math.round(audio.reverbAmount * 100);
    $('#setMetro').checked = player.metronome;
    $('#setFreeBpm').value = player.freeBpm;
    $('#setTheme').value = document.documentElement.dataset.theme;
    $('#setNames').value = settings.names;
    $('#setLookahead').value = Math.round(settings.lookahead * 10);
    $('#setKeyOnNotes').checked = settings.keyOnNotes;
    $('#setFold').checked = player.fold;
    $('#setLeadIn').value = player.leadIn;
    $('#setFocus').checked = settings.focus;
    $('#midiStatus').textContent = midi.input.enabled ? (midi.input.devices.length ? midi.input.devices.join(', ') : 'nenhum teclado MIDI conectado') : navigator.requestMIDIAccess ? 'desconectado' : 'não suportado neste navegador';
    fillAi();
  }
  $('#setInstrument').onchange = (e) => {
    audio.ensure();
    audio.setInstrument(e.target.value);
  };
  $('#setVolume').oninput = (e) => {
    audio.ensure();
    audio.setVolume(e.target.value / 100);
  };
  $('#setReverb').oninput = (e) => {
    audio.ensure();
    audio.setReverb(e.target.value / 100);
  };
  $('#setMetro').onchange = (e) => setMetronome(e.target.checked);
  $('#setFreeBpm').onchange = (e) => {
    player.freeBpm = util.clamp(Number(e.target.value) || 100, 30, 240);
    store.set('freeBpm', player.freeBpm);
  };
  $('#setTheme').onchange = (e) => {
    settings.theme = e.target.value;
    saveSettings();
    applyTheme();
  };
  $('#setNames').onchange = (e) => {
    settings.names = e.target.value;
    saveSettings();
    bus.emit('keymap');
  };
  $('#setLookahead').oninput = (e) => {
    settings.lookahead = Number(e.target.value) / 10;
    saveSettings();
  };
  $('#setKeyOnNotes').onchange = (e) => {
    settings.keyOnNotes = e.target.checked;
    saveSettings();
  };
  $('#setFold').onchange = (e) => player.setFold(e.target.checked);
  $('#setLeadIn').onchange = (e) => {
    player.leadIn = util.clamp(Number(e.target.value) || 2.6, 1, 8);
    store.set('leadIn', player.leadIn);
  };
  $('#setFocus').onchange = (e) => setFocus(e.target.checked);
  $('#resetScores').onclick = () => {
    if (confirm('Apagar todos os recordes?')) {
      store.remove('best');
      toast('Recordes apagados.');
    }
  };
  $('#midiConnect').onclick = async () => {
    const ok = await midi.input.init();
    toast(ok ? 'Teclado MIDI pronto.' : 'Não deu para acessar o MIDI (permissão negada ou navegador sem suporte).', ok ? null : 'warn');
    fillSettings();
  };

  // IA
  function fillAi() {
    const cfg = ai.cfg;
    $('#aiProvider').innerHTML = Object.entries(ai.PROVIDERS)
      .map(([id, p]) => '<option value="' + id + '"' + (cfg.provider === id ? ' selected' : '') + '>' + esc(p.name) + '</option>')
      .join('');
    const pr = ai.prov();
    const pc = ai.pcfg();
    $('#aiKey').value = pc.key;
    $('#aiKey').placeholder = pr.needsKey ? 'cole sua chave aqui' : 'opcional';
    $('#aiModel').value = pc.model;
    $('#aiModels').innerHTML = pr.type === 'anthropic' ? ai.CLAUDE_MODELS.map((m) => '<option value="' + m + '">').join('') : '';
    $('#aiBase').value = pc.baseUrl;
    $('#aiBaseRow').firstChild.textContent = pr.type === 'anthropic' ? 'URL BASE (OPCIONAL) ' : 'URL BASE ';
    $('#aiBase').placeholder = pr.type === 'anthropic' ? 'deixe vazio para usar api.anthropic.com' : 'https://…/v1';
    $('#aiEffortRow').classList.toggle('hidden', pr.type !== 'anthropic');
    $('#aiWebRow').classList.toggle('hidden', pr.type !== 'anthropic');
    $('#aiHelp').textContent = pr.keyHelp || '';
    $('#aiName').value = cfg.name || 'Maestro';
    $('#aiEffort').value = cfg.effort || 'medium';
    $('#aiWeb').checked = !!cfg.webSearch;
    $('#aiSpeak').checked = !!cfg.speak;
  }
  $('#aiProvider').onchange = (e) => {
    ai.cfg.provider = e.target.value;
    ai.save();
    fillAi();
    updateAiLabel();
  };
  $('#aiKey').onchange = (e) => ai.setP(ai.cfg.provider, { key: e.target.value.trim() });
  $('#aiModel').onchange = (e) => {
    ai.setP(ai.cfg.provider, { model: e.target.value.trim() });
    updateAiLabel();
  };
  $('#aiBase').onchange = (e) => ai.setP(ai.cfg.provider, { baseUrl: e.target.value.trim() });
  $('#aiName').onchange = (e) => {
    ai.cfg.name = e.target.value.trim() || 'Maestro';
    ai.save();
  };
  $('#aiEffort').onchange = (e) => {
    ai.cfg.effort = e.target.value;
    ai.save();
  };
  $('#aiWeb').onchange = (e) => {
    ai.cfg.webSearch = e.target.checked;
    ai.save();
  };
  $('#aiSpeak').onchange = (e) => {
    ai.cfg.speak = e.target.checked;
    ai.save();
  };
  $('#aiTest').onclick = () => {
    $('#aiKey').dispatchEvent(new Event('change'));
    $('#aiModel').dispatchEvent(new Event('change'));
    $('#aiBase').dispatchEvent(new Event('change'));
    const st = $('#aiTestStatus');
    st.textContent = 'testando…';
    const saved = ai.msgs;
    ai.msgs = [];
    let out = '';
    ai.send('Teste de conexão: responda só "OK, pronto para tocar!" sem usar ferramentas.', { teste: true }, {
      text: (d) => (out += d),
      done: () => {
        st.textContent = '✓ ' + (out.trim().slice(0, 60) || 'conectado');
        ai.msgs = saved;
      },
      error: (m) => {
        st.textContent = '✕ ' + m;
        ai.msgs = saved;
      },
    });
  };

  // ------------------------------------------------------------------ chat
  const chatEl = $('#chat');
  const logEl = $('#chatLog');
  function updateAiLabel() {
    $('#aiLabel').textContent = ai.isReady() ? ai.label() : 'ainda não configurado';
  }
  function openChat() {
    chatEl.classList.add('open');
    updateAiLabel();
    if (!logEl.children.length) {
      addMsg('sys', ai.isReady() ? 'Pode falar comigo enquanto toca. Tab liga o microfone.' : 'Para conversar, conecte uma IA (Claude, OpenAI, Gemini, Ollama…) no botão de ajustes acima. A chave fica só neste navegador.');
    }
  }
  function closeChat() {
    chatEl.classList.remove('open');
    $('#chatText').blur();
  }
  function toggleChat() {
    if (chatEl.classList.contains('open')) closeChat();
    else {
      openChat();
      setTimeout(() => $('#chatText').focus(), 50);
    }
  }
  $('#aiClose').onclick = closeChat;
  $('#aiClear').onclick = () => {
    ai.reset();
    logEl.innerHTML = '';
    $('#chatSuggest').classList.remove('hidden');
    openChat();
  };
  $('#aiConfig').onclick = () => openSettings('ai');
  $('#aiSpeak').onchange = (e) => {
    ai.cfg.speak = e.target.checked;
    ai.save();
  };
  bus.on('ai:config', updateAiLabel);

  function md(text) {
    let h = esc(text);
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/^\s*[-*] /gm, '• ').replace(/\n/g, '<br>');
    return h;
  }
  function addMsg(kind, html) {
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.innerHTML = html || '';
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
    return el;
  }
  const TOOL_LABEL = {
    add_song: (i) => 'adicionando "' + (i.title || 'música') + '"',
    download_midi: () => 'baixando o MIDI',
    list_songs: () => 'olhando a biblioteca',
    start_song: (i) => 'abrindo ' + (i.song || 'a música'),
    get_status: () => 'vendo como você foi',
    set_options: () => 'mudando os ajustes',
  };

  function appContext() {
    const now = performance.now();
    return {
      app: player.describe(),
      teclado: { mapa: keymap.PRESETS[keymap.preset].name, formato: keymap.layout, oitava: keymap.octave },
      instrumento: audio.instrument,
      ultimas_notas: recentNotes.filter((n) => now - n.t < 20000).slice(-12).map((n) => noteName(n.m)).join(' ') || '(nenhuma)',
    };
  }

  async function sendChat(text) {
    text = (text || '').trim();
    if (!text || ai.busy) return;
    openChat();
    $('#chatSuggest').classList.add('hidden');
    addMsg('user', esc(text));
    let cur = null;
    let acc = '';
    let all = '';
    const pending = addMsg('bot typing', '');
    cur = pending;
    await ai.send(text, appContext(), {
      text: (d) => {
        if (!cur) {
          cur = addMsg('bot typing', '');
          acc = '';
        }
        acc += d;
        all += d;
        cur.innerHTML = md(acc);
        logEl.scrollTop = logEl.scrollHeight;
      },
      tool: (name, input) => {
        if (cur) {
          cur.classList.remove('typing');
          if (!acc.trim()) cur.remove();
        }
        cur = null;
        const chip = document.createElement('div');
        chip.className = 'tool-chip';
        chip.textContent = (TOOL_LABEL[name] ? TOOL_LABEL[name](input) : name) + '…';
        logEl.appendChild(chip);
        chip._name = name;
        logEl._lastChip = chip;
        logEl.scrollTop = logEl.scrollHeight;
      },
      toolDone: (name, input, out) => {
        const chip = logEl._lastChip;
        if (!chip) return;
        const ok = !(out && out.ok === false);
        chip.textContent = (TOOL_LABEL[name] ? TOOL_LABEL[name](input) : name) + (ok ? ' ✓' : ': ' + ((out && out.error) || 'falhou'));
        chip.classList.toggle('err', !ok);
      },
      done: () => {
        if (cur) {
          cur.classList.remove('typing');
          if (!acc.trim()) cur.remove();
        }
        if (ai.cfg.speak && all.trim()) voice.speak(all);
      },
      error: (m) => {
        if (cur && !acc.trim()) cur.remove();
        addMsg('err', esc(m));
      },
    });
  }
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('#chatText').value;
    $('#chatText').value = '';
    autoGrow();
    sendChat(t);
  };
  const autoGrow = () => {
    const ta = $('#chatText');
    ta.style.height = 'auto';
    ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
  };
  $('#chatText').addEventListener('input', autoGrow);
  $('#chatText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#chatForm').requestSubmit();
    } else if (e.key === 'Escape') {
      e.target.blur();
    }
  });
  $('#chatSuggest').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') sendChat(e.target.textContent);
  });
  function toggleMic() {
    if (!voice.supported) {
      toast('Este navegador não reconhece voz. No Chrome ou no Edge funciona.', 'warn');
      return;
    }
    openChat();
    voice.start(
      (t) => sendChat(t),
      (on) => $('#aiMic').classList.toggle('on', on)
    );
  }
  $('#aiMic').onclick = toggleMic;

  // ferramentas que a IA pode usar
  ai.registerTools({
    add_song: async (i) => {
      const song = songs.makeSong({
        title: i.title,
        composer: i.composer || '',
        bpm: i.bpm,
        timeSig: i.time_signature || 4,
        difficulty: i.difficulty || 2,
        right: i.right_hand,
        left: i.left_hand || '',
        source: 'ai',
        tags: ['IA'],
      });
      if (!song.notes.length) return { ok: false, error: 'Nenhuma nota válida.', erros: (song.errors || []).slice(0, 10) };
      if (song.errors && song.errors.length > song.notes.length / 4) return { ok: false, error: 'Muitos erros de notação; corrija e envie de novo.', erros: song.errors.slice(0, 10) };
      songs.library.add(song);
      if (i.open_mode && i.open_mode !== 'none') loadSong(song, i.open_mode);
      else
        toast('O assistente adicionou "' + song.title + '"', null, [
          { label: 'Ouvir', fn: () => loadSong(song, 'watch') },
          { label: 'Aprender', fn: () => loadSong(song, 'practice') },
        ]);
      return { ok: true, id: song.id, notas: song.notes.length, duracao_s: Math.round(song.duration * 10) / 10, avisos: (song.errors || []).slice(0, 5) };
    },
    download_midi: async (i) => {
      try {
        const song = await downloadMidiUrl(i.url, i.title);
        toast('O assistente baixou "' + song.title + '"', null, [{ label: 'Aprender', fn: () => loadSong(song, 'practice') }]);
        return { ok: true, id: song.id, titulo: song.title, notas: song.notes.length, duracao_s: Math.round(song.duration) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    list_songs: async () => ({
      ok: true,
      musicas: songs.library
        .all()
        .slice(0, 80)
        .map((s) => ({ id: s.id, titulo: s.title, compositor: s.composer, dificuldade: s.difficulty, origem: s.source, duracao_s: Math.round(s.duration) })),
    }),
    start_song: async (i) => {
      const song = songs.library.find(i.song);
      if (!song) return { ok: false, error: 'Música não encontrada. Use list_songs para ver os ids.' };
      const hands = i.hands === 'right' ? 'R' : i.hands === 'left' ? 'L' : i.hands === 'both' ? 'LR' : null;
      loadSong(song, i.mode, { hands: hands || undefined, speed: i.speed_percent ? i.speed_percent / 100 : undefined });
      updateHeader();
      return { ok: true, abriu: song.title, modo: i.mode };
    },
    get_status: async () => {
      const lr = player.lastResults;
      return {
        ok: true,
        ...appContext(),
        notas_tocadas_recentes: player.live.slice(-30).map((l) => ({ nota: noteName(l.midi), inicio_s: Math.round(l.start * 100) / 100, dur_s: l.end != null ? Math.round((l.end - l.start) * 100) / 100 : null })),
        ultimo_resultado: lr ? { musica: lr.song.title, modo: lr.mode, precisao: Math.round(lr.accuracy * 100) + '%', estrelas: lr.stars, ...lr.stats } : null,
      };
    },
    set_options: async (i) => {
      audio.ensure();
      if (i.instrument) audio.setInstrument(i.instrument);
      if (i.speed_percent) setSpeed(i.speed_percent / 100);
      if (i.volume_percent != null) audio.setVolume(i.volume_percent / 100);
      if (i.reverb_percent != null) audio.setReverb(i.reverb_percent / 100);
      if (i.metronome != null) setMetronome(i.metronome);
      if (i.theme) {
        settings.theme = i.theme === 'escuro' ? 'dark' : 'light';
        saveSettings();
        applyTheme();
      }
      if (i.keyboard_preset) keymap.setPreset(i.keyboard_preset);
      return { ok: true };
    },
  });

  // ------------------------------------------------------------------ resultado
  function showResults(res) {
    const s = res.stats;
    $('#resTitle').textContent = res.song.title;
    const grid =
      res.mode === 'challenge'
        ? [['perfeito', s.perfect], ['ótimo', s.great], ['bom', s.good], ['perdidas', s.miss], ['notas erradas', s.wrong], ['maior combo', s.maxCombo]]
        : [['certas', s.correct], ['erradas', s.wrong], ['maior sequência', s.maxCombo]];
    $('#resBody').innerHTML =
      '<div class="res-stars">' + '★'.repeat(res.stars) + '<span style="opacity:.25">' + '★'.repeat(5 - res.stars) + '</span></div>' +
      '<div class="res-big">' + (res.mode === 'challenge' ? String(s.score).padStart(7, '0') : Math.round(res.accuracy * 100) + '%') + '</div>' +
      '<div class="res-sub">' + (res.mode === 'challenge' ? 'precisão de ' + Math.round(res.accuracy * 100) + '%' : 'de acerto') + ', velocidade ' + Math.round(res.speed * 100) + '%</div>' +
      (res.newBest ? '<div class="res-new">Novo recorde</div>' : '') +
      '<div class="res-grid">' + grid.map(([k, v]) => '<div><b>' + v + '</b>' + k + '</div>').join('') + '</div>' +
      '<div class="row end">' +
      '<button class="tb" id="resAi">Pedir uma dica</button>' +
      '<button class="tb" id="resLib">Músicas</button>' +
      (res.mode === 'practice' ? '<button class="tb" id="resNext">Tentar no Jogar</button>' : '') +
      '<button class="tb" id="resAgain" style="background:var(--ink);color:var(--panel);border-color:var(--ink)">Repetir</button></div>';
    openModal('mResults');
    $('#resAgain').onclick = () => loadSong(res.song, res.mode, { autostart: true });
    $('#resLib').onclick = () => {
      closeModal('mResults');
      openLibrary();
    };
    if ($('#resNext')) $('#resNext').onclick = () => loadSong(res.song, 'challenge');
    $('#resAi').onclick = () => {
      closeModal('mResults');
      sendChat('Acabei de tocar "' + res.song.title + '". Como eu fui? Me dá uma dica para melhorar.');
    };
  }

  // ------------------------------------------------------------------ status / rodapé
  bus.on('samples:progress', (d, t) => ($('#sampleInd').textContent = 'carregando piano ' + d + '/' + t));
  bus.on('samples:ready', (failed) => ($('#sampleInd').textContent = failed ? 'piano de cauda (' + failed + ' falhas)' : 'piano de cauda'));
  bus.on('samples:error', () => {
    $('#sampleInd').textContent = 'piano sintetizado';
    toast('Sem internet para o piano de cauda; usando o piano sintetizado.', 'warn');
  });
  bus.on('instrument', (id) => {
    const inst = PN.INSTRUMENTS.find((i) => i.id === id);
    if (id !== 'grand') $('#sampleInd').textContent = inst.name.toLowerCase();
    else if (audio.sampleState === 'ready') $('#sampleInd').textContent = 'piano de cauda';
  });
  bus.on('midi:devices', (list) => {
    $('#midiInd').classList.toggle('hidden', !list.length);
    $('#midiInd').textContent = 'midi: ' + list.join(', ');
    if (list.length) toast('Teclado MIDI conectado: ' + list.join(', '));
  });

  function updateFooter() {
    const s = player.song;
    if (s) {
      const t = util.clamp(player.t, 0, s.duration);
      $('#timeText').textContent = util.formatTime(t) + ' / ' + util.formatTime(s.duration);
    } else {
      $('#timeText').textContent = util.formatTime(player.wall());
    }
    if (recorder.active) $('#recInd').textContent = '● rec ' + util.formatTime(recorder.now());
  }

  // ------------------------------------------------------------------ laço principal
  function firstIdx(notes, t) {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const freeBeats = {
    beatAt: (t) => (t * player.freeBpm) / 60,
    timeAt: (b) => (b * 60) / player.freeBpm,
    bpmAt: () => player.freeBpm,
  };

  function pianoRange(song) {
    const vals = Object.values(keymap.map);
    let lo = vals.length ? Math.min(...vals) : 48;
    let hi = vals.length ? Math.max(...vals) : 83;
    if (song) {
      lo = Math.min(lo, song.range[0]);
      hi = Math.max(hi, song.range[1]);
    }
    lo = Math.max(21, lo - (lo % 12));
    hi = Math.min(108, hi + (11 - (hi % 12)));
    return [lo, hi];
  }
  const MODE_HINT = {
    watch: 'Ouça e veja quais teclas apertar',
    practice: 'Toque a tecla que pisca. A música espera você.',
    challenge: 'Aperte quando a nota encostar na linha',
  };

  function buildState(dt) {
    const song = player.song;
    const t = player.t;
    const beats = song ? player._beatsCache : freeBeats;
    const autoM = new Set();
    const hintM = new Set();
    let firstTime = 0;
    if (song) {
      const notes = player.notes;
      firstTime = notes.length ? notes[0].time : 0;
      for (let i = firstIdx(notes, t - 12); i < notes.length; i++) {
        const n = notes[i];
        if (n.time > t + 1.2 * player.speed) break;
        if (!n.target && n.time <= t && t < n.time + n.duration) autoM.add(n.playMidi);
        if (player.mode === 'challenge' && n.target && !n.judge && n.time - t < 0.7 * player.speed && n.time - t > -0.15 * player.speed) hintM.add(n.playMidi);
      }
      if (player.mode === 'practice') {
        const g = player.groups[player.waitIdx];
        if (g && g.time - t < 1.2 * player.speed) for (const m of g.pending) hintM.add(m);
      }
    }
    const toLanes = (set) => {
      const out = new Set();
      for (const m of set) {
        const i = player.laneIndex.get(m);
        if (i != null) out.add(i);
      }
      return out;
    };
    let waitingText = '';
    if (player.state === 'waiting') {
      const g = player.groups[player.waitIdx];
      if (g) waitingText = 'Toque ' + [...g.pending].map((m) => noteName(m) + (keymap.keyLabelFor(m) ? ' (' + keymap.keyLabelFor(m) + ')' : '')).join(' + ');
    }
    let countdown = '';
    if (song && player.state === 'playing' && t < firstTime) {
      const real = (firstTime - t) / player.speed;
      if (real <= 3) countdown = String(Math.ceil(real));
    }
    // faixa do piano roll
    let lo;
    let hi;
    if (song) {
      lo = Math.min(song.range[0], player.lanes[0] || 127);
      hi = Math.max(song.range[1], player.lanes[player.lanes.length - 1] || 0);
    } else {
      const av = [...keymap.availableSet()];
      lo = av.length ? Math.min(...av) : 48;
      hi = av.length ? Math.max(...av) : 84;
      if (hi - lo > 40) {
        lo = 48;
        hi = 84;
      }
    }
    lo -= 2;
    hi += 2;
    while (hi - lo < 22) {
      lo--;
      hi++;
    }
    const ts = song ? song.timeSig : 4;
    const rollWindow = song ? util.clamp(beats.timeAt(4 * ts) - beats.timeAt(0), 3, 9) : 8;
    const hk = player.hands.R && player.hands.L ? 'as duas mãos' : player.hands.R ? 'mão direita' : 'mão esquerda';
    return {
      song,
      mode: player.mode,
      t,
      speed: player.speed,
      state: player.state,
      clock: player.clock(),
      notes: player.notes,
      lanes: player.lanes,
      laneIndex: player.laneIndex,
      held: player.held,
      live: player.live,
      popups: player.popups,
      ripples: player.ripples,
      stats: player.stats,
      multiplier: player.multiplier(),
      timeSig: ts,
      pickup: song ? song.pickup || 0 : 0,
      beats,
      bpm: song ? beats.bpmAt(Math.max(0, t)) : player.freeBpm,
      beatPos: song ? beats.beatAt(t) - (song.pickup || 0) : (player.wall() * player.freeBpm) / 60,
      rollRange: [lo, hi],
      rollWindow,
      rollUsesPlay: true,
      lookahead: settings.lookahead,
      autoLanes: toLanes(autoM),
      hintLanes: toLanes(hintM),
      autoMidis: autoM,
      hintMidis: hintM,
      noteName,
      keyLabel: (m) => keymap.keyLabelFor(m),
      showKeyOnNotes: settings.keyOnNotes,
      trackText: song ? (player.mode === 'watch' ? 'as duas mãos' : hk) : keymap.PRESETS[keymap.preset].name.toLowerCase(),
      waitingText,
      countdown,
      pianoRange: pianoRange(song),
      hint: song ? MODE_HINT[player.mode] || '' : PRESET_HINT[keymap.preset] || '',
      dt: dt || 0,
      now: performance.now() / 1000,
    };
  }

  let last = performance.now();
  let frameNo = 0;
  function frame(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    player.update(dt);
    const S = buildState(Math.min(dt, 0.1));
    visuals.frame(S);
    updateKeyStates(S.hintMidis, S.autoMidis);
    if (++frameNo % 6 === 0) updateFooter();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ início
  function init() {
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener &&
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!settings.theme) applyTheme();
      });
    keymap.init();
    buildKb(kbEl);
    kbEl._layout = keymap.layout;
    bindKbPointer(kbEl);
    $('#keysArea').classList.toggle('collapsed', !!settings.kbCollapsed);
    $('#kbToggle').textContent = settings.kbCollapsed ? 'Mostrar' : 'Ocultar';
    visuals.init({
      highway: $('#cvHighway'),
      dial: $('#cvDial'),
      roll: $('#cvRoll'),
      wave: $('#cvWave'),
      scope: $('#cvScope'),
      spec: $('#cvSpec'),
      vector: $('#cvVector'),
      piano: $('#cvPiano'),
      progress: $('#cvProgress'),
      gram: $('#cvGram'),
    });
    document.body.classList.toggle('focus', !!settings.focus);
    bus.emit('player:speed', player.speed);
    setMetronome(player.metronome);
    player.load(null);
    bus.emit('keymap');
    updateAiLabel();
    $('#aiSpeak').checked = !!ai.cfg.speak;
    window.addEventListener('resize', () => {
      sizeKb(kbEl);
      if ($('#mKeys').classList.contains('open')) sizeKb(previewEl);
    });
    const closeSplash = () => {
      audio.ensure();
      midi.input.init();
      $('#splash').classList.add('hidden');
      sizeKb(kbEl);
    };
    $$('#splash .choice').forEach(
      (b) =>
        (b.onclick = () => {
          closeSplash();
          const go = b.dataset.go;
          if (go === 'learn') loadSong(songs.library.get('b-brilha'), 'practice');
          else if (go === 'ai') toggleChat();
        })
    );
    // qualquer tecla também fecha a tela inicial
    window.addEventListener(
      'keydown',
      function first() {
        if (!$('#splash').classList.contains('hidden')) {
          audio.ensure();
          $('#splash').classList.add('hidden');
        }
        window.removeEventListener('keydown', first, true);
      },
      true
    );
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  PN.app = { loadSong, openLibrary, sendChat, importFiles, toast };
})();
