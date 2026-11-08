/* pianeon — importação de arquivos: reconhece o conteúdo (não só a extensão),
   lê MIDI, MusicXML (.musicxml/.xml/.mxl), .zip com MIDI dentro e partituras de letras (.txt) */
(function () {
  'use strict';
  const PN = window.PN;
  const { util } = PN;

  class ImportError extends Error {}

  /** Descobre o que o arquivo realmente é olhando os primeiros bytes. */
  function sniff(buf) {
    const u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096));
    const asc = (i, n) => String.fromCharCode.apply(null, u8.subarray(i, i + n));
    // "MThd" pode vir depois de um cabeçalho extra (ex.: MacBinary)
    for (let i = 0; i + 4 <= u8.length; i++) {
      if (u8[i] === 0x4d && u8[i + 1] === 0x54 && u8[i + 2] === 0x68 && u8[i + 3] === 0x64) return { kind: 'midi', offset: i };
    }
    if (asc(0, 4) === 'RIFF' && asc(8, 4) === 'RMID') return { kind: 'midi', offset: 0 };
    if (asc(0, 4) === 'RIFF' && asc(8, 4) === 'WAVE') return { kind: 'audio' };
    if (asc(0, 3) === 'ID3' || (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) || asc(0, 4) === 'OggS' || asc(0, 4) === 'fLaC' || asc(4, 4) === 'ftyp') return { kind: 'audio' };
    if (asc(0, 2) === 'PK') return { kind: 'zip' };
    if (asc(0, 4) === '%PDF') return { kind: 'pdf' };
    const text = new TextDecoder('utf-8', { fatal: false }).decode(u8).replace(/^﻿/, '').trimStart();
    if (/score-(partwise|timewise)/.test(text)) return { kind: 'musicxml' };
    if (/^<(!doctype html|html|head|body|meta|script|!--)/i.test(text) || /<html[\s>]/i.test(text)) return { kind: 'html' };
    if (/^<\?xml/i.test(text)) return { kind: 'xml' };
    if (text && !/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 400))) return { kind: 'text' };
    return { kind: 'unknown' };
  }

  // ------------------------------------------------------------------ zip (.mxl / .zip)
  async function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ImportError('O arquivo compactado está danificado.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let k = 0; k < count && p + 46 <= u8.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files.set(name, { method, data: u8.subarray(start, start + csize) });
    }
    return {
      names: [...files.keys()],
      async read(name) {
        const f = files.get(name);
        if (!f) throw new ImportError('Arquivo não encontrado dentro do zip.');
        if (f.method === 0) return f.data;
        if (f.method === 8 && typeof DecompressionStream !== 'undefined') {
          const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new ImportError('Este navegador não consegue abrir esse arquivo compactado. Tente no Chrome ou no Edge.');
      },
    };
  }

  // ------------------------------------------------------------------ MusicXML
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function parseMusicXML(xmlText, fallbackTitle) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new ImportError('A partitura (MusicXML) está danificada.');
    const root = doc.documentElement;
    if (root.nodeName === 'score-timewise') throw new ImportError('Esse MusicXML está no formato "timewise", que ainda não é aceito. Exporte de novo como MusicXML normal.');
    const q = (el, sel) => {
      const x = el.querySelector(sel);
      return x ? x.textContent.trim() : '';
    };
    const title = q(root, 'work > work-title') || q(root, 'movement-title') || fallbackTitle;
    const composerEl = root.querySelector('identification > creator[type="composer"]');
    const composer = composerEl ? composerEl.textContent.trim() : '';

    const tempos = [];
    let timeSig = 4;
    const parts = [...root.children].filter((c) => c.nodeName === 'part');
    const partNotes = parts.map((part, pi) => {
      let divisions = 1;
      let cursor = 0; // em tempos (semínimas)
      let lastStart = 0;
      const notes = [];
      const ties = new Map();
      for (const measure of part.children) {
        if (measure.nodeName !== 'measure') continue;
        for (const el of measure.children) {
          const dur = () => Number(q(el, 'duration') || 0) / divisions;
          switch (el.nodeName) {
            case 'attributes': {
              const d = q(el, 'divisions');
              if (d) divisions = Number(d) || 1;
              const beats = Number(q(el, 'time > beats'));
              const type = Number(q(el, 'time > beat-type'));
              if (pi === 0 && beats && type && !notes.length) timeSig = Math.max(1, Math.round((beats * 4) / type));
              break;
            }
            case 'direction':
            case 'sound': {
              const s = el.nodeName === 'sound' ? el : el.querySelector('sound[tempo]');
              const t = s && Number(s.getAttribute('tempo'));
              if (pi === 0 && t > 0) tempos.push([cursor, t]);
              break;
            }
            case 'backup':
              cursor -= dur();
              break;
            case 'forward':
              cursor += dur();
              break;
            case 'note': {
              const isChord = !!el.querySelector('chord');
              const isGrace = !!el.querySelector('grace');
              const d = isGrace ? 0 : dur();
              const start = isChord ? lastStart : cursor;
              if (!isChord) {
                lastStart = cursor;
                cursor += d;
              }
              if (el.querySelector('rest') || isGrace || !el.querySelector('pitch')) break;
              const step = q(el, 'pitch > step');
              const midi = (Number(q(el, 'pitch > octave')) + 1) * 12 + (STEP[step] || 0) + Math.round(Number(q(el, 'pitch > alter') || 0));
              if (!(midi >= 0 && midi <= 127)) break;
              const staff = Number(q(el, 'staff') || 1);
              const tieTypes = [...el.querySelectorAll('tie')].map((t) => t.getAttribute('type'));
              const key = midi + ':' + staff;
              if (tieTypes.includes('stop') && ties.has(key)) {
                ties.get(key).beats += d;
                if (!tieTypes.includes('start')) ties.delete(key);
                break;
              }
              const n = { midi, beat: start, beats: Math.max(0.05, d), staff };
              notes.push(n);
              if (tieTypes.includes('start')) ties.set(key, n);
              break;
            }
          }
        }
      }
      return notes;
    });

    // mãos: pauta 1 = direita, 2 = esquerda; várias partes: a mais aguda é a direita
    const R = [];
    const L = [];
    const withNotes = partNotes.map((n, i) => ({ n, i })).filter((x) => x.n.length);
    if (!withNotes.length) throw new ImportError('A partitura não tem notas.');
    const twoStaves = withNotes.some((x) => x.n.some((n) => n.staff >= 2));
    if (twoStaves) {
      for (const { n } of withNotes) for (const x of n) (x.staff >= 2 ? L : R).push(x);
    } else if (withNotes.length > 1) {
      const avg = (arr) => arr.reduce((s, x) => s + x.midi, 0) / arr.length;
      const top = withNotes.slice().sort((a, b) => avg(b.n) - avg(a.n))[0].i;
      for (const { n, i } of withNotes) for (const x of n) (i === top ? R : L).push(x);
    } else {
      for (const x of withNotes[0].n) (x.midi >= 60 ? R : L).push(x);
    }
    tempos.sort((a, b) => a[0] - b[0]);
    const cleanTempos = [];
    for (const t of tempos) if (!cleanTempos.length || cleanTempos[cleanTempos.length - 1][1] !== t[1]) cleanTempos.push(t);
    const bpm = cleanTempos.length ? cleanTempos[0][1] : 100;
    const song = PN.songs.makeSong({
      title,
      composer,
      bpm,
      tempos: cleanTempos.length ? cleanTempos : null,
      timeSig,
      right: R,
      left: L,
      source: 'musicxml',
      tags: ['partitura'],
    });
    const nps = song.notes.length / Math.max(1, song.duration);
    song.difficulty = util.clamp(Math.round(nps / 1.6), 1, 5);
    return song;
  }

  // ------------------------------------------------------------------ entrada principal
  const baseName = (name) => String(name || 'Música').replace(/\.(mid|midi|kar|rmi|musicxml|mxl|xml|zip|txt)$/i, '');

  /** Recebe o conteúdo de um arquivo e devolve uma música pronta (ou um erro com explicação). */
  async function songFromFile(buf, name) {
    name = name || 'arquivo';
    const s = sniff(buf);
    switch (s.kind) {
      case 'midi': {
        const b = s.offset ? buf.slice(s.offset) : buf;
        let parsed;
        try {
          parsed = PN.midi.parseMidi(b);
        } catch (e) {
          throw new ImportError('"' + name + '" parece MIDI, mas está danificado ou incompleto. Tente baixar de novo.');
        }
        if (!parsed.notes.length) throw new ImportError('"' + name + '" não tem notas de piano (pode ser só bateria ou estar vazio).');
        return PN.songs.songFromMidi(parsed, name);
      }
      case 'musicxml':
        return parseMusicXML(new TextDecoder().decode(buf), baseName(name));
      case 'zip': {
        const z = await unzip(buf);
        const midiName = z.names.find((n) => /\.(mid|midi|kar)$/i.test(n) && !n.startsWith('__MACOSX'));
        if (midiName) {
          const data = await z.read(midiName);
          return songFromFile(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), midiName.split('/').pop());
        }
        if (z.names.some((n) => /\.mscx$/i.test(n)))
          throw new ImportError('"' + name + '" é um arquivo do programa MuseScore. Abra no MuseScore e use Arquivo → Exportar → MIDI (ou MusicXML), depois traga esse arquivo.');
        let xmlName = null;
        if (z.names.includes('META-INF/container.xml')) {
          const c = new TextDecoder().decode(await z.read('META-INF/container.xml'));
          const m = /full-path="([^"]+)"/.exec(c);
          if (m) xmlName = m[1];
        }
        xmlName = xmlName || z.names.find((n) => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF'));
        if (!xmlName) throw new ImportError('Dentro de "' + name + '" não tem MIDI nem partitura.');
        return parseMusicXML(new TextDecoder().decode(await z.read(xmlName)), baseName(name));
      }
      case 'html':
        throw new ImportError('"' + name + '" não é a música: é uma página da internet salva com esse nome. Isso acontece quando o site pede login ou mostra um anúncio antes. Volte ao site e use o botão de baixar o MIDI.');
      case 'audio':
        throw new ImportError('"' + name + '" é um arquivo de áudio (som gravado). Aqui entram arquivos que guardam as notas: MIDI (.mid) ou MusicXML. Procure a versão MIDI da música.');
      case 'pdf':
        throw new ImportError('"' + name + '" é um PDF (imagem da partitura) e não dá para ler as notas. Procure a versão MIDI ou MusicXML.');
      case 'text': {
        const text = new TextDecoder().decode(buf);
        if (/\.txt$/i.test(name)) {
          const song = PN.songs.parseVPSheet(text, { title: baseName(name) });
          if (song.notes.length) return song;
        }
        throw new ImportError('"' + name + '" é um arquivo de texto, não MIDI. Se for uma partitura de letras, cole na caixa "Partitura de letras".');
      }
      default:
        throw new ImportError('Não reconheci "' + name + '" como MIDI. Confira se é mesmo um arquivo .mid.');
    }
  }

  PN.importers = { sniff, songFromFile, parseMusicXML, unzip, ImportError };
})();
