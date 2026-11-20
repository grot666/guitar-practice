import { $, $$, esc } from './core.js';
import { ARRANGE } from './harmony.js';
import { pitchLabels, durationMark, notationTokens } from './note-names.js';
export const melodyTonic = song => ARRANGE[song.id]?.key === 'G' ? 67 : 60;
let previous = null;
export function renderMelody(state) {
  $('#p-score').hidden = state.drill; previous = null;
  if (state.drill) return;
  const tonic = melodyTonic(state.song);
  $('#p-score-key').textContent = `1 = ${tonic === 67 ? 'G' : 'C'} · ${state.song.beats}/4 · 唱名：固定调 C=do`;
  let bar = null;
  const pickup = state.song.pickup || 0;
  const offset = state.range?.[0] > 0 ? pickup + (state.range[0] - 1) * state.song.beats : 0;
  $('#p-score-notes').innerHTML = notationTokens(state.notes, state.song.beats, pickup, offset).map(n => {
    const label = n.midi === null ? { number: '0', octave: 0, name: '休止', fixed: '' } : pitchLabels(n.midi, tonic);
    const duration = durationMark(n.beats), newBar = bar !== n.bar; bar = n.bar;
    return `<span class="score-note${newBar ? ' bar-start' : ''}" data-start="${n.start}" data-end="${n.start + n.beats}" aria-label="${esc(label.name)} ${esc(label.fixed)}，${n.beats} 拍">
      <small class="score-bar">${newBar ? n.bar === 0 ? '弱起' : n.bar : '&nbsp;'}</small>
      <span class="score-octave">${n.tied ? '<span class="score-tie" title="延续前音，不重新拨弦">⌒</span>' : ''}${'·'.repeat(Math.max(0, label.octave))}</span>
      <span class="score-number"><b class="lines-${duration.lines}">${label.number}</b>${duration.dot ? '·' : ''}${' −'.repeat(duration.dashes)}</span>
      <span class="score-octave">${'·'.repeat(Math.max(0, -label.octave))}</span>
      <span class="score-name">${esc(label.name)}</span><small class="score-sol">${esc(label.fixed)}</small>
    </span>`;
  }).join('');
}
export function markMelody(position) {
  let current = null;
  $$('#p-score-notes .score-note').forEach(el => {
    const active = position >= +el.dataset.start && position < +el.dataset.end;
    el.classList.toggle('current', active); if (active) current = el;
  });
  if (current && current !== previous) {
    const parent = $('#p-score-notes');
    parent.scrollLeft = Math.max(0, current.offsetLeft - parent.offsetLeft - parent.clientWidth / 3);
  }
  previous = current;
}
