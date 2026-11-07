/* Pianeon — leitura/escrita de arquivos MIDI (.mid) e entrada de teclado MIDI USB */
(function () {
  'use strict';
  const PN = window.PN;
  const { bus } = PN;

  const GM_NAMES = ['Piano', 'Piano', 'Piano', 'Piano', 'Piano Elétrico', 'Piano Elétrico', 'Cravo', 'Clavinet'];

  /**
   * Lê o arquivo com a biblioteca @tonejs/midi (vendor/midi/Midi.js, licença MIT).
   * Se ela não estiver carregada ou não entender o arquivo (ex.: RMID), usa o leitor próprio abaixo.
   */
  function parseMidi(arrayBuffer) {
    if (window.Midi) {
      try {
        return parseWithToneMidi(arrayBuffer);
      } catch (e) {
        /* cai no leitor próprio */
      }
    }
    return parseMidiFallback(arrayBuffer);
  }

  function parseWithToneMidi(arrayBuffer) {
    const m = new window.Midi(arrayBuffer);
    const notes = [];
    const tracks = [];
    m.tracks.forEach((tr, ti) => {
      if (tr.channel === 9 || (tr.instrument && tr.instrument.percussion)) return; // bateria
      let sum = 0;
      for (const n of tr.notes) {
        notes.push({ midi: n.midi, time: n.time, duration: Math.max(0.03, n.duration), velocity: n.velocity, track: ti });
        sum += n.midi;
      }
      if (tr.notes.length)
        tracks.push({
          index: ti,
          name: tr.name || 'Faixa ' + (ti + 1),
          channel: tr.channel,
          instrument: tr.instrument ? tr.instrument.name : '',
          noteCount: tr.notes.length,
          avgPitch: sum / tr.notes.length,
        });
    });
    if (!notes.length && !m.tracks.length) throw new Error('vazio');
    notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
    const duration = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
    const tempo = m.header.tempos && m.header.tempos[0];
    const named = m.tracks.find((t) => t.name);
    return { format: 1, name: (m.header.name || (named && named.name) || '').trim(), notes, tracks, duration, bpm: Math.round(tempo ? tempo.bpm : 120) };
  }

  /** Leitor próprio: converte um ArrayBuffer .mid em { name, notes[], tracks[], duration, bpm }. */
  function parseMidiFallback(arrayBuffer) {
    const data = new DataView(arrayBuffer);
    let p = 0;
    const u8 = () => data.getUint8(p++);
    const u16 = () => {
      const v = data.getUint16(p);
      p += 2;
      return v;
    };
    const u32 = () => {
      const v = data.getUint32(p);
      p += 4;
      return v;
    };
    const str = (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(data.getUint8(p + i));
      p += n;
      return s;
    };
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        const b = u8();
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };

    // Alguns arquivos começam com cabeçalho RIFF (RMID)
    if (str(4) === 'RIFF') {
      p = 8;
      if (str(4) !== 'RMID') throw new Error('Arquivo RIFF não é MIDI');
      while (p < data.byteLength - 8) {
        const id = str(4);
        const len = data.getUint32(p, true);
        p += 4;
        if (id === 'data') break;
        p += len;
      }
    } else {
      p = 0;
    }
    if (str(4) !== 'MThd') throw new Error('Não é um arquivo MIDI válido');
    const hlen = u32();
    const format = u16();
    const ntrks = u16();
    const division = u16();
    p += hlen - 6;
    let tpq = 480;
    let smpte = 0;
    if (division & 0x8000) {
      const fps = 256 - (division >> 8);
      smpte = fps * (division & 0xff); // ticks por segundo
    } else tpq = division;

    const tempos = []; // {tick, uspq}
    const rawTracks = [];
    for (let t = 0; t < ntrks && p < data.byteLength - 8; t++) {
      const id = str(4);
      const len = u32();
      const end = p + len;
      if (id !== 'MTrk') {
        p = end;
        continue;
      }
      const track = { name: '', events: [], program: 0 };
      let tick = 0;
      let status = 0;
      while (p < end && p < data.byteLength) {
        tick += vlq();
        let b = data.getUint8(p);
        if (b & 0x80) {
          status = b;
          p++;
        } else if (!status) {
          p++;
          continue;
        }
        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (status === 0xff) {
          const mt = u8();
          const ml = vlq();
          if (mt === 0x51 && ml === 3) {
            const us = (data.getUint8(p) << 16) | (data.getUint8(p + 1) << 8) | data.getUint8(p + 2);
            tempos.push({ tick, uspq: us });
          } else if ((mt === 0x03 || mt === 0x01) && !track.name) {
            const raw = new Uint8Array(arrayBuffer, p, ml);
            try {
              track.name = new TextDecoder('utf-8', { fatal: false }).decode(raw).replace(/\0/g, '').trim();
            } catch (e) {}
          }
          p += ml;
          status = 0; // meta cancela running status
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq();
          status = 0;
        } else if (type === 0x90 || type === 0x80) {
          const note = u8();
          const vel = u8();
          track.events.push({ tick, on: type === 0x90 && vel > 0, note, vel, ch });
        } else if (type === 0xb0) {
          const cc = u8();
          const val = u8();
          if (cc === 64) track.events.push({ tick, sustain: val >= 64, ch });
        } else if (type === 0xc0) {
          const prog = u8();
          if (!track.events.length) track.program = prog;
          track.events.push({ tick, program: prog, ch });
        } else if (type === 0xd0) {
          p += 1;
        } else if (type === 0xa0 || type === 0xe0) {
          p += 2;
        } else {
          p++;
        }
      }
      p = end;
      rawTracks.push(track);
    }

    // Mapa de tempo: ticks → segundos
    tempos.sort((a, b) => a.tick - b.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspq: 500000 });
    const segs = [];
    let acc = 0;
    for (let i = 0; i < tempos.length; i++) {
      const tp = tempos[i];
      if (i > 0) {
        const prev = segs[i - 1];
        acc = prev.sec + ((tp.tick - prev.tick) * prev.uspq) / 1e6 / tpq;
      }
      segs.push({ tick: tp.tick, sec: acc, uspq: tp.uspq });
    }
    const tickToSec = (tick) => {
      if (smpte) return tick / smpte;
      let s = segs[0];
      for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i];
      return s.sec + ((tick - s.tick) * s.uspq) / 1e6 / tpq;
    };

    const notes = [];
    const tracks = [];
    rawTracks.forEach((tr, ti) => {
      const open = new Map(); // ch*128+note -> [ {tick, vel} ]
      let count = 0;
      let channel = -1;
      let sum = 0;
      for (const ev of tr.events) {
        if (ev.note == null) continue;
        if (ev.ch === 9) continue; // canal 10 = bateria
        const key = ev.ch * 128 + ev.note;
        if (ev.on) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(ev);
        } else {
          const list = open.get(key);
          if (list && list.length) {
            const start = list.shift();
            const t0 = tickToSec(start.tick);
            const t1 = tickToSec(ev.tick);
            notes.push({
              midi: ev.note,
              time: t0,
              duration: Math.max(0.03, t1 - t0),
              velocity: start.vel / 127,
              track: ti,
            });
            count++;
            sum += ev.note;
            channel = ev.ch;
          }
        }
      }
      // notas sem note-off: fecha com 0.5s
      for (const list of open.values())
        for (const start of list) {
          notes.push({ midi: start.note, time: tickToSec(start.tick), duration: 0.5, velocity: start.vel / 127, track: ti });
          count++;
          sum += start.note;
        }
      tracks.push({
        index: ti,
        name: tr.name || 'Faixa ' + (ti + 1),
        channel,
        instrument: GM_NAMES[tr.program] || 'Instrumento ' + tr.program,
        noteCount: count,
        avgPitch: count ? sum / count : 0,
      });
    });

    notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
    const duration = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
    const bpm = Math.round(60000000 / (tempos[0] ? tempos[0].uspq : 500000));
    const named = rawTracks.find((t) => t.name);
    return { format, name: named ? named.name : '', notes, tracks: tracks.filter((t) => t.noteCount > 0), duration, bpm };
  }

  /** Divide em mão direita (R) e esquerda (L). */
  function assignHands(notes, tracks) {
    const active = tracks.filter((t) => t.noteCount > 0);
    if (active.length >= 2) {
      const sorted = active.slice().sort((a, b) => b.avgPitch - a.avgPitch);
      const right = sorted[0].index;
      for (const n of notes) n.hand = n.track === right ? 'R' : 'L';
    } else {
      for (const n of notes) n.hand = n.midi >= 60 ? 'R' : 'L';
    }
    return notes;
  }

  /** Gera um arquivo .mid (formato 0) a partir de notas em segundos. */
  function writeMidi(notes, opts = {}) {
    const bpm = opts.bpm || 120;
    const tpq = 480;
    const secToTick = (s) => Math.round((s * bpm * tpq) / 60);
    const evs = [];
    for (const n of notes) {
      const ch = n.hand === 'L' ? 1 : 0;
      const vel = Math.max(1, Math.min(127, Math.round((n.velocity || 0.8) * 127)));
      evs.push({ tick: secToTick(n.time), bytes: [0x90 | ch, n.midi, vel], order: 1 });
      evs.push({ tick: secToTick(n.time + n.duration), bytes: [0x80 | ch, n.midi, 0], order: 0 });
    }
    evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    const pushVlq = (v) => {
      const stack = [v & 0x7f];
      while ((v >>= 7)) stack.unshift((v & 0x7f) | 0x80);
      body.push(...stack);
    };
    const name = new TextEncoder().encode(opts.title || 'Pianeon');
    pushVlq(0);
    body.push(0xff, 0x03);
    pushVlq(name.length);
    body.push(...name);
    const us = Math.round(60000000 / bpm);
    pushVlq(0);
    body.push(0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
    let last = 0;
    for (const e of evs) {
      pushVlq(e.tick - last);
      last = e.tick;
      body.push(...e.bytes);
    }
    pushVlq(0);
    body.push(0xff, 0x2f, 0x00);
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
    const len = body.length;
    const trk = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
    return new Uint8Array([...header, ...trk, ...body]);
  }

  /** Teclado MIDI físico (USB/Bluetooth) via Web MIDI API. */
  const midiInput = {
    enabled: false,
    devices: [],
    async init() {
      if (!navigator.requestMIDIAccess) return false;
      try {
        const access = await navigator.requestMIDIAccess();
        const hook = () => {
          this.devices = [];
          for (const input of access.inputs.values()) {
            this.devices.push(input.name);
            input.onmidimessage = (e) => this._msg(e.data);
          }
          bus.emit('midi:devices', this.devices);
        };
        access.onstatechange = hook;
        hook();
        this.enabled = true;
        return true;
      } catch (e) {
        return false;
      }
    },
    _msg(d) {
      const type = d[0] & 0xf0;
      if (type === 0x90 && d[2] > 0) bus.emit('midi:on', d[1], d[2] / 127);
      else if (type === 0x80 || (type === 0x90 && d[2] === 0)) bus.emit('midi:off', d[1]);
      else if (type === 0xb0 && d[1] === 64) bus.emit('midi:sustain', d[2] >= 64);
    },
  };

  PN.midi = { parseMidi, parseMidiFallback, assignHands, writeMidi, input: midiInput };
})();
