import { $, engine, addHistory, loadHistory, releaseMicForPlayback } from './core.js';
import { quizPair } from './note-names.js';
let round = null;
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function openReading() {
  const last = loadHistory().filter(e => e.type === 'reading').at(-1);
  $('#read-last').textContent = last ? `上次：首次答对 ${last.correct}/14 · 平均每题 ${last.averageSeconds} 秒` : '每天一轮，先答准，再逐渐加快。';
}
export function closeReading() {
  round = null;
  $('#read-start').hidden = false;
  $('#read-listen').hidden = $('#read-next').hidden = true;
  $('#read-answers').replaceChildren();
  $('#read-key').disabled = $('#read-direction').disabled = false;
}
$('#read-start').onclick = () => {
  const key = $('#read-key').value, direction = $('#read-direction').value;
  const pairs = Array.from({ length: 7 }, (_, i) => quizPair(i, key === 'G' ? 67 : 60, key === 'fixed'));
  round = { key, direction, pairs, queue: [...shuffle(pairs), ...shuffle(pairs)], index: 0, correct: 0, times: [], mistakes: new Set() };
  $('#read-key').disabled = $('#read-direction').disabled = true;
  $('#read-start').hidden = true;
  $('#read-summary').textContent = '';
  ask();
};
function ask() {
  const r = round;
  r.current = r.queue[r.index]; r.reverse = r.direction === 'reverse' || (r.direction === 'mixed' && r.index % 2 === 1);
  r.tried = false; r.answered = false; r.started = performance.now();
  $('#read-progress').textContent = `第 ${r.index + 1} / 14 题`;
  $('#read-question').textContent = r.reverse ? r.current.sol : r.current.name;
  $('#read-prompt').textContent = r.reverse ? '它的音名是？' : '它的唱名是？';
  $('#read-feedback').textContent = '';
  $('#read-listen').hidden = $('#read-next').hidden = true;
  $('#read-answers').replaceChildren(...r.pairs.map(pair => {
    const button = document.createElement('button'); button.className = 'btn';
    button.textContent = r.reverse ? pair.name : pair.sol;
    button.onclick = () => answer(pair, button); return button;
  }));
}
function answer(pair, button) {
  const r = round;
  if (!r || r.answered) return;
  if (pair.midi !== r.current.midi) {
    r.tried = true; r.mistakes.add(r.current.name); button.disabled = true;
    $('#read-feedback').textContent = '还没对应上，再想一下。'; return;
  }
  r.answered = true; if (!r.tried) r.correct++;
  r.times.push((performance.now() - r.started) / 1000);
  $('#read-feedback').textContent = `${r.current.name} ↔ ${r.current.sol}${r.tried ? ' · 记住这一对' : ' · 答对了'}`;
  $('#read-listen').hidden = $('#read-next').hidden = false;
  $('#read-next').textContent = r.index === 13 ? '查看结果' : '下一题';
  $('#read-next').focus();
}
$('#read-listen').onclick = async () => {
  const r = round; if (!r?.answered) return;
  releaseMicForPlayback('（认音练习只播放）'); await engine.unlock();
  if (round === r) engine.pluck(r.current.midi);
};
$('#read-next').onclick = () => {
  const r = round; if (!r?.answered) return;
  if (++r.index < 14) { ask(); return; }
  const averageSeconds = +(r.times.reduce((a, b) => a + b, 0) / 14).toFixed(1);
  addHistory({ type: 'reading', name: '音名与唱名', key: r.key, direction: r.direction, correct: r.correct, averageSeconds, mistakes: [...r.mistakes] });
  $('#read-summary').textContent = `首次答对 ${r.correct}/14 · 平均每题 ${averageSeconds} 秒（含改答时间）。${r.mistakes.size ? '再记一遍：' + r.pairs.filter(p => r.mistakes.has(p.name)).map(p => p.name + ' ↔ ' + p.sol).join('，') : '全部一次答对！'}`;
  $('#read-question').textContent = '完成'; $('#read-progress').textContent = '14 / 14';
  $('#read-prompt').textContent = '休息一下，也可以再来一轮。'; $('#read-feedback').textContent = '';
  closeReading(); openReading();
};
