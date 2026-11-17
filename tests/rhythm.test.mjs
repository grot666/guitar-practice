// 节奏训练：节奏型时间、匹配、统计、速度阶梯、间歇规则
import { METERS, PATTERNS, patternsFor, barHits, gridCells, expectedForBar, minGapBeats, posLabel, matchHits, RhythmSession, diagnose, TempoLadder, clickOn, gradeHit } from '../js/rhythm.js';
import { rng } from './synth.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const P = (id) => PATTERNS.find((p) => p.id === id);

console.log('== 1. 节奏型：每个拍号都放得下、位置正确');
{
  let n = 0;
  for (const m of Object.keys(METERS)) for (const p of patternsFor(m)) {
    const h = barHits(p, m); n++;
    ok(h.length === (METERS[m].beats / p.cell) * p.hits.length, `${p.id}@${m} 音数`);
    ok(h.every((x, i) => i === 0 || x.at > h[i - 1].at), `${p.id}@${m} 严格递增`);
    ok(h.every((x) => x.at >= 0 && x.at < METERS[m].beats), `${p.id}@${m} 在小节内`);
    const cells = gridCells(p, m);
    ok(cells.length === METERS[m].beats * p.res && cells.filter((c) => c.on).length === h.length, `${p.id}@${m} 记谱格子能表示每个音`);
  }
  for (const m of Object.keys(METERS)) ok(patternsFor(m).length >= 3, `${m} 至少 3 个节奏型`);
  console.log(`  ${n} 个 节奏型×拍号 组合`);
  const folk = barHits(P('folk'), '4/4').map((x) => x.at + ':' + x.dir).join(' ');
  ok(folk === '0:D 1:D 1.5:U 2.5:U 3:D 3.5:U', '民谣扫弦 下 下上 上下上 = ' + folk);
  ok(barHits(P('syn'), '4/4').map((x) => x.at).join() === '0,0.5,1.5,2,2.5,3.5', '切分 8-4-8 两次');
  ok(barHits(P('dot'), '3/4').map((x) => x.at).join() === '0,0.75,1,1.75,2,2.75', '附点八分+十六分');
  ok(barHits(P('t'), '2/4').length === 6 && near(barHits(P('t'), '2/4')[4].at, 4 / 3, 1e-6), '三连音');
  ok(barHits(P('cls'), '6/8').map((x) => Math.round(x.at * 3)).join() === '0,2,3,5', '6/8 长-短 = 第 1、3、4、6 个八分');
  ok(barHits(P('off'), '4/4').every((x) => x.at % 1 === 0.5), '反拍只在后半拍');
  let threw = false; try { barHits(P('folk'), '3/4'); } catch { threw = true; } ok(threw, '放不下的拍号报错');
  // 期望时间
  const e = expectedForBar(P('e'), '4/4', 10, 0.5);
  ok(e.length === 8 && near(e[3].t, 10.75) && near(e[7].t, 11.75), '八分 @120BPM 的期望时间');
  const e68 = expectedForBar(P('c8'), '6/8', 2, 0.9);
  ok(e68.length === 6 && near(e68[1].t, 2.3, 1e-5) && near(e68[3].t, 2.9, 1e-5), '6/8：一大拍 0.9 s，八分 0.3 s');
  ok(near(minGapBeats(P('dot'), '4/4'), 0.25) && near(minGapBeats(P('rest'), '4/4'), 2) && near(minGapBeats(P('off'), '2/4'), 1), '最小间隔（含跨小节）');
  ok(posLabel(1.5, '4/4') === '第 2 拍后半' && posLabel(2 / 3, '3/4') === '第 1 拍三连第 3 个' && posLabel(1, '6/8') === '第 4 个八分', '位置名称');
}

console.log('== 2. 匹配：最近的期望点、一对一、漏拍、多弹');
{
  const exp = [1, 1.5, 2, 2.5];
  const m = matchHits([1.02, 1.49, 1.53, 2.6, 3.4], exp, 0.2);
  ok(near(m.hits[0].errMs, 20, 1e-6) && near(m.hits[1].errMs, -10, 1e-6), '近的配近的');
  ok(m.hits[2] === null || m.hits[2].onset !== 1.53 || true, '');
  ok(m.extras.includes(3.4), '窗口外 = 多弹');
  ok(m.hits.filter(Boolean).length === 4 - m.hits.filter((h) => !h).length, '');
  // 1.53 不能同时给 1.5 和 2：1.5 已经被 1.49 占了，2 离 1.53 有 470ms > 窗口 → 多弹
  ok(m.extras.includes(1.53) && m.hits[2] === null, '一个期望点只配一个击打，另一个算多弹');
  ok(near(m.hits[3].errMs, 100, 1e-6), '2.6 配 2.5（晚 100ms）');
  ok(gradeHit(25) === 'green' && gradeHit(-45) === 'yellow' && gradeHit(80) === 'red' && gradeHit(50, { green: 20, yellow: 40 }) === 'red', '分级 + 可调容差');
}

console.log('== 3. 训练会话：实时反馈 + 小节结算');
{
  const s = new RhythmSession({ pattern: P('e'), meter: '4/4', tol: { green: 30, yellow: 60 } });
  const beat = 1; // 60 BPM：八分间隔 0.5 s，窗口取上限 150 ms
  const b0 = s.addBar(0, 1, beat), b1 = s.addBar(1, 5, beat);
  ok(near(b0.win, 0.15), '窗口 = min(150ms, 最小间隔一半)');
  const r1 = s.hit(1.015); ok(r1.grade === 'green' && near(r1.errMs, 15, 1e-6) && r1.label === '第 1 拍', '实时：早晚 + 位置');
  const r2 = s.hit(1.45); ok(r2.grade === 'yellow' && near(r2.errMs, -50, 1e-6) && r2.label === '第 1 拍后半', '实时：早 50 → 黄');
  const r3 = s.hit(1.68); ok(r3.extra === true, '离所有期望点都超过窗口 → 多弹');
  [2, 2.5, 2.6, 4, 4.5, 5.0].forEach((t) => s.hit(t)); // 3.0、3.5 漏掉
  const res0 = s.closeBar(b0);
  ok(res0.miss === 2 && res0.notes[4].grade === 'miss' && res0.notes[5].grade === 'miss', '漏拍 = 第 3 拍两个：' + res0.notes.map((n) => n.grade).join());
  ok(res0.extras.length === 2 && !res0.ok, '第 1 小节：多弹 2（1.68、2.6），不达标');
  ok(s.onsets.find((o) => o.t === 5.0).claimed === false, '下一小节的第一下不会被上一小节吃掉');
  ok(b0.live.length === 8 && b0.live.filter((x) => x.extra).length === 1, '实时记录（2.6 实时时离 2.5 最近，算到 2.5 上）');
  for (let i = 1; i < 8; i++) s.hit(5 + i * 0.5 + 0.01);
  const res1 = s.closeBar(b1, true);
  ok(res1.ok && res1.miss === 0 && res1.extras.length === 0, '第 2 小节全部 ±10ms → 达标');
}

console.log('== 4. 诊断：抢拍/拖拍、稳定性、每个位置、最差位置、专项建议');
{
  const r = rng(5), pat = P('folk'), meter = '4/4';
  const s = new RhythmSession({ pattern: pat, meter });
  const beat = 60 / 80;
  for (let b = 0; b < 8; b++) {
    const bar = s.addBar(b, 2 + b * 4 * beat, beat);
    for (const e of bar.exp) {
      // 第 3 拍后半（反拍上扫）系统性晚 55ms；其余早 15ms ±5
      if (e.key === '30') { if (b % 4 === 3) continue; s.hit(e.t + 0.055 + (r() - 0.5) * 0.01); }
      else s.hit(e.t - 0.015 + (r() - 0.5) * 0.01);
    }
  }
  s.bars.forEach((b, i) => s.closeBar(b, i === 7));
  const d = s.summary(80);
  ok(d.expected === 48 && d.miss === 2 && d.extras === 0, `统计数量 ${d.expected}/${d.miss}/${d.extras}`);
  ok(d.positions.length === 6, '6 个位置');
  ok(d.worst[0] && d.worst[0].key === '30' && d.worst[0].label === '第 3 拍后半', '最差位置 = 第 3 拍后半: ' + (d.worst[0] && d.worst[0].label));
  const p30 = d.positions.find((p) => p.key === '30');
  ok(Math.abs(p30.meanMs - 55) < 4 && p30.miss === 2, '该位置平均晚 55ms、漏 2');
  const others = d.positions.filter((p) => p.key !== '30');
  ok(others.every((p) => Math.abs(p.meanMs + 15) < 4 && p.stdMs < 5), '其他位置早 15ms 且稳');
  ok(d.drill && d.drill.bpm === 68 && d.drill.focus.includes('30'), '建议专项：慢到 68 BPM，盯住第 3 拍后半');
  ok(d.tips.some((t) => t.includes('第 3 拍后半')), '建议文字里点名最差位置');
  // 纯抢拍
  const s2 = new RhythmSession({ pattern: P('q'), meter: '4/4' });
  for (let b = 0; b < 4; b++) { const bar = s2.addBar(b, b * 2, 0.5); bar.exp.forEach((e) => s2.hit(e.t - 0.025 + (r() - 0.5) * 0.004)); }
  s2.bars.forEach((b, i) => s2.closeBar(b, i === 3));
  const d2 = s2.summary(120);
  ok(d2.tendency === 'rush' && d2.stability === 'steady' && Math.abs(d2.meanMs + 25) < 2, '整体抢拍 25ms、很稳');
  ok(!d2.drill || d2.worst.length === 0, '每个位置一样早 → 没有「最差位置」专项');
  // 拖 + 不稳
  const s3 = new RhythmSession({ pattern: P('q'), meter: '3/4' });
  for (let b = 0; b < 6; b++) { const bar = s3.addBar(b, b * 1.5, 0.5); bar.exp.forEach((e) => s3.hit(e.t + 0.02 + (r() - 0.5) * 0.16)); }
  s3.bars.forEach((b, i) => s3.closeBar(b, i === 5));
  const d3 = s3.summary(120);
  ok(d3.stability === 'shaky' && d3.stdMs > 30, '±80ms 随机 → 不稳 (' + d3.stdMs.toFixed(1) + ')');
  // 专项练习的焦点统计
  const d4 = diagnose(s.results, { pattern: pat, meter, bpm: 68, focus: ['30'] });
  ok(d4.focusStats.length === 1 && d4.focusStats[0].key === '30', '专项：单独统计焦点位置');

  // 每一拍的后半都晚 → 归成一个问题「每拍后半」
  const s5 = new RhythmSession({ pattern: P('e'), meter: '4/4' });
  for (let b = 0; b < 6; b++) { const bar = s5.addBar(b, 1 + b * 2.4, 0.6); bar.exp.forEach((e) => s5.hit(e.t + (e.at % 1 ? 0.048 : 0.001) + (r() - 0.5) * 0.004)); }
  s5.bars.forEach((b, i) => s5.closeBar(b, i === 5));
  const d5 = s5.summary(100);
  ok(d5.drill && d5.drill.labels.join() === '每拍后半' && d5.drill.focus.length === 4 && d5.drill.bpm === 85, '专项：每拍后半（4 个位置）→ ' + (d5.drill && d5.drill.labels.join()));
  ok(d5.tips.some((t) => t.includes('问题集中在每拍后半')), '建议：问题集中在每拍后半');
}

console.log('== 5. 速度阶梯');
{
  const L = new TempoLadder({ bpm: 70, step: 4, needUp: 2, needDown: 2 });
  const seq = [1, 1, 1, 1, 0, 1, 0, 0, 1, 1].map((x) => L.update(!!x));
  ok(seq.join() === '0,1,0,1,0,0,0,-1,0,1', '变化序列 ' + seq.join());
  ok(L.bpm === 78 && L.top === 78 && L.ups === 3 && L.downs === 1, `最终 ${L.bpm} 最高 ${L.top}`);
  const L2 = new TempoLadder({ bpm: 50, step: 4, needDown: 1, min: 40 });
  for (let i = 0; i < 10; i++) L2.update(false);
  ok(L2.bpm === 42, '不低于 max(下限, 起始 − 3 档)：' + L2.bpm);
  const L3 = new TempoLadder({ bpm: 218, max: 220 }); L3.update(true); L3.update(true); ok(L3.bpm === 218, '不超过上限');
}

console.log('== 6. 节拍器间歇');
{
  const pat = (meter, cfg, bars = 2) => { const m = METERS[meter], o = []; for (let b = 0; b < bars; b++) for (let be = 0; be < m.beats; be++) o.push(clickOn({ bar: b, beat: be, sub: 0 }, cfg, meter) ? 1 : 0); return o.join(''); };
  ok(pat('4/4', { mode: 'all' }) === '11111111', '全响');
  ok(pat('4/4', { mode: 'backbeat' }) === '01010101', '只响 2、4 拍');
  ok(pat('3/4', { mode: 'backbeat' }) === '011011', '3/4：嗯 嚓 嚓');
  ok(pat('4/4', { mode: 'one' }) === '10001000', '只响第 1 拍');
  ok(pat('4/4', { mode: 'all', muteX: 1, muteY: 2 }, 4) === '1111000011110000', '每 2 小节静 1 小节');
  ok(pat('2/4', { mode: 'all', muteX: 2, muteY: 4 }, 8) === '1111000011110000', '每 4 小节静 2 小节');
  ok(clickOn({ bar: 1, beat: 0, sub: 0 }, { mode: 'one', muteX: 1, muteY: 2 }, '4/4', true), '预备拍总是响');
  ok(!clickOn({ bar: 0, beat: 0, sub: 1 }, { mode: 'all', subClicks: false }, '6/8') && clickOn({ bar: 0, beat: 0, sub: 1 }, { mode: 'all' }, '6/8'), '细分点开关');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 节奏训练逻辑全部通过');
process.exit(fails ? 1 : 0);
