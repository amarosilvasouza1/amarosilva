/* Pianeon — utilitários compartilhados */
(function () {
  'use strict';
  const PN = (window.PN = window.PN || {});

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTE_NAMES_PT = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  const util = {
    NOTE_NAMES,
    NOTE_NAMES_PT,
    isBlack: (m) => BLACK[((m % 12) + 12) % 12],
    midiToName(m) {
      return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    },
    midiToNamePt(m) {
      return NOTE_NAMES_PT[((m % 12) + 12) % 12];
    },
    /** "C#4" / "Db4" / "c4" → número MIDI (C4 = 60). Retorna null se inválido. */
    nameToMidi(name) {
      const m = /^([A-Ga-g])([#b♯♭s]{0,2})(-?\d)$/.exec(String(name).trim());
      if (!m) return null;
      let pc = LETTER_PC[m[1].toUpperCase()];
      for (const ch of m[2]) pc += ch === '#' || ch === '♯' || ch === 's' ? 1 : -1;
      const midi = (parseInt(m[3], 10) + 1) * 12 + pc;
      return midi >= 0 && midi <= 127 ? midi : null;
    },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    formatTime(sec) {
      sec = Math.max(0, sec || 0);
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + String(s).padStart(2, '0');
    },
    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    debounce(fn, ms) {
      let t;
      return (...a) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...a), ms);
      };
    },
  };

  /** localStorage com proteção (modo anônimo / bloqueado). */
  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('pianeon:' + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem('pianeon:' + key, JSON.stringify(val));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('pianeon:' + key);
      } catch (e) {}
    },
  };

  /** Emissor de eventos simples. */
  class Emitter {
    constructor() {
      this._h = {};
    }
    on(ev, fn) {
      (this._h[ev] = this._h[ev] || []).push(fn);
      return () => this.off(ev, fn);
    }
    off(ev, fn) {
      this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn);
    }
    emit(ev, ...args) {
      for (const fn of this._h[ev] || []) {
        try {
          fn(...args);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  PN.util = util;
  PN.store = store;
  PN.Emitter = Emitter;
  PN.bus = new Emitter();
})();
