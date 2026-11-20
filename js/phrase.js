// Bar zero is a pickup. A four-bar practice range is a convenient default;
// users can isolate its difficult bar and then lead in from the previous bar.
import { centsBetween, midiToFreq, snapCents, pitchWindowVerdict, matchOnsets } from './dsp.js';

export const barLabel = bar => bar === 0 ? '弱起' : '第 ' + bar + ' 小节';
export function rangeLabel(range) {
  if (!range) return '整首';
  const [a, b] = range;
  return a === b ? barLabel(a) : (a === 0 ? '弱起至第 ' : '第 ' + a + '–') + b + ' 小节';
}
export function annotate(notes, beats, pickup = 0) {
  return notes.map(n => ({ ...n, bar: Math.floor((n.start - pickup) / beats) + 1 }));
}
export function phrases(notes, pickup) {
  const last = notes.at(-1).bar;
  const ranges = [];
  for (let bar = 1; bar <= Math.max(1, last); bar += 4) {
    const range = [bar === 1 && pickup ? 0 : bar, Math.min(bar + 3, last)];
    if (notes.some(n => n.midi !== null && n.bar >= range[0] && n.bar <= range[1])) ranges.push(range);
  }
  return ranges;
}
export function sliceRange(notes, range, beats, pickup) {
  if (!range) return notes;
  const start = range[0] <= 0 ? 0 : pickup + (range[0] - 1) * beats;
  const end = pickup + range[1] * beats;
  return notes.filter(n => n.bar >= range[0] && n.bar <= range[1])
    .map(n => ({ ...n, start: n.start - start, beats: Math.min(n.beats, end - n.start) }));
}

// All times are on the microphone clock. One picked attack can serve only one
// score note. Once another attack starts, its pitch belongs to the new event.
export function reviewPhrase(notes, frames, onsets, { t0, spb, latencyMs, tolCents, octaveFree, a4 }) {
  const starts = notes.map(n => t0 + n.start * spb);
  const match = matchOnsets(onsets, starts, { latencyMs, windowMs: 150 });
  const latency = latencyMs / 1000;
  let cursor = 0;
  const rows = notes.map((n, i) => {
    const attack = match.hits[i];
    const start = attack?.onset ?? starts[i] + latency;
    const nextAttack = onsets.find(t => t > start + 0.001);
    const end = Math.min(start + n.beats * spb, (starts[i + 1] ?? Infinity) + latency, nextAttack ?? Infinity);
    while (cursor < frames.length && frames[cursor].time < start + 0.015) cursor++;
    const observed = [];
    for (let j = cursor; j < frames.length && frames[j].time < end; j++) observed.push(frames[j]);
    const freq = midiToFreq(n.midi, a4);
    const cents = observed.filter(f => f.raw).map(f => snapCents(centsBetween(f.raw, freq), octaveFree));
    const { reason, good, need } = pitchWindowVerdict(cents, observed.length, tolCents);
    // For a pitch change hidden under the previous string, require a stable
    // new pitch AND earlier voiced evidence at a genuinely different pitch.
    const before = frames[cursor - 1];
    let streak = 0, changed = false, different = before?.raw && Math.abs(centsBetween(before.raw, freq)) > 80;
    for (const f of observed) {
      if (f.raw && Math.abs(centsBetween(f.raw, freq)) > 80) different = true;
      streak = f.raw && Math.abs(centsBetween(f.raw, freq)) <= tolCents ? streak + 1 : 0;
      if (different && streak >= 3) changed = true;
    }
    const recovered = !attack && i > 0 && notes[i - 1].midi !== n.midi && changed && reason === 'hit';
    let outcome;
    if (attack) outcome = reason === 'hit' ? 'hit' : reason === 'off_pitch' ? 'wrong' : 'unclear';
    else if (recovered) outcome = 'hit';
    else outcome = observed.length >= 2 && observed.every(f => f.status === 'below_gate') ? 'missing' : 'unclear';
    return { bar: n.bar, note: n.name, previous: notes[i - 1]?.name ?? null, string: n.string, fret: n.fret,
      outcome, recovered, cents: good.length ? good.reduce((a,b) => a + b, 0) / good.length : null, errorMs: attack ? Math.round(attack.errorMs) : null, onset: attack?.onset ?? null,
      observed: observed.length, voiced: cents.length, good: good.length, need };
  });
  const count = key => rows.filter(r => r.outcome === key).length;
  const hits = count('hit'), wrong = count('wrong'), missing = count('missing'), unclear = count('unclear');
  const judged = hits + wrong + missing;
  // A disconnected or silent take cannot establish that the player missed every note.
  const pitch = judged >= Math.ceil(rows.length / 2) && (hits + wrong > 0) ? hits / judged : null;
  return { rows, hits, wrong, missing, unclear, pitch, match };
}

export function difficulty(rows) {
  const weight = r => r.outcome === 'wrong' || r.outcome === 'missing' ? 2 :
    r.outcome === 'retry' ? 1 : r.errorMs !== null && Math.abs(r.errorMs) >= 45 ? 1 : 0;
  const totals = new Map();
  for (const r of rows) if (weight(r)) totals.set(r.bar, (totals.get(r.bar) || 0) + weight(r));
  const bar = [...totals].sort((a,b) => b[1] - a[1])[0]?.[0];
  return rows.filter(r => r.bar === bar && weight(r)).sort((a,b) => weight(b) - weight(a))[0] ?? null;
}
