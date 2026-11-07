/* Pianeon — interface: liga teclado, áudio, jogo, visual e IA */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus, audio, keymap, player, visuals, songs, midi, ai, voice } = PN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = util.escapeHtml;

  const settings = Object.assign({ theme: null, names: 'letters', lookahead: 2.4, keyOnNotes: true, focus: false }, store.get('settings', {}));
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

  // ------------------------------------------------------------------ teclas na tela (keycaps)
  const keycapsEl = $('#keycaps');
  const previewEl = $('#keycapsPreview');
  let midiEls = new Map(); // midi -> [el] (teclado principal)
  const pressedCount = new Map();

  function buildKeycaps(container, withSpace) {
    const L = keymap.LAYOUTS[keymap.layout];
    container.innerHTML = '';
    let maxUnits = 0;
    for (const r of L.rows) {
      const row = document.createElement('div');
      row.className = 'kc-row';
      if (r.off) {
        const pad = document.createElement('span');
        pad.className = 'kc-pad';
        pad.style.width = 'calc(var(--u) * ' + r.off + ' - 5px)';
        row.appendChild(pad);
      }
      for (const code of r.keys) {
        const b = document.createElement('button');
        b.className = 'kc';
        b.type = 'button';
        b.dataset.code = code;
        b.innerHTML = '<span class="kc-note"></span><span class="kc-key"></span><span class="kc-alt"></span>';
        row.appendChild(b);
      }
      maxUnits = Math.max(maxUnits, r.off + r.keys.length);
      container.appendChild(row);
    }
    if (withSpace) {
      const row = document.createElement('div');
      row.className = 'kc-row';
      const b = document.createElement('button');
      b.className = 'kc space';
      b.type = 'button';
      b.dataset.code = 'Space';
      b.innerHTML = '<span class="kc-note">PEDAL (SUSTAIN)</span><span class="kc-key">ESPAÇO</span>';
      row.appendChild(b);
      container.appendChild(row);
    }
    container._maxUnits = maxUnits;
    labelKeycaps(container);
    sizeKeycaps(container);
  }

  function sizeKeycaps(c) {
    const w = c.clientWidth || (c.parentElement && c.parentElement.clientWidth) || 800;
    const u = util.clamp((w - 12) / ((c._maxUnits || 13) + 0.4), 30, 64);
    c.style.setProperty('--u', u + 'px');
  }

  function labelKeycaps(c) {
    const preset = keymap.PRESETS[keymap.preset];
    const index = new Map();
    for (const b of $$('.kc', c)) {
      const code = b.dataset.code;
      if (code === 'Space') continue;
      const m = keymap.map[code];
      const noteEl = b.querySelector('.kc-note');
      const keyEl = b.querySelector('.kc-key');
      const altEl = b.querySelector('.kc-alt');
      keyEl.textContent = keymap.label(code);
      altEl.textContent = '';
      b.classList.remove('black', 'c-note', 'empty');
      delete b.dataset.midi;
      if (preset.octaveKeys && preset.octaveKeys[code] != null) {
        noteEl.textContent = preset.octaveKeys[code] < 0 ? 'OIT −' : 'OIT +';
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
      const add = (mm) => {
        if (!index.has(mm)) index.set(mm, []);
        index.get(mm).push(b);
      };
      add(m);
      if (preset.shiftSharp && util.isBlack(m + 1)) {
        altEl.textContent = '⇧' + noteName(m + 1).replace(/\d+$/, '');
        add(m + 1);
      }
    }
    if (c === keycapsEl) midiEls = index;
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

  function bindKeycapPointer(container) {
    const active = new Map(); // pointerId -> midi | 'sustain'
    container.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.kc');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.code === 'Space') {
        active.set(e.pointerId, 'sustain');
        bus.emit('key:special', 'sustain', true);
      } else if (b.dataset.midi) {
        const m = Number(b.dataset.midi);
        active.set(e.pointerId, m);
        noteOn(m, keymap.velocity);
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

  // ------------------------------------------------------------------ notas
  const recentNotes = [];
  function noteOn(m, vel) {
    audio.noteOn(m, vel);
    player.userOn(m, vel);
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

  bus.on('key:special', (name, down) => {
    switch (name) {
      case 'sustain':
        audio.setSustain(down);
        $('#sustainInd').classList.toggle('on', down);
        $$('.kc.space').forEach((el) => el.classList.toggle('on', down));
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
        player.restart();
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
      $('#btnRecord').textContent = '■ PARAR';
      $('#recInd').classList.remove('hidden');
      toast('Gravando… toque à vontade!');
    },
    stop() {
      this.active = false;
      for (const m of [...this.open.keys()]) this.off(m);
      $('#btnRecord').classList.remove('on');
      $('#btnRecord').textContent = '● GRAVAR';
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
        { label: 'OUVIR', fn: () => loadSong(song, 'watch') },
        { label: 'BAIXAR .MID', fn: () => downloadSongMidi(song) },
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
    audio.ensure();
    closeAllModals();
    player.load(song, mode, opts);
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
    $('#songTitle').textContent = s ? s.title.toUpperCase() : 'MODO LIVRE';
    $('#songMeta').textContent = s
      ? [s.composer, PN.MODES[player.mode].name, util.formatTime(s.duration)].filter(Boolean).join(' · ')
      : 'toque com o teclado do computador · escolha uma música em ♫ MÚSICAS';
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', !!s && b.dataset.mode === player.mode));
    const hk = player.hands.R && player.hands.L ? 'LR' : player.hands.R ? 'R' : 'L';
    $$('#handSeg button').forEach((b) => b.classList.toggle('on', b.dataset.hand === hk));
    $('#handSeg').classList.toggle('disabled', !s || player.mode === 'watch');
    updatePlayBtn();
  }
  function updatePlayBtn() {
    const playing = player.state === 'playing' || player.state === 'waiting';
    $('#btnPlay').textContent = playing ? '❚❚' : '▶';
  }
  bus.on('player:load', () => {
    updateHeader();
    closeModal('mResults');
  });
  bus.on('player:state', updatePlayBtn);
  bus.on('player:finish', (res) => {
    if (res.mode === 'watch') {
      toast('Fim! Agora é sua vez?', null, [
        { label: 'PRATICAR', fn: () => loadSong(res.song, 'practice') },
        { label: 'DESAFIO', fn: () => loadSong(res.song, 'challenge') },
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
  $('#btnRestart').onclick = () => player.restart();
  $$('#modeSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        if (!player.song) {
          toast('Escolha uma música primeiro.');
          openLibrary();
          return;
        }
        loadSong(player.song, b.dataset.mode);
      })
  );
  $$('#handSeg button').forEach(
    (b) =>
      (b.onclick = () => {
        player.setHands(b.dataset.hand);
        updateHeader();
      })
  );
  $('#speed').oninput = (e) => setSpeed(Number(e.target.value) / 100);
  $('#btnRecord').onclick = () => recorder.toggle();
  $('#btnLibrary').onclick = () => openLibrary();
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
  $('#cvMap').addEventListener('pointerdown', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const pad = 8;
    if (!player.song) return;
    if (player.mode === 'challenge') return toast('No desafio não dá para pular.');
    player.seek(util.clamp((e.clientX - r.left - pad) / (r.width - pad * 2), 0, 1) * player.song.duration);
  });

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

  const SOURCE_BADGE = { midi: 'MIDI', ai: 'IA', sheet: 'LETRAS', rec: 'GRAVAÇÃO', notation: 'NOTAÇÃO' };
  function renderLibrary() {
    const q = $('#libSearch').value.trim().toLowerCase();
    let list = songs.library.all();
    if (libTab === 'builtin') list = list.filter((s) => s.source === 'builtin');
    if (libTab === 'mine') list = list.filter((s) => s.source !== 'builtin');
    if (q) list = list.filter((s) => (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
    const el = $('#libList');
    if (!list.length) {
      el.innerHTML = '<div class="lib-empty">' + (libTab === 'mine' ? 'Você ainda não tem músicas. Importe um MIDI, cole uma partitura de letras, grave algo ou peça para a IA. ✦' : 'Nada encontrado.') + '</div>';
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
          '<span class="diff">' + '●'.repeat(s.difficulty) + '<span class="off">' + '●'.repeat(5 - s.difficulty) + '</span></span>' +
          '<div style="min-width:0"><div class="lib-title">' + esc(s.title) + badge + '</div><div class="lib-sub">' + esc(s.composer || '') + (s.composer ? ' · ' : '') + s.notes.length + ' notas</div></div>' +
          '<span class="lib-dur">' + util.formatTime(s.duration) + '</span>' +
          '<span class="lib-best">' + bestTxt + '</span>' +
          '<div class="lib-actions"><button class="tb" data-act="watch">ASSISTIR</button><button class="tb" data-act="practice">PRATICAR</button><button class="tb" data-act="challenge">DESAFIO</button>' +
          (mine ? '<button class="tb" data-act="dl" title="Baixar .mid">⬇</button><button class="tb" data-act="del" title="Apagar">✕</button>' : '') +
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
        toast('"' + f.name + '" é áudio. O Pianeon lê arquivos MIDI (.mid). Converta o áudio para MIDI ou peça a música para a IA.', 'warn');
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
        { label: 'ASSISTIR', fn: () => loadSong(last, 'watch') },
        { label: 'PRATICAR', fn: () => loadSong(last, 'practice') },
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
    toast('"' + song.title + '" adicionada.', null, [{ label: 'PRATICAR', fn: () => loadSong(song, 'practice') }]);
    $('#vpText').value = '';
  };
  $('#ntAdd').onclick = () => {
    const song = songs.makeSong({ title: $('#ntTitle').value.trim() || 'Minha música', bpm: Number($('#ntBpm').value) || 100, right: $('#ntRight').value, left: $('#ntLeft').value, source: 'notation', tags: ['notação'] });
    if (song.errors && song.errors.length) toast(song.errors.slice(0, 2).join(' · '), 'warn');
    if (!song.notes.length) return;
    songs.library.add(song);
    toast('"' + song.title + '" adicionada.', null, [{ label: 'PRATICAR', fn: () => loadSong(song, 'practice') }]);
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
      toast('"' + song.title + '" baixada!', null, [{ label: 'PRATICAR', fn: () => loadSong(song, 'practice') }]);
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
    buildKeycaps(previewEl, false);
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
    keymap.setPreset('tracker');
    toast('Mapa padrão restaurado.');
  };
  bindKeycapPointer(previewEl);

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
    labelKeycaps(keycapsEl);
    if (keycapsEl._layout !== keymap.layout) {
      buildKeycaps(keycapsEl, true);
      keycapsEl._layout = keymap.layout;
    }
    prevHint = new Set();
    prevAuto = new Set();
    $('#presetName').textContent = 'TECLADO: ' + keymap.PRESETS[keymap.preset].name.toUpperCase() + ' · ' + keymap.LAYOUTS[keymap.layout].name.split(' (')[0];
    $('#octInd').textContent = 'OITAVA ' + (keymap.octave > 0 ? '+' : '') + keymap.octave;
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
    $('#setInstrument').innerHTML = PN.INSTRUMENTS.map((i) => '<option value="' + i.id + '"' + (audio.instrument === i.id ? ' selected' : '') + '>' + i.icon + ' ' + esc(i.name) + '</option>').join('');
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
    toast(ok ? 'Teclado MIDI pronto. Toque nele!' : 'Não foi possível acessar o MIDI (permissão negada ou navegador sem suporte).', ok ? null : 'warn');
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
    $('#aiLabel').textContent = ai.isReady() ? ai.label() : 'NÃO CONFIGURADA — toque em ⚙';
  }
  function openChat() {
    chatEl.classList.add('open');
    updateAiLabel();
    if (!logEl.children.length) {
      addMsg('sys', ai.isReady() ? 'Converse comigo enquanto toca. Aperte TAB para falar por voz.' : 'Conecte a sua IA em ⚙ (Claude, OpenAI, Gemini, Ollama…). A chave fica só neste navegador.');
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
    download_midi: () => 'baixando MIDI',
    list_songs: () => 'olhando a biblioteca',
    start_song: (i) => 'abrindo ' + (i.song || 'música'),
    get_status: () => 'vendo como você está indo',
    set_options: () => 'ajustando o app',
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
        chip.textContent = '♪ ' + (TOOL_LABEL[name] ? TOOL_LABEL[name](input) : name) + '…';
        logEl.appendChild(chip);
        chip._name = name;
        logEl._lastChip = chip;
        logEl.scrollTop = logEl.scrollHeight;
      },
      toolDone: (name, input, out) => {
        const chip = logEl._lastChip;
        if (!chip) return;
        const ok = !(out && out.ok === false);
        chip.textContent = (ok ? '✓ ' : '✕ ') + (TOOL_LABEL[name] ? TOOL_LABEL[name](input) : name) + (ok ? '' : ' — ' + ((out && out.error) || 'falhou'));
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
      toast('Reconhecimento de voz não é suportado neste navegador (use Chrome ou Edge).', 'warn');
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
        toast('✦ IA adicionou "' + song.title + '"', null, [
          { label: 'ASSISTIR', fn: () => loadSong(song, 'watch') },
          { label: 'PRATICAR', fn: () => loadSong(song, 'practice') },
        ]);
      return { ok: true, id: song.id, notas: song.notes.length, duracao_s: Math.round(song.duration * 10) / 10, avisos: (song.errors || []).slice(0, 5) };
    },
    download_midi: async (i) => {
      try {
        const song = await downloadMidiUrl(i.url, i.title);
        toast('✦ IA baixou "' + song.title + '"', null, [{ label: 'PRATICAR', fn: () => loadSong(song, 'practice') }]);
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
    $('#resTitle').textContent = (res.mode === 'challenge' ? 'DESAFIO' : 'PRÁTICA') + ' — ' + res.song.title.toUpperCase();
    const grid =
      res.mode === 'challenge'
        ? [['PERFEITO', s.perfect], ['ÓTIMO', s.great], ['BOM', s.good], ['ERROU', s.miss], ['NOTA ERRADA', s.wrong], ['MAIOR COMBO', s.maxCombo]]
        : [['CERTAS', s.correct], ['ERRADAS', s.wrong], ['MAIOR SEQUÊNCIA', s.maxCombo]];
    $('#resBody').innerHTML =
      '<div class="res-stars">' + '★'.repeat(res.stars) + '<span style="opacity:.25">' + '★'.repeat(5 - res.stars) + '</span></div>' +
      '<div class="res-big">' + (res.mode === 'challenge' ? String(s.score).padStart(7, '0') : Math.round(res.accuracy * 100) + '%') + '</div>' +
      '<div class="res-sub">' + (res.mode === 'challenge' ? 'PRECISÃO ' + Math.round(res.accuracy * 100) + '%' : 'DE ACERTO') + ' · VELOCIDADE ' + Math.round(res.speed * 100) + '%</div>' +
      (res.newBest ? '<div class="res-new">★ NOVO RECORDE!</div>' : '') +
      '<div class="res-grid">' + grid.map(([k, v]) => '<div><b>' + v + '</b>' + k + '</div>').join('') + '</div>' +
      '<div class="row end">' +
      '<button class="tb" id="resAi">✦ PEDIR DICA À IA</button>' +
      '<button class="tb" id="resLib">MÚSICAS</button>' +
      (res.mode === 'practice' ? '<button class="tb" id="resNext">IR PARA O DESAFIO</button>' : '') +
      '<button class="tb" id="resAgain" style="background:var(--ink);color:var(--panel)">REPETIR</button></div>';
    openModal('mResults');
    $('#resAgain').onclick = () => loadSong(res.song, res.mode);
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
  bus.on('samples:progress', (d, t) => ($('#sampleInd').textContent = 'PIANO ' + d + '/' + t));
  bus.on('samples:ready', (failed) => ($('#sampleInd').textContent = failed ? 'PIANO ✓ (' + failed + ' falhas)' : 'PIANO DE CAUDA ✓'));
  bus.on('samples:error', () => {
    $('#sampleInd').textContent = 'PIANO SINTETIZADO';
    toast('Sem acesso aos samples do piano — usando o piano sintetizado.', 'warn');
  });
  bus.on('instrument', (id) => {
    const inst = PN.INSTRUMENTS.find((i) => i.id === id);
    if (id !== 'grand') $('#sampleInd').textContent = inst.name.toUpperCase();
    else if (audio.sampleState === 'ready') $('#sampleInd').textContent = 'PIANO DE CAUDA ✓';
  });
  bus.on('midi:devices', (list) => {
    $('#midiInd').classList.toggle('hidden', !list.length);
    $('#midiInd').textContent = 'MIDI: ' + list.join(', ').toUpperCase();
    if (list.length) toast('Teclado MIDI conectado: ' + list.join(', '));
  });

  function updateFooter() {
    const s = player.song;
    if (s) {
      const t = util.clamp(player.t, 0, s.duration);
      $('#timeText').textContent = util.formatTime(t) + ' / ' + util.formatTime(s.duration);
      $('#progressBar').style.width = (t / Math.max(1, s.duration)) * 100 + '%';
    } else {
      $('#timeText').textContent = util.formatTime(player.wall()) + ' LIVRE';
      $('#progressBar').style.width = '0%';
    }
    if (recorder.active) $('#recInd').textContent = '● REC ' + util.formatTime(recorder.now());
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

  function buildState() {
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
      if (g) waitingText = 'TOQUE: ' + [...g.pending].map((m) => noteName(m) + (keymap.keyLabelFor(m) ? ' [' + keymap.keyLabelFor(m) + ']' : '')).join('  ');
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
    const hk = player.hands.R && player.hands.L ? 'AMBAS AS MÃOS' : player.hands.R ? 'MÃO DIREITA' : 'MÃO ESQUERDA';
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
      trackText: song ? (player.mode === 'watch' ? 'TODAS' : hk) : 'TECLADO ' + keymap.PRESETS[keymap.preset].name.toUpperCase(),
      waitingText,
      countdown,
    };
  }

  let last = performance.now();
  let frameNo = 0;
  function frame(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    player.update(dt);
    const S = buildState();
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
    buildKeycaps(keycapsEl, true);
    keycapsEl._layout = keymap.layout;
    bindKeycapPointer(keycapsEl);
    visuals.init({
      highway: $('#cvHighway'),
      dial: $('#cvDial'),
      roll: $('#cvRoll'),
      wave: $('#cvWave'),
      scope: $('#cvScope'),
      spec: $('#cvSpec'),
      vector: $('#cvVector'),
      map: $('#cvMap'),
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
      sizeKeycaps(keycapsEl);
      if ($('#mKeys').classList.contains('open')) sizeKeycaps(previewEl);
    });
    $('#startBtn').onclick = () => {
      audio.ensure();
      midi.input.init();
      $('#splash').classList.add('hidden');
      sizeKeycaps(keycapsEl);
    };
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
