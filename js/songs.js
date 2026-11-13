// songs.js — 练习曲库（全部是公有领域 / 传统旋律），以及把音符自动安排到吉他第一把位的指法函数。
//
// 曲目格式（新增曲子照着写即可，详见 README「曲库格式」）：
//   id      唯一 id（英文）
//   title   中文名；en 英文名
//   source  来源与版权说明（必须是公有领域或传统民谣）
//   bpm     建议速度（四分音符/分钟）；beats 每小节拍数；pickup 弱起拍数（没有就 0）
//   level   1–3 难度；tip 一句练习提示
//   notes   用空格分隔的「音名:时值」，时值以四分音符为 1（0.5 = 八分，2 = 二分，1.5 = 附点四分），r 表示休止
//           需要指定把位时写成「音名:时值@弦-品」，弦 1 = 最细的高音 E 弦，例如 D3:1@4-0
import { parseNoteName, midiName } from './dsp.js';

export const OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 }; // 弦号 → 空弦 MIDI（E4 B3 G3 D3 A2 E2）

export const SONGS = [
  {
    id: 'hot-cross-buns', title: '热十字包', en: 'Hot Cross Buns', level: 1, bpm: 80, beats: 4, pickup: 0,
    source: '英国传统童谣（18 世纪），公有领域',
    tip: '只用 2、3 弦，三个音：B（2 弦空弦）、A（3 弦 2 品）、G（3 弦空弦）。',
    notes: 'B3:1 A3:1 G3:2 B3:1 A3:1 G3:2 G3:0.5 G3:0.5 G3:0.5 G3:0.5 A3:0.5 A3:0.5 A3:0.5 A3:0.5 B3:1 A3:1 G3:2',
  },
  {
    id: 'mary-lamb', title: '玛丽有只小羊羔', en: 'Mary Had a Little Lamb', level: 1, bpm: 90, beats: 4, pickup: 0,
    source: '美国传统童谣（1830），公有领域',
    tip: '1、2 弦：E（1 弦空弦）、D（2 弦 3 品）、C（2 弦 1 品）、G（1 弦 3 品）。',
    notes: 'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 D4:1 D4:1 D4:2 E4:1 G4:1 G4:2 E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1 D4:1 D4:1 E4:1 D4:1 C4:4',
  },
  {
    id: 'twinkle', title: '小星星', en: 'Twinkle Twinkle Little Star', level: 1, bpm: 90, beats: 4, pickup: 0,
    source: '法国民谣《Ah! vous dirai-je, maman》（18 世纪），公有领域',
    tip: 'G 大调，1–3 弦。注意「一闪一闪」后面那一跳：G（3 弦空弦）→ D（2 弦 3 品）。',
    notes: 'G3:1 G3:1 D4:1 D4:1 E4:1 E4:1 D4:2 C4:1 C4:1 B3:1 B3:1 A3:1 A3:1 G3:2 ' +
      'D4:1 D4:1 C4:1 C4:1 B3:1 B3:1 A3:2 D4:1 D4:1 C4:1 C4:1 B3:1 B3:1 A3:2 ' +
      'G3:1 G3:1 D4:1 D4:1 E4:1 E4:1 D4:2 C4:1 C4:1 B3:1 B3:1 A3:1 A3:1 G3:2',
  },
  {
    id: 'au-clair', title: '月光', en: 'Au clair de la lune', level: 1, bpm: 90, beats: 4, pickup: 0,
    source: '法国民谣（18 世纪），公有领域',
    tip: 'C 大调，1–3 弦。中段从 D 跳到 A（3 弦 2 品），提前看好位置。',
    notes: 'C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 ' +
      'C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 ' +
      'D4:1 D4:1 D4:1 D4:1 A3:2 A3:2 D4:1 C4:1 B3:1 A3:1 G3:4 ' +
      'C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4',
  },
  {
    id: 'ode-to-joy', title: '欢乐颂', en: 'Ode to Joy（贝多芬）', level: 1, bpm: 96, beats: 4, pickup: 0,
    source: '贝多芬《第九交响曲》（1824），公有领域',
    tip: '几乎全在 1、2 弦上一步一步走，最适合练左手换品。',
    notes: 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 ' +
      'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2 ' +
      'D4:1 D4:1 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 G3:2 ' +
      'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2',
  },
  {
    id: 'two-tigers', title: '两只老虎', en: 'Frère Jacques', level: 2, bpm: 100, beats: 4, pickup: 0,
    source: '法国传统轮唱曲（18 世纪），公有领域',
    tip: 'G 大调。最后「真奇怪」的低音 D 在 4 弦空弦。八分音符那句别急，慢速先弹准。',
    notes: 'G3:1 A3:1 B3:1 G3:1 G3:1 A3:1 B3:1 G3:1 B3:1 C4:1 D4:2 B3:1 C4:1 D4:2 ' +
      'D4:0.5 E4:0.5 D4:0.5 C4:0.5 B3:1 G3:1 D4:0.5 E4:0.5 D4:0.5 C4:0.5 B3:1 G3:1 ' +
      'G3:1 D3:1 G3:2 G3:1 D3:1 G3:2',
  },
  {
    id: 'london-bridge', title: '伦敦桥', en: 'London Bridge Is Falling Down', level: 2, bpm: 96, beats: 4, pickup: 0,
    source: '英国传统童谣，公有领域',
    tip: 'G 大调，1–3 弦。附点节奏「长-短」：第一个音占 1.5 拍。',
    notes: 'D4:1.5 E4:0.5 D4:1 C4:1 B3:1 C4:1 D4:2 A3:1 B3:1 C4:2 B3:1 C4:1 D4:2 ' +
      'D4:1.5 E4:0.5 D4:1 C4:1 B3:1 C4:1 D4:2 A3:2 D4:2 B3:1 G3:3',
  },
  {
    id: 'yankee-doodle', title: '洋基歌', en: 'Yankee Doodle', level: 2, bpm: 100, beats: 4, pickup: 0,
    source: '美国传统歌曲（18 世纪），公有领域',
    tip: 'C 大调，1–3 弦。节奏很均匀，适合开“跟拍”模式。',
    notes: 'C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 D4:1 G3:1 C4:1 C4:1 D4:1 E4:1 C4:2 B3:2 ' +
      'C4:1 C4:1 D4:1 E4:1 F4:1 E4:1 D4:1 C4:1 B3:1 G3:1 A3:1 B3:1 C4:2 C4:2',
  },
  {
    id: 'happy-birthday', title: '生日歌', en: 'Happy Birthday to You', level: 2, bpm: 90, beats: 3, pickup: 1,
    source: '旋律出自 Hill 姐妹《Good Morning to All》（1893），美国法院 2016 年确认为公有领域',
    tip: '3/4 拍，弱起。第三句跳到高音 G（1 弦 3 品），提前把手指准备好。',
    notes: 'G3:0.75 G3:0.25 A3:1 G3:1 C4:1 B3:2 G3:0.75 G3:0.25 A3:1 G3:1 D4:1 C4:2 ' +
      'G3:0.75 G3:0.25 G4:1 E4:1 C4:1 B3:1 A3:2 F4:0.75 F4:0.25 E4:1 C4:1 D4:1 C4:2',
  },
  {
    id: 'jingle-bells', title: '铃儿响叮当', en: 'Jingle Bells', level: 2, bpm: 110, beats: 4, pickup: 0,
    source: 'James Lord Pierpont（1857），公有领域',
    tip: 'C 大调，1、2 弦。同一个音连弹很多次，练右手稳定。',
    notes: 'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 ' +
      'F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2 ' +
      'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 ' +
      'F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 G4:1 G4:1 F4:1 D4:1 C4:4',
  },
  {
    id: 'songbie', title: '送别', en: 'Dreaming of Home and Mother', level: 3, bpm: 72, beats: 4, pickup: 0,
    source: '旋律：J. P. Ordway《Dreaming of Home and Mother》（1851），公有领域',
    tip: 'G 大调。会用到 4 弦 4 品的 #F，和 1 弦 2 品的 #F；慢一点，唱着弹。',
    notes: 'D4:1 B3:0.5 D4:0.5 G4:2 E4:1 G4:1 D4:2 D4:1 G3:0.5 A3:0.5 B3:1 A3:0.5 G3:0.5 A3:4 ' +
      'D4:1 B3:0.5 D4:0.5 G4:1.5 F#4:0.5 E4:1 G4:1 D4:2 D4:1 A3:0.5 B3:0.5 C4:1.5 F#3:0.5 G3:4 ' +
      'E4:1 G4:1 G4:2 F#4:1 E4:0.5 F#4:0.5 G4:2 E4:0.5 F#4:0.5 G4:0.5 E4:0.5 E4:0.5 D4:0.5 B3:0.5 G3:0.5 A3:4 ' +
      'D4:1 B3:0.5 D4:0.5 G4:1.5 F#4:0.5 E4:1 G4:1 D4:2 D4:1 A3:0.5 B3:0.5 C4:1.5 F#3:0.5 G3:4',
  },
  {
    id: 'lightly-row', title: '小蜜蜂', en: 'Lightly Row', level: 1, bpm: 96, beats: 4, pickup: 0,
    source: '德国民歌《Hänschen klein》的旋律（19 世纪），英文版《Lightly Row》，公有领域。谱据《The Everyday Song Book》（1927）',
    tip: 'C 大调，1–3 弦。「5 3 3 – 4 2 2 –」，和小星星一样只在 1、2 弦上走。',
    notes: 'G4:1 E4:1 E4:2 F4:1 D4:1 D4:2 C4:1 D4:1 E4:1 F4:1 G4:1 G4:1 G4:2 G4:1 ' +
      'E4:1 E4:2 F4:1 D4:1 D4:2 C4:1 E4:1 G4:1 G4:1 E4:2 r:2 D4:1 D4:1 D4:1 ' +
      'D4:1 D4:1 E4:1 F4:2 E4:1 E4:1 E4:1 E4:1 E4:1 F4:1 G4:2 G4:1 E4:1 E4:2 ' +
      'F4:1 D4:1 D4:2 C4:1 E4:1 G4:1 G4:1 E4:4',
  },
  {
    id: 'old-macdonald', title: '王老先生有块地', en: 'Old MacDonald Had a Farm', level: 1, bpm: 100, beats: 4, pickup: 0,
    source: '英美传统童谣（1917 年出版，旋律更早），公有领域。谱据 Paul Hardy 曲谱集（只取旋律），移到 C 调',
    tip: 'C 大调，2、3 弦。中段「咿呀咿呀哦」那几句全在 2 弦 1 品（C），练右手连续拨弦。',
    notes: 'C4:1 C4:1 C4:1 G3:1 A3:1 A3:1 G3:2 E4:1 E4:1 D4:1 D4:1 C4:2 r:1 G3:1 ' +
      'C4:1 C4:1 C4:1 G3:1 A3:1 A3:1 G3:2 E4:1 E4:1 D4:1 D4:1 C4:2 r:1 G3:0.5 ' +
      'G3:0.5 C4:1 C4:1 C4:1 G3:0.5 G3:0.5 C4:1 C4:1 C4:1 r:1 C4:0.5 C4:0.5 C4:1 C4:0.5 ' +
      'C4:0.5 C4:1 C4:0.5 C4:0.5 C4:0.5 C4:0.5 C4:1 C4:1 C4:1 C4:1 C4:1 G3:1 A3:1 A3:1 ' +
      'G3:2 E4:1 E4:1 D4:1 D4:1 C4:4',
  },
  {
    id: 'saints', title: '圣者进行曲', en: 'When the Saints Go Marching In', level: 2, bpm: 100, beats: 4, pickup: 3,
    source: '美国传统黑人灵歌（19 世纪），作者不详，公有领域。谱据 Musica Viva 曲谱库',
    tip: 'C 大调，1、2 弦。弱起 3 拍：数「1 2 3 4」，从第 2 拍开始弹 C E F。',
    notes: 'C4:1 E4:1 F4:1 G4:4 r:1 C4:1 E4:1 F4:1 G4:4 r:1 C4:1 E4:1 F4:1 G4:2 ' +
      'E4:2 C4:2 E4:2 D4:4 r:1 E4:1 E4:1 D4:1 C4:4 E4:2 G4:2 G4:1 F4:3 r:2 ' +
      'E4:1 F4:1 G4:2 E4:2 C4:2 D4:2 C4:4',
  },
  {
    id: 'oh-susanna', title: '哦！苏珊娜', en: 'Oh! Susanna', level: 2, bpm: 100, beats: 4, pickup: 1,
    source: 'Stephen Foster 作曲（1848；1864 年去世），公有领域。谱据 Foster 原曲的 C 调 ABC 谱，移到 G 调',
    tip: 'G 大调，1–3 弦。附点节奏「长-短」很多，先慢速跟拍。',
    notes: 'G3:0.5 A3:0.5 B3:1 D4:1 D4:1.5 E4:0.5 D4:1 B3:1 G3:1 A3:1 B3:1 B3:1 A3:1 G3:1 ' +
      'A3:3 G3:0.5 A3:0.5 B3:1 D4:1 D4:1.5 E4:0.5 D4:1 B3:1 G3:1 A3:1 B3:1 B3:1 A3:1 ' +
      'A3:1 G3:4 C4:2 C4:2 E4:1 E4:2 E4:1 D4:1 D4:1 B3:1 G3:1 A3:3 G3:0.5 A3:0.5 ' +
      'B3:1 D4:1 D4:1.5 E4:0.5 D4:1 B3:1 G3:1 A3:1 B3:1 B3:1 A3:1 A3:1 G3:4',
  },
  {
    id: 'camptown', title: '康城赛马', en: 'Camptown Races', level: 2, bpm: 100, beats: 4, pickup: 1,
    source: 'Stephen Foster 作曲（1850；1864 年去世），公有领域。谱据 Colin Hume 整理的传统版本',
    tip: 'G 大调，1–3 弦。副歌跳到高音 G（1 弦 3 品），提前准备好无名指。',
    notes: 'D4:1 D4:1 D4:1 B3:1 D4:1 E4:1 D4:1 B3:2 B3:1 A3:3 B3:1 A3:1 r:1 D4:1 ' +
      'D4:1 D4:1 B3:1 D4:1 E4:1 D4:1 B3:2 A3:2 B3:1 A3:1 G3:3 r:1 G3:1.5 G3:0.5 ' +
      'B3:1 D4:1 G4:4 E4:1.5 E4:0.5 G4:1 E4:1 D4:3 B3:1 D4:1 D4:1 B3:1 D4:1 E4:1 ' +
      'D4:1 B3:2 A3:1 B3:0.5 C4:0.5 B3:1 A3:0.5 A3:0.5 G3:4',
  },
  {
    id: 'red-river', title: '红河谷', en: 'Red River Valley', level: 2, bpm: 96, beats: 4, pickup: 2,
    source: '北美传统民歌（19 世纪末），作者不详，公有领域。谱据 Musica Viva 曲谱库，与维基百科乐谱对照，移到 C 调',
    tip: 'C 大调，1–3 弦。弱起 2 拍（5̣ 1），长音要数满拍。',
    notes: 'G3:1 C4:1 E4:2 E4:1 E4:1 E4:2 D4:1 E4:1 D4:1 C4:5 G3:1 C4:1 E4:2 C4:1 ' +
      'E4:1 G4:2 F4:1 E4:1 D4:6 G4:1 F4:1 E4:2 E4:1 D4:1 C4:2 D4:1 E4:1 G4:1 ' +
      'F4:5 B3:1 A3:1 G3:2 B3:1 C4:1 D4:2 E4:1 D4:1 C4:4',
  },
  {
    id: 'clementine', title: '新年好（克莱门汀）', en: 'Oh My Darling, Clementine', level: 2, bpm: 100, beats: 3, pickup: 1,
    source: '美国民歌，1884 年出版（Percy Montrose），1929 年前出版，公有领域；中文《新年好》用的就是这条旋律',
    tip: '3/4 拍，弱起。附点「哒-嗒」：前一个音长、后一个音短。',
    notes: 'C4:0.75 C4:0.25 C4:1 G3:1 E4:0.75 E4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 G4:1 G4:1 F4:0.75 E4:0.25 ' +
      'D4:2 D4:0.75 E4:0.25 F4:1 F4:1 E4:0.75 D4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 D4:1 G3:1 B3:0.75 ' +
      'D4:0.25 C4:2 C4:0.75 C4:0.25 C4:1 G3:1 E4:0.75 E4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 G4:1 G4:1 ' +
      'F4:0.75 E4:0.25 D4:2 D4:0.75 E4:0.25 F4:1 F4:1 E4:0.75 D4:0.25 E4:1 C4:1 C4:0.75 E4:0.25 D4:1 ' +
      'G3:1 B3:0.75 D4:0.25 C4:3',
  },
  {
    id: 'amazing-grace', title: '奇异恩典', en: 'Amazing Grace', level: 2, bpm: 84, beats: 3, pickup: 1,
    source: '曲调《New Britain》，美国传统赞美诗旋律（1829 年出版，1835 年起配 John Newton 1779 年的歌词），公有领域。谱据维基百科乐谱，移到 C 调',
    tip: '3/4 拍，弱起 1 拍。C 大调，1–3 弦，速度慢，注意每小节第 1 拍的长音。',
    notes: 'G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:2 A3:1 G3:2 G3:1 C4:2 E4:0.5 C4:0.5 E4:2 ' +
      'D4:1 G4:2 E4:1 G4:1.5 E4:0.5 G4:0.5 E4:0.5 C4:2 G3:1 A3:1.5 C4:0.5 C4:0.5 A3:0.5 G3:2 ' +
      'G3:1 C4:2 E4:0.5 C4:0.5 E4:2 D4:1 C4:3',
  },
  {
    id: 'brahms-lullaby', title: '勃拉姆斯摇篮曲', en: 'Lullaby（Brahms）', level: 2, bpm: 84, beats: 3, pickup: 1,
    source: '勃拉姆斯《摇篮曲》Op. 49 No. 4（1868；勃拉姆斯 1897 年去世），公有领域。谱据《The Everyday Song Book》（1927）',
    tip: '3/4 拍，弱起。G 大调，会用到 1 弦 2 品的 #F。轻轻弹。',
    notes: 'B3:0.5 B3:0.5 D4:1.5 B3:0.5 B3:1 D4:1 r:1 B3:0.5 D4:0.5 G4:1 F#4:1.5 E4:0.5 E4:1 D4:1 ' +
      'A3:0.5 B3:0.5 C4:1 A3:1 A3:0.5 B3:0.5 C4:1 r:1 A3:0.5 C4:0.5 F#4:0.5 E4:0.5 D4:1 F#4:1 ' +
      'G4:1 r:1 G3:0.5 G3:0.5 G4:2 E4:0.5 C4:0.5 D4:2 B3:0.5 G3:0.5 C4:1 D4:1 E4:1 D4:2 ' +
      'G3:0.5 G3:0.5 G4:2 E4:0.5 C4:0.5 D4:2 B3:0.5 G3:0.5 C4:1 B3:1 A3:1 G3:3',
  },
  {
    id: 'auld-lang-syne', title: '友谊地久天长', en: 'Auld Lang Syne', level: 3, bpm: 80, beats: 4, pickup: 1,
    source: '苏格兰传统民歌，Robert Burns 1788 年填词，公有领域。谱据维基百科乐谱与《The Everyday Song Book》（1927），移到 G 调',
    tip: 'G 大调，弱起。低音 D、E 在 4 弦（空弦、2 品），句尾「D D C」那里要换到 4 弦。',
    notes: 'D3:1 G3:1.5 G3:0.5 G3:1 B3:1 A3:1.5 G3:0.5 A3:1 B3:1 G3:1.5 G3:0.5 B3:1 D4:1 E4:3 ' +
      'E4:1 D4:1.5 B3:0.5 B3:1 G3:1 A3:1.5 G3:0.5 A3:1 B3:1 G3:1.5 E3:0.5 E3:1 D3:1 G3:3 ' +
      'E4:1 D4:1.5 B3:0.5 B3:1 G3:1 A3:1.5 G3:0.5 A3:1 E4:1 D4:1.5 B3:0.5 B3:1 D4:1 E4:3 ' +
      'E4:1 D4:1.5 B3:0.5 B3:1 G3:1 A3:1.5 G3:0.5 A3:1 B3:1 G3:1.5 E3:0.5 E3:1 D3:1 G3:4',
  },
];

/** 第一把位自动指法：在 0–4 品里选最细（音高最高）的弦；1–3 弦优先 */
export function fingerFor(midi, maxFret = 4) {
  for (let s = 1; s <= 6; s++) {
    const f = midi - OPEN_MIDI[s];
    if (f >= 0 && f <= maxFret) return { string: s, fret: f };
  }
  return null;
}

/** 解析曲谱 → [{midi|null, beats, start(拍), string, fret, name}] */
export function parseSong(song) {
  const out = [];
  let t = 0;
  for (const tok of song.notes.trim().split(/\s+/)) {
    const m = /^([^:]+):([\d.]+)(?:@(\d)-(\d+))?$/.exec(tok);
    if (!m) throw new Error(`${song.id}: 无法解析 "${tok}"`);
    const beats = parseFloat(m[2]);
    if (m[1] === 'r') { out.push({ midi: null, beats, start: t }); t += beats; continue; }
    const midi = parseNoteName(m[1]);
    if (midi === null) throw new Error(`${song.id}: 音名错误 "${m[1]}"`);
    let pos = m[3] ? { string: +m[3], fret: +m[4] } : fingerFor(midi);
    if (!pos) throw new Error(`${song.id}: ${m[1]} 不在第一把位`);
    if (OPEN_MIDI[pos.string] + pos.fret !== midi) throw new Error(`${song.id}: ${tok} 指定的弦/品与音高不符`);
    out.push({ midi, beats, start: t, string: pos.string, fret: pos.fret, name: midiName(midi) });
    t += beats;
  }
  return out;
}
export function songLength(song) { return parseSong(song).reduce((a, n) => a + n.beats, 0); }
export function stringsUsed(notes) { return [...new Set(notes.filter((n) => n.midi !== null).map((n) => n.string))].sort(); }

/** 认识指板：生成随机练习（不连续重复同一位置） */
export function makeFretDrill({ strings = [1, 2, 3], maxFret = 3, count = 12, naturalOnly = false } = {}) {
  const pool = [];
  for (const s of strings) for (let f = 0; f <= maxFret; f++) {
    if (naturalOnly && midiName(OPEN_MIDI[s] + f).includes('#')) continue; // 只看音名时只出 C D E F G A B
    pool.push({ string: s, fret: f });
  }
  const notes = [];
  let prev = null;
  for (let i = 0; i < count; i++) {
    let p;
    do { p = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && prev && p.string === prev.string && p.fret === prev.fret);
    prev = p;
    const midi = OPEN_MIDI[p.string] + p.fret;
    notes.push(`${midiName(midi)}:1@${p.string}-${p.fret}`);
  }
  return { id: 'drill', title: '认识指板', en: 'Fretboard drill', level: 1, bpm: 60, beats: 4, pickup: 0, source: '随机练习', tip: '看着指板图上的位置弹，弹对了自动下一个。', notes: notes.join(' ') };
}
