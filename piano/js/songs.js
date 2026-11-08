/* Pianeon — biblioteca de músicas, notação de texto e partituras de letras (Virtual Piano) */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus } = PN;

  /**
   * Notação Pianeon (simples de escrever à mão ou por IA):
   *   "E4 D#4:0.5 C4+E4+G4:2 R:1 | ..."
   *   - nota: letra + (# ou b) + oitava (C4 = Dó central)
   *   - acorde: notas unidas com +
   *   - :duração em tempos (1 = semínima, 0.5 = colcheia, 2 = mínima, 1/3 = tercina)
   *     a duração se repete até ser trocada
   *   - R ou - = pausa | barras "|" são ignoradas (só ajudam a ler)
   */
  function parseNotation(text) {
    const notes = [];
    const errors = [];
    let beat = 0;
    let dur = 1;
    const tokens = String(text || '')
      .replace(/[|,\n\r\t]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    for (const tok of tokens) {
      const [pitchPart, durPart] = tok.split(':');
      if (durPart !== undefined) {
        let d;
        if (durPart.includes('/')) {
          const [a, b] = durPart.split('/').map(Number);
          d = a / b;
        } else d = parseFloat(durPart);
        if (!isFinite(d) || d <= 0 || d > 64) {
          errors.push('Duração inválida em "' + tok + '"');
          continue;
        }
        dur = d;
      }
      if (/^(R|-|_|P)$/i.test(pitchPart)) {
        beat += dur;
        continue;
      }
      const chord = pitchPart.split('+');
      let ok = true;
      const mids = [];
      for (const n of chord) {
        const m = util.nameToMidi(n);
        if (m == null) {
          ok = false;
          errors.push('Nota inválida "' + n + '" em "' + tok + '"');
        } else mids.push(m);
      }
      if (!ok) {
        beat += dur;
        continue;
      }
      for (const m of mids) notes.push({ midi: m, beat, beats: dur });
      beat += dur;
    }
    return { notes, beats: beat, errors };
  }

  /** Converte tempos (beats) em segundos usando um mapa de andamento [[beat, bpm], ...]. */
  function beatToSecFn(tempos) {
    const t = tempos.slice().sort((a, b) => a[0] - b[0]);
    const segs = [];
    let sec = 0;
    for (let i = 0; i < t.length; i++) {
      if (i > 0) sec += ((t[i][0] - t[i - 1][0]) * 60) / t[i - 1][1];
      segs.push({ beat: t[i][0], sec, bpm: t[i][1] });
    }
    return (b) => {
      let s = segs[0];
      for (let i = 1; i < segs.length && segs[i].beat <= b; i++) s = segs[i];
      return s.sec + ((b - s.beat) * 60) / s.bpm;
    };
  }

  /** Monta uma música a partir da notação das duas mãos. */
  function makeSong(def) {
    const bpm = util.clamp(Number(def.bpm) || 100, 20, 320);
    const tempos = def.tempos && def.tempos.length ? def.tempos : [[0, bpm]];
    if (tempos[0][0] !== 0) tempos.unshift([0, bpm]);
    const toSec = beatToSecFn(tempos);
    const notes = [];
    const errors = [];
    const hands = [
      ['R', def.right, def.holdR || 0, 0.82],
      ['L', def.left, def.holdL || 0, 0.66],
    ];
    for (const [hand, src, hold, vel] of hands) {
      if (!src) continue;
      const parsed = typeof src === 'string' ? parseNotation(src) : { notes: src, errors: [] };
      errors.push(...parsed.errors.map((e) => (hand === 'R' ? 'Mão direita: ' : 'Mão esquerda: ') + e));
      for (const n of parsed.notes) {
        const len = Math.max(n.beats, hold);
        const t0 = toSec(n.beat);
        const t1 = toSec(n.beat + len);
        notes.push({ midi: n.midi, time: t0, duration: Math.max(0.05, (t1 - t0) * 0.96), velocity: n.vel || vel, hand });
      }
    }
    notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
    return finalizeSong(
      {
        id: def.id || 'u-' + util.uid(),
        title: def.title || 'Sem título',
        composer: def.composer || '',
        difficulty: util.clamp(Math.round(def.difficulty || 2), 1, 5),
        bpm,
        tempos,
        timeSig: def.timeSig || 4,
        pickup: def.pickup || 0,
        source: def.source || 'builtin',
        tags: def.tags || [],
        notes,
      },
      errors
    );
  }

  function finalizeSong(song, errors) {
    if (!song.tempos || !song.tempos.length) song.tempos = [[0, song.bpm || 120]];
    song.timeSig = song.timeSig || 4;
    song.duration = song.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
    let lo = 127;
    let hi = 0;
    for (const n of song.notes) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    song.range = song.notes.length ? [lo, hi] : [60, 72];
    song.hands = { R: song.notes.some((n) => n.hand === 'R'), L: song.notes.some((n) => n.hand === 'L') };
    if (errors) song.errors = errors;
    return song;
  }

  // ---------------------------------------------------------------------
  // Partituras de letras (Virtual Piano / Roblox): "[tu] y t r e | ..."
  const VP_WHITE = '1234567890qwertyuiopasdfghjklzxcvbnm';
  const VP_BLACK = { '!': 37, '@': 39, $: 42, '%': 44, '^': 46, '*': 49, '(': 51, Q: 54, W: 56, E: 58, T: 61, Y: 63, I: 66, O: 68, P: 70, S: 73, D: 75, G: 78, H: 80, J: 82, L: 85, Z: 87, C: 90, V: 92, B: 94 };
  const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
  function vpCharToMidi(ch) {
    const i = VP_WHITE.indexOf(ch);
    if (i >= 0) return 36 + Math.floor(i / 7) * 12 + WHITE_STEPS[i % 7];
    if (VP_BLACK[ch] != null) return VP_BLACK[ch];
    return null;
  }

  /**
   * Ritmo aproximado: letras grudadas = rápidas (1/4 de tempo),
   * separadas por espaço = 1/2 tempo, "|" ou quebra de linha = pausa de 1 tempo,
   * "-" = pausa de 1/2 tempo, [abc] = acorde.
   */
  function parseVPSheet(text, opts = {}) {
    const bpm = opts.bpm || 100;
    const spb = 60 / bpm;
    const items = []; // {mids[], gap}
    const s = String(text || '');
    let i = 0;
    const pushGap = (g) => {
      if (items.length) items[items.length - 1].gap = Math.max(items[items.length - 1].gap, g);
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === '[') {
        const end = s.indexOf(']', i);
        const inner = end > i ? s.slice(i + 1, end) : '';
        const mids = [...inner].map(vpCharToMidi).filter((m) => m != null);
        if (mids.length) items.push({ mids, gap: 0.25 });
        i = end > i ? end + 1 : s.length;
        continue;
      }
      if (ch === ' ') pushGap(0.5);
      else if (ch === '|' || ch === '\n') pushGap(1.0);
      else if (ch === '-') {
        if (items.length) items[items.length - 1].gap += 0.5;
      } else {
        const m = vpCharToMidi(ch);
        if (m != null) items.push({ mids: [m], gap: 0.25 });
      }
      i++;
    }
    const notes = [];
    let beat = 0;
    for (const it of items) {
      for (const m of it.mids) notes.push({ midi: m, time: beat * spb, duration: Math.max(0.5, it.gap) * spb * 0.95, velocity: 0.78, hand: m >= 60 ? 'R' : 'L' });
      beat += it.gap;
    }
    return finalizeSong({
      id: 'u-' + util.uid(),
      title: opts.title || 'Partitura de letras',
      composer: opts.composer || '',
      difficulty: 2,
      bpm,
      timeSig: 4,
      source: 'sheet',
      tags: ['letras'],
      notes,
    });
  }

  // ---------------------------------------------------------------------
  // Músicas incluídas (todas de domínio público)
  function genPrelude() {
    const bars = [
      'C4 E4 G4 C5 E5', 'C4 D4 A4 D5 F5', 'B3 D4 G4 D5 F5', 'C4 E4 G4 C5 E5',
      'C4 E4 A4 E5 A5', 'C4 D4 F#4 A4 D5', 'B3 D4 G4 D5 G5', 'B3 C4 E4 G4 C5',
      'A3 C4 E4 G4 C5', 'D3 A3 D4 F#4 C5', 'G3 B3 D4 G4 B4', 'G3 Bb3 E4 G4 C#5',
      'F3 A3 D4 A4 D5', 'F3 Ab3 D4 F4 B4', 'E3 G3 C4 G4 C5', 'E3 F3 A3 C4 F4',
      'D3 F3 A3 C4 F4', 'G2 D3 G3 B3 F4', 'C3 E3 G3 C4 E4',
    ];
    const R = [];
    const L = [];
    bars.forEach((b, bi) => {
      const n = b.split(' ').map(util.nameToMidi);
      for (let half = 0; half < 2; half++) {
        const t = bi * 4 + half * 2;
        L.push({ midi: n[0], beat: t, beats: 2 });
        L.push({ midi: n[1], beat: t + 0.25, beats: 1.75 });
        [2, 3, 4, 2, 3, 4].forEach((k, j) => R.push({ midi: n[k], beat: t + 0.5 + j * 0.25, beats: 0.25 }));
      }
    });
    const end = bars.length * 4;
    ['C3', 'C2'].forEach((x) => L.push({ midi: util.nameToMidi(x), beat: end, beats: 4 }));
    ['E4', 'G4', 'C5'].forEach((x) => R.push({ midi: util.nameToMidi(x), beat: end, beats: 4 }));
    return { R, L };
  }

  function genGymnopedie(bars) {
    const out = [];
    for (let i = 0; i < bars; i++) out.push(i % 2 === 0 ? 'G2:1 B3+D4+F#4:2' : 'D2:1 A3+C#4+F#4:2');
    return out.join(' | ');
  }

  const repeat = (s, n) => Array(n).fill(s).join(' | ');
  const prelude = genPrelude();
  const kingPhrase = (o) => {
    const u = (n) => n.replace(/(\d)/, (d) => String(Number(d) + o));
    return [
      'B3:0.5 C#4 D4 E4 F#4 D4 F#4:1',
      'F4:0.5 C#4 F4:1 E4:0.5 C4 E4:1',
      'B3:0.5 C#4 D4 E4 F#4 D4 F#4 B4',
      'A4 F#4 D4 F#4 A4:2',
    ]
      .join(' | ')
      .split(' ')
      .map((t) => (t === '|' ? t : t.replace(/^([A-G][#b]?)(\d)/, (m, a, d) => a + (Number(d) + o))))
      .join(' ');
  };
  const kingLeft = 'B2:0.5 R F#2 R B2 R F#2 R | F#2 R C#3 R F#2 R C#3 R | B2 R F#2 R B2 R F#2 R | F#2 R C#3 R B2:1 R:1';

  const BUILTIN_DEFS = [
    {
      id: 'b-escala-do',
      title: 'Aquecimento: Escala de Dó',
      composer: 'Exercício',
      difficulty: 1,
      bpm: 90,
      right: 'C4:1 D4 E4 F4 G4 A4 B4 C5 | C5 B4 A4 G4 F4 E4 D4 C4 | R:16',
      left: 'R:16 | C3:1 D3 E3 F3 G3 A3 B3 C4 | C4 B3 A3 G3 F3 E3 D3 C3',
      tags: ['exercício'],
    },
    {
      id: 'b-mary',
      title: 'Maria Tinha um Carneirinho',
      composer: 'Tradicional',
      difficulty: 1,
      bpm: 110,
      right: 'E4 D4 C4 D4 | E4 E4 E4:2 | D4:1 D4 D4:2 | E4:1 G4 G4:2 | E4:1 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4',
      left: 'C3+G3:4 | C3+G3:4 | G2+D3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | G2+D3:4 | C3+G3:4',
    },
    {
      id: 'b-brilha',
      title: 'Brilha, Brilha Estrelinha',
      composer: 'Tradicional (Mozart, variações)',
      difficulty: 1,
      bpm: 100,
      right: 'C4:1 C4 G4 G4 A4 A4 G4:2 | F4:1 F4 E4 E4 D4 D4 C4:2 | G4:1 G4 F4 F4 E4 E4 D4:2 | G4:1 G4 F4 F4 E4 E4 D4:2 | C4:1 C4 G4 G4 A4 A4 G4:2 | F4:1 F4 E4 E4 D4 D4 C4:2',
      left: 'C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2 | C3:2 F3:2 | C3:2 G2:2 | C3:2 F3:2 | C3:2 G2:2 | C3:4 | F3:2 C3:2 | F3:2 C3:2 | G2:2 C3:2',
    },
    {
      id: 'b-ode',
      title: 'Ode à Alegria',
      composer: 'Ludwig van Beethoven',
      difficulty: 2,
      bpm: 112,
      right: 'E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 | D4:1 D4 E4 C4 | D4 E4:0.5 F4 E4:1 C4 | D4 E4:0.5 F4 E4:1 D4 | C4 D4 G3:2 | E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2',
      left: 'C3:4 | G2:4 | C3:4 | G2:4 | C3:4 | G2:4 | C3:4 | G2:2 C3:2 | G2:2 C3:2 | G2:2 C3:2 | G2:4 | C3:2 G2:2 | C3:4 | G2:4 | C3:4 | G2:2 C3:2',
    },
    {
      id: 'b-jingle',
      title: 'Jingle Bells',
      composer: 'James Lord Pierpont',
      difficulty: 2,
      bpm: 132,
      right: 'E4:1 E4 E4:2 | E4:1 E4 E4:2 | E4:1 G4 C4:1.5 D4:0.5 | E4:4 | F4:1 F4 F4:1.5 F4:0.5 | F4:1 E4 E4 E4:0.5 E4:0.5 | E4:1 D4 D4 E4 | D4:2 G4:2 | E4:1 E4 E4:2 | E4:1 E4 E4:2 | E4:1 G4 C4:1.5 D4:0.5 | E4:4 | F4:1 F4 F4 F4 | F4 E4 E4 E4:0.5 E4:0.5 | G4:1 G4 F4 D4 | C4:4',
      left: 'C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | F2+C3:4 | C3+G3:4 | G2+D3:4 | G2+D3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | F2+C3:4 | C3+G3:4 | G2+D3:4 | C3+G3:4',
    },
    {
      id: 'b-parabens',
      title: 'Parabéns pra Você',
      composer: 'Mildred & Patty Hill',
      difficulty: 2,
      bpm: 100,
      timeSig: 3,
      right: 'G4:0.75 G4:0.25 A4:1 G4:1 | C5:1 B4:2 | G4:0.75 G4:0.25 A4:1 G4:1 | D5:1 C5:2 | G4:0.75 G4:0.25 G5:1 E5:1 | C5:1 B4:1 A4:1 | F5:0.75 F5:0.25 E5:1 C5:1 | D5:1 C5:2',
      left: 'C3+G3:3 | G2+D3:3 | G2+D3:3 | C3+G3:3 | C3+G3:3 | F2+C3:3 | C3+G3:3 | G2+D3:1 C3+G3:2',
    },
    {
      id: 'b-minueto',
      title: 'Minueto em Sol',
      composer: 'Christian Petzold (atrib. J. S. Bach)',
      difficulty: 3,
      bpm: 120,
      timeSig: 3,
      right: 'D5:1 G4:0.5 A4 B4 C5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5 E5 F#5 | G5:1 G4:1 G4:1 | C5:1 D5:0.5 C5 B4 A4 | B4:1 C5:0.5 B4 A4 G4 | F#4:1 G4:0.5 A4 B4 G4 | A4:3 | D5:1 G4:0.5 A4 B4 C5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5 E5 F#5 | G5:1 G4:1 G4:1 | C5:1 D5:0.5 C5 B4 A4 | B4:1 C5:0.5 B4 A4 G4 | A4:1 B4:0.5 A4 G4 F#4 | G4:3',
      left: 'G3+B3:2 A3:1 | B3:3 | C4:3 | B3:3 | A3:3 | G3:3 | D4:1 B3:1 G3:1 | D4:1 D3:1 C4:1 | G3+B3:2 A3:1 | B3:3 | C4:3 | B3:3 | A3:3 | G3:3 | C4:1 D4:1 D3:1 | G3:2 G2:1',
    },
    {
      id: 'b-canon',
      title: 'Cânone em Ré',
      composer: 'Johann Pachelbel',
      difficulty: 3,
      bpm: 72,
      right: 'F#5:2 E5 D5 C#5 B4 A4 B4 C#5 | D5:2 C#5 B4 A4 G4 F#4 G4 E4 | D4:1 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4 | D5+F#5:2 C#5+E5 B4+D5 A4+C#5 G4+B4 F#4+A4 G4+B4 A4+C#5 | D4+F#4+A4+D5:4',
      left: repeat('D3+A3:2 A2+E3 B2+F#3 F#2+C#3 G2+D3 D2+A2 G2+D3 A2+E3', 4) + ' | D2+D3:4',
    },
    {
      id: 'b-rei-montanha',
      title: 'Na Gruta do Rei da Montanha',
      composer: 'Edvard Grieg',
      difficulty: 3,
      bpm: 110,
      tempos: [[0, 110], [32, 150]],
      right: kingPhrase(0) + ' | ' + kingPhrase(0) + ' | ' + kingPhrase(1) + ' | B4+D5+F#5+B5:2',
      left: repeat(kingLeft, 3) + ' | B1+B2:2',
    },
    {
      id: 'b-gymnopedie',
      title: 'Gymnopédie nº 1 (trecho)',
      composer: 'Erik Satie',
      difficulty: 3,
      bpm: 76,
      timeSig: 3,
      right: 'R:12 | R:1 F#5:1 A5:1 | G5 F#5 C#5 | B4 C#5 D5 | A4:3 | F#4:9 | R:3 | R:1 F#5:1 A5:1 | G5 F#5 C#5 | B4 C#5 D5 | A4:3 | R:3',
      left: genGymnopedie(17),
    },
    {
      id: 'b-fur-elise',
      title: 'Für Elise (tema)',
      composer: 'Ludwig van Beethoven',
      difficulty: 4,
      bpm: 144,
      timeSig: 3,
      pickup: 1,
      holdL: 1.5,
      right: 'E5:0.5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:1.5 C4:0.5 E4 A4 | B4:1.5 E4:0.5 G#4 B4 | C5:1.5 E4:0.5 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:1.5 C4:0.5 E4 A4 | B4:1.5 E4:0.5 C5 B4 | A4:2 E5:0.5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:1.5 C4:0.5 E4 A4 | B4:1.5 E4:0.5 G#4 B4 | C5:1.5 E4:0.5 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:1.5 C4:0.5 E4 A4 | B4:1.5 E4:0.5 C5 B4 | A4:3',
      left: 'R:1 | R:3 | ' + repeat('A2:0.5 E3 A3 R:1.5 | E2:0.5 E3 G#3 R:1.5 | A2:0.5 E3 A3 R:1.5 | R:3', 3) + ' | A2:0.5 E3 A3 R:1.5 | E2:0.5 E3 G#3 R:1.5 | A2:0.5 E3 A3 R:1.5',
    },
    {
      id: 'b-preludio',
      title: 'Prelúdio em Dó (BWV 846)',
      composer: 'Johann Sebastian Bach',
      difficulty: 4,
      bpm: 66,
      right: prelude.R,
      left: prelude.L,
    },
  ];

  const march = (pairs) => pairs.map(([r, f]) => r + ':1 ' + f + ' ' + r + ' ' + f).join(' | ');
  BUILTIN_DEFS.push(
    {
      id: 'b-do-re-mi-fa',
      title: 'Dó Ré Mi Fá',
      composer: 'Cantiga popular',
      difficulty: 1,
      bpm: 100,
      right: 'C4:0.5 D4 E4 F4 F4:1 F4:1 | C4:0.5 D4 C4 D4 D4:1 D4:1 | C4:0.5 G4 F4 E4 E4:1 E4:1 | C4:0.5 D4 E4 F4 F4:1 F4:1',
      left: 'C3:2 F2:2 | G2:4 | C3:4 | C3:2 F2:2',
    },
    {
      id: 'b-frei-martinho',
      title: 'Frei Martinho (Frère Jacques)',
      composer: 'Tradicional francesa',
      difficulty: 1,
      bpm: 112,
      right: 'C4:1 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4:1 F4 G4:2 | G4:0.5 A4 G4 F4 E4:1 C4:1 | G4:0.5 A4 G4 F4 E4:1 C4:1 | C4:1 G3 C4:2 | C4:1 G3 C4:2',
      left: 'C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:4 | C3+G3:2 G2+D3:2 | C3+G3:4',
    },
    {
      id: 'b-seu-lobato',
      title: 'Seu Lobato Tinha um Sítio',
      composer: 'Tradicional (Old MacDonald)',
      difficulty: 1,
      bpm: 120,
      right: 'G4:1 G4 G4 D4 | E4 E4 D4:2 | B4:1 B4 A4 A4 | G4:3 D4:1 | G4:1 G4 G4 D4 | E4 E4 D4:2 | B4:1 B4 A4 A4 | G4:4',
      left: 'G2+D3:4 | C3+G3:2 G2+D3:2 | G2+D3:2 D3+A3:2 | G2+D3:4 | G2+D3:4 | C3+G3:2 G2+D3:2 | G2+D3:2 D3+A3:2 | G2+D3:4',
    },
    {
      id: 'b-noite-feliz',
      title: 'Noite Feliz',
      composer: 'Franz Xaver Gruber',
      difficulty: 2,
      bpm: 150,
      timeSig: 6,
      right: 'G4:1.5 A4:0.5 G4:1 E4:3 | G4:1.5 A4:0.5 G4:1 E4:3 | D5:2 D5:1 B4:3 | C5:2 C5:1 G4:3 | A4:2 A4:1 C5:1.5 B4:0.5 A4:1 | G4:1.5 A4:0.5 G4:1 E4:3 | A4:2 A4:1 C5:1.5 B4:0.5 A4:1 | G4:1.5 A4:0.5 G4:1 E4:3 | D5:2 D5:1 F5:1.5 D5:0.5 B4:1 | C5:3 E5:3 | C5:1.5 G4:0.5 E4:1 G4:1.5 F4:0.5 D4:1 | C4:6',
      left: 'C3+G3:3 C3+G3 | C3+G3 C3+G3 | G2+D3 G2+D3 | C3+G3 C3+G3 | F2+C3 F2+C3 | C3+G3 C3+G3 | F2+C3 F2+C3 | C3+G3 C3+G3 | G2+D3 G2+D3 | C3+G3 C3+G3 | C3+G3 G2+D3 | C3+G3:6',
    },
    {
      id: 'b-saints',
      title: 'When the Saints Go Marching In',
      composer: 'Spiritual tradicional',
      difficulty: 2,
      bpm: 132,
      right: 'R:1 C4:1 E4 F4 | G4:4 | R:1 C4:1 E4 F4 | G4:4 | R:1 C4:1 E4 F4 | G4:2 E4:2 | C4:2 E4:2 | D4:4 | R:1 E4:1 E4 D4 | C4:3 C4:1 | E4:2 G4:1 G4:1 | F4:3 E4:0.5 F4:0.5 | G4:2 E4:2 | C4:2 D4:2 | C4:4',
      left: march([['C3', 'G3'], ['C3', 'G3'], ['C3', 'G3'], ['C3', 'G3'], ['C3', 'G3'], ['C3', 'G3'], ['C3', 'G3'], ['G2', 'D3'], ['C3', 'G3'], ['C3', 'G3'], ['C3', 'E3'], ['F2', 'C3'], ['C3', 'G3'], ['G2', 'D3']]) + ' | C3+G3:4',
    },
    {
      id: 'b-serenata',
      title: 'Pequena Serenata Noturna (início)',
      composer: 'Wolfgang Amadeus Mozart',
      difficulty: 3,
      bpm: 132,
      right: repeat('G4:1 R:0.5 D4:0.5 G4:1 R:0.5 D4:0.5 | G4:0.5 D4 G4 B4 D5:2 | C5:1 R:0.5 A4:0.5 C5:1 R:0.5 A4:0.5 | C5:0.5 A4 F#4 A4 D4:2', 2) + ' | G4+B4+D5:2 R:2',
      left: repeat('G3:1 R:0.5 D3:0.5 G3:1 R:0.5 D3:0.5 | G3:0.5 D3 G3 B3 D4:2 | C4:1 R:0.5 A3:0.5 C4:1 R:0.5 A3:0.5 | C4:0.5 A3 F#3 A3 D3:2', 2) + ' | G2+G3:2 R:2',
    }
  );

  // Categorias para os filtros da lista
  const CATS = {
    'b-escala-do': 'facil', 'b-mary': 'facil', 'b-brilha': 'facil', 'b-do-re-mi-fa': 'facil', 'b-frei-martinho': 'facil', 'b-seu-lobato': 'facil',
    'b-parabens': 'festa', 'b-jingle': 'festa', 'b-noite-feliz': 'festa', 'b-saints': 'festa',
  };
  for (const d of BUILTIN_DEFS) d.cat = CATS[d.id] || 'classica';

  const builtins = BUILTIN_DEFS.map((d) => makeSong(d));
  builtins.forEach((b, i) => (b.cat = BUILTIN_DEFS[i].cat));
  builtins.sort((a, b) => a.difficulty - b.difficulty || ({ facil: 0, festa: 1, classica: 2 }[a.cat] - { facil: 0, festa: 1, classica: 2 }[b.cat]));

  // ---------------------------------------------------------------------
  // Biblioteca do usuário (salva no navegador)
  function packSong(s) {
    return {
      id: s.id,
      title: s.title,
      composer: s.composer,
      difficulty: s.difficulty,
      bpm: s.bpm,
      tempos: s.tempos,
      timeSig: s.timeSig,
      pickup: s.pickup || 0,
      source: s.source,
      tags: s.tags,
      created: s.created || Date.now(),
      tr: s.tracks && s.tracks.length > 1 ? s.tracks : undefined,
      n: s.notes.map((n) => {
        const a = [n.midi, Math.round(n.time * 1000), Math.round(n.duration * 1000), Math.round((n.velocity || 0.8) * 127), n.hand === 'L' ? 1 : 0];
        if (n.track != null && s.tracks && s.tracks.length > 1) a.push(n.track);
        return a;
      }),
    };
  }
  function unpackSong(p) {
    return finalizeSong({
      id: p.id,
      title: p.title,
      composer: p.composer,
      difficulty: p.difficulty,
      bpm: p.bpm,
      tempos: p.tempos,
      timeSig: p.timeSig,
      pickup: p.pickup || 0,
      source: p.source,
      tags: p.tags || [],
      created: p.created,
      tracks: p.tr || undefined,
      notes: p.n.map((a) => ({ midi: a[0], time: a[1] / 1000, duration: a[2] / 1000, velocity: a[3] / 127, hand: a[4] ? 'L' : 'R', track: a.length > 5 ? a[5] : undefined })),
    });
  }

  const library = {
    user: (store.get('songs', []) || []).map((p) => {
      try {
        return unpackSong(p);
      } catch (e) {
        return null;
      }
    }).filter(Boolean),
    all() {
      return [...this.user.slice().sort((a, b) => (b.created || 0) - (a.created || 0)), ...builtins];
    },
    get(id) {
      return this.all().find((s) => s.id === id) || null;
    },
    find(q) {
      if (!q) return null;
      const s = String(q).toLowerCase();
      return this.get(q) || this.all().find((x) => x.title.toLowerCase() === s) || this.all().find((x) => x.title.toLowerCase().includes(s)) || null;
    },
    add(song) {
      song.created = song.created || Date.now();
      this.user = this.user.filter((s) => s.id !== song.id);
      this.user.push(song);
      const ok = this.save();
      bus.emit('library', song);
      return ok;
    },
    remove(id) {
      this.user = this.user.filter((s) => s.id !== id);
      this.save();
      bus.emit('library');
    },
    save() {
      const ok = store.set('songs', this.user.map(packSong));
      if (!ok) bus.emit('toast', 'Espaço do navegador cheio: a música funciona agora, mas pode não ficar salva.', 'warn');
      return ok;
    },
  };

  /** Converte o resultado do parser MIDI em música da biblioteca. */
  function songFromMidi(parsed, fileName) {
    PN.midi.assignHands(parsed.notes, parsed.tracks);
    const title = (fileName || '').replace(/\.(mid|midi|kar|rmi)$/i, '').replace(/[_-]+/g, ' ').trim() || parsed.name || 'Música MIDI';
    const nps = parsed.notes.length / Math.max(1, parsed.duration);
    return finalizeSong({
      id: 'u-' + util.uid(),
      title,
      composer: parsed.name && parsed.name !== title ? parsed.name : '',
      difficulty: util.clamp(Math.round(nps / 1.6), 1, 5),
      bpm: parsed.bpm,
      timeSig: 4,
      source: 'midi',
      tags: ['midi'],
      tracks: (parsed.tracks || []).map((t) => ({ index: t.index, name: t.name, instrument: t.instrument || '', noteCount: t.noteCount, avgPitch: Math.round(t.avgPitch) })),
      notes: parsed.notes.map((n) => ({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity, hand: n.hand, track: n.track })),
    });
  }

  PN.songs = { builtins, library, parseNotation, makeSong, parseVPSheet, vpCharToMidi, songFromMidi, finalizeSong, VP_WHITE };
})();

/* Conversões tempo ⇄ batida usadas pelos visualizadores e metrônomo */
(function () {
  'use strict';
  const PN = window.PN;
  function beatsFromSong(song, bpmFallback) {
    const tempos = song && song.tempos && song.tempos.length ? song.tempos : [[0, (song && song.bpm) || bpmFallback || 100]];
    const segs = [];
    let sec = 0;
    for (let i = 0; i < tempos.length; i++) {
      if (i > 0) sec += ((tempos[i][0] - tempos[i - 1][0]) * 60) / tempos[i - 1][1];
      segs.push({ beat: tempos[i][0], sec, bpm: tempos[i][1] });
    }
    return {
      beatAt(t) {
        let s = segs[0];
        for (let i = 1; i < segs.length && segs[i].sec <= t; i++) s = segs[i];
        return s.beat + ((t - s.sec) * s.bpm) / 60;
      },
      timeAt(b) {
        let s = segs[0];
        for (let i = 1; i < segs.length && segs[i].beat <= b; i++) s = segs[i];
        return s.sec + ((b - s.beat) * 60) / s.bpm;
      },
      bpmAt(t) {
        let s = segs[0];
        for (let i = 1; i < segs.length && segs[i].sec <= t; i++) s = segs[i];
        return s.bpm;
      },
    };
  }
  PN.songs.beatsFromSong = beatsFromSong;
})();
