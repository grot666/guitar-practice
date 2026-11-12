// fretboard.js — 第一把位指板 SVG（上 = 1 弦，和六线谱一致）
import { OPEN_MIDI } from './songs.js';
import { midiName } from './dsp.js';

const NUT = 38, FW = 44, Y0 = 12, SG = 16;
export const FRETS = 5;
const W = NUT + FW * FRETS + 6, H = Y0 + SG * 5 + 20;
const sy = (s) => Y0 + (s - 1) * SG;
const fx = (f) => (f === 0 ? NUT - 15 : NUT + (f - 0.5) * FW);

/** 画指板。opts: {names: 每格显示音名, onPick(string, fret)} */
export function drawBoard(svg, opts = {}) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let s = `<rect class="fb-wood" x="${NUT}" y="${Y0 - 6}" width="${FW * FRETS}" height="${SG * 5 + 12}" rx="4"/>`;
  for (const f of [3, 5]) if (f <= FRETS) s += `<circle cx="${fx(f)}" cy="${Y0 + SG * 2.5}" r="3.5" fill="var(--line)" stroke="none"/>`;
  for (let f = 1; f <= FRETS; f++) s += `<line class="fb-fret" x1="${NUT + f * FW}" y1="${Y0 - 6}" x2="${NUT + f * FW}" y2="${Y0 + SG * 5 + 6}"/>`;
  s += `<line class="fb-nut" x1="${NUT}" y1="${Y0 - 7}" x2="${NUT}" y2="${Y0 + SG * 5 + 7}"/>`;
  for (let st = 1; st <= 6; st++) s += `<line class="fb-str" style="stroke-width:${0.8 + st * 0.25}" x1="${NUT - 24}" y1="${sy(st)}" x2="${W - 2}" y2="${sy(st)}"/>`;
  for (let f = 1; f <= FRETS; f++) s += `<text class="fb-num" x="${fx(f)}" y="${H - 3}">${f}</text>`;
  s += `<text class="fb-num" x="${fx(0)}" y="${H - 3}">空</text>`;
  for (let st = 1; st <= 6; st++) s += `<text class="fb-lab" x="7" y="${sy(st) + 3}">${st}</text>`;
  if (opts.names) {
    for (let st = 1; st <= 6; st++) for (let f = 0; f <= FRETS; f++) {
      const n = midiName(OPEN_MIDI[st] + f).replace(/\d+$/, '');
      s += `<circle cx="${fx(f)}" cy="${sy(st)}" r="7" fill="var(--card)" stroke="var(--line)"/>` + `<text class="fb-name" x="${fx(f)}" y="${sy(st) + 3}">${n}</text>`;
    }
  }
  if (opts.onPick) for (let st = 1; st <= 6; st++) for (let f = 0; f <= FRETS; f++)
    s += `<rect class="fb-cell" data-s="${st}" data-f="${f}" x="${f === 0 ? 0 : NUT + (f - 1) * FW}" y="${sy(st) - SG / 2}" width="${f === 0 ? NUT : FW}" height="${SG}"/>`;
  s += `<g class="fb-marks"></g>`;
  svg.innerHTML = s;
  if (opts.onPick) svg.onclick = (e) => { const c = e.target.closest('.fb-cell'); if (c) opts.onPick(+c.dataset.s, +c.dataset.f); };
}

/** 标出当前位置（实心）和下一个位置（虚线） */
export function markBoard(svg, cur, next, label = true) {
  const g = svg.querySelector('.fb-marks'); if (!g) return;
  let s = '';
  if (next && !(cur && next.string === cur.string && next.fret === cur.fret)) s += `<circle class="fb-dot next" cx="${fx(next.fret)}" cy="${sy(next.string)}" r="7"/>`;
  if (cur) {
    if (cur.fret === 0) s += `<circle class="fb-dot open" cx="${fx(0)}" cy="${sy(cur.string)}" r="7.5"/><line x1="${NUT}" y1="${sy(cur.string)}" x2="${W - 2}" y2="${sy(cur.string)}" stroke="var(--accent)" stroke-width="3" opacity=".55"/>`;
    else s += `<circle class="fb-dot" cx="${fx(cur.fret)}" cy="${sy(cur.string)}" r="8"/>` + (label ? `<text class="fb-txt" x="${fx(cur.fret)}" y="${sy(cur.string) + 3.2}">${cur.fret}</text>` : '');
  }
  g.innerHTML = s;
}

/** 标出一个和弦按法，shape 为 6 弦 → 1 弦，例如 'x32010'；x = 不弹，0 = 空弦 */
export function markShape(svg, shape) {
  const g = svg.querySelector('.fb-marks'); if (!g) return;
  let s = '';
  [...shape].forEach((ch, i) => {
    const st = 6 - i;
    if (ch === 'x') s += `<text class="fb-x" x="${fx(0)}" y="${sy(st) + 3.5}">×</text>`;
    else if (ch === '0') s += `<circle class="fb-dot open" cx="${fx(0)}" cy="${sy(st)}" r="6"/>`;
    else s += `<circle class="fb-dot" cx="${fx(+ch)}" cy="${sy(st)}" r="7"/>`;
  });
  g.innerHTML = s;
}
