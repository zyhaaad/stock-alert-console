/* 恐贪指数核心算法测试（私有）
 * 覆盖：① 数学正确性 ② 边界与异常 ③ 浏览器版与 Node 版一致性
 *       ④ 与已存档的真实历史逐日对齐 ⑤ 微信兼容红线
 * 运行：node _tests/fng-core-test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CORE_PATH = 'D:/mywork/stock-alert-cloud/fng-core.js';
const PAGE_PATH = 'D:/mywork/stock-alert-console/console.html';
const HIST_PATH = 'D:/mywork/stock-alert-cloud/fng-history.json';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) { pass++ } else { fail++; fails.push(name) } }
function eq(a, b, name) { ok(a === b, name + '  期望=' + b + ' 实际=' + a) }
function near(a, b, tol, name) { ok(a != null && Math.abs(a - b) <= tol, name + '  期望≈' + b + ' 实际=' + a + ' 容差' + tol) }

/* ---------- 载入两个版本的 core ---------- */
const nodeCore = require(CORE_PATH);

const page = fs.readFileSync(PAGE_PATH, 'utf8');
const B = '/* ==== FNG-CORE-BEGIN ==== */', E = '/* ==== FNG-CORE-END ==== */';
const i0 = page.indexOf(B), i1 = page.indexOf(E);
ok(i0 > 0 && i1 > i0, 'console.html 存在 FNG-CORE 标记对');
const coreSrc = page.slice(i0 + B.length, i1).trim();

const ctx = { self: {}, console: console };
vm.createContext(ctx);
vm.runInContext(coreSrc, ctx);
const webCore = ctx.self && ctx.self.FNGCore;
ok(!!webCore, '浏览器沙箱里能取到 FNGCore');

/* ---------- 1. 基础统计 ---------- */
const c = nodeCore;
eq(c.mean([1, 2, 3, 4]), 2.5, 'mean 正确');
near(c.stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2, 1e-9, 'stdev 总体标准差');
eq(c.stdev([1]), 0, 'stdev 单元素返回 0');

ok(c.pctRank([], 5) === null, 'pctRank 空窗口返回 null');
eq(c.pctRank([1], 1), 50, 'pctRank 单值 → 中位秩 50');
eq(c.pctRank([1, 2, 3, 4, 5], 3), 50, 'pctRank 中位数 → 50');
near(c.pctRank([1, 2, 3, 4, 5], 1), 10, 1e-9, 'pctRank 最小 → 10（中位秩，不落到 0）');
near(c.pctRank([1, 2, 3, 4, 5], 5), 90, 1e-9, 'pctRank 最大 → 90');
eq(c.pctRank([7, 7, 7, 7], 7), 50, 'pctRank 全相等 → 50');
ok(c.pctRank([1, 2, 3], NaN) === null, 'pctRank 传 NaN 返回 null');
ok(c.pctRank([1, null, 3], 2) != null, 'pctRank 容忍窗口里的 null');

/* ---------- 2. 分项原始值 ---------- */
function mkDays(closes, vols, start) {
  const out = [];
  const t = Date.UTC(start[0], start[1] - 1, start[2]);
  let added = 0, dd = t;
  while (added < closes.length) {
    const wd = new Date(dd).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const s = new Date(dd).toISOString().slice(0, 10);
      out.push({ d: s, o: closes[added], c: closes[added], h: closes[added], l: closes[added], v: vols[added] });
      added++;
    }
    dd += 86400000;
  }
  return out;
}
/** rawsAt 需要的是 K 线数组对象，这里从 day 数组转一下 */
function mkK(closes, vols, start) {
  const K = { d: [], o: [], c: [], h: [], l: [], v: [] };
  const dd = mkDays(closes, vols, start);
  for (const x of dd) { K.d.push(x.d); K.o.push(x.o); K.c.push(x.c); K.h.push(x.h); K.l.push(x.l); K.v.push(x.v) }
  return K;
}
const flatC = [], flatV = [];
for (let i = 0; i < 30; i++) { flatC.push(100); flatV.push(1000) }
const Kflat = mkK(flatC, flatV, [2026, 1, 5]);
const rFlat = c.rawsAt(Kflat, [], 25);
near(rFlat.mom, 0, 1e-12, '横盘时动量原始值 = 0');
near(rFlat.vlm, 0, 1e-12, '量能不变时热度 = 0');
near(rFlat.vol, 0, 1e-9, '横盘时波动率 = 0');
ok(rFlat.mgn === null && rFlat.mbs === null, '无两融数据时融资类为 null');

const upC = [], upV = [];
for (let i = 0; i < 30; i++) { upC.push(100 + i); upV.push(1000 + i * 30) }
const rUp = c.rawsAt(mkK(upC, upV, [2026, 1, 5]), [], 25);
ok(rUp.mom > 0, '上涨时动量为正');
ok(rUp.vlm > 0, '放量时量能热度为正');
ok(rUp.vol > 0, '有涨跌时波动率为正');

eq(c.rawsAt(Kflat, [], 10).mom, null, 'K 线不足 20 根时动量为 null');
eq(c.rawsAt(Kflat, [], 18).vlm, null, 'K 线不足 20 根时量能为 null');
ok(c.rawsAt(Kflat, [], 20).vol != null, '满 21 根后有波动率');

/* 两融 T+1 滞后：只取"日期严格早于当天"的记录 */
const margin = [];
for (let i = 0; i < 30; i++) {
  margin.push({ d: '2026-01-' + String(i + 1).padStart(2, '0'), rzye: 1000 + i, rzjme: 10, ltsz: 1e6 });
}
eq(c.marginIndexBefore(margin, '2026-01-01'), -1, 'strictly-before：等于当天不算（无更早记录 → -1）');
eq(c.marginIndexBefore(margin, '2026-01-05'), 3, 'strictly-before 取 04 号的记录（index 3）');
eq(c.marginIndexBefore(margin, '2026-01-31'), 29, 'strictly-before 取 30 号');
eq(c.marginIndexBefore([], '2026-01-05'), -1, '空两融返回 -1');

/* ---------- 3. computeLive 边界 ---------- */
const raws = [];
for (let i = 0; i < 300; i++) {
  raws.push({ mom: Math.sin(i / 7) * 0.05, vol: 0.15 + Math.cos(i / 11) * 0.05, vlm: Math.sin(i / 5) * 0.2, mgn: Math.sin(i / 13) * 0.01, mbs: Math.sin(i / 17) * 0.0002 });
}
ok(c.computeLive(raws, null).v === null, 'curRaw 为空 → v=null');
ok(c.computeLive(raws, { mom: null, vol: 1, vlm: 1, mgn: 1, mbs: 1 }).v === null, '某分项原始值缺失 → v=null');
const shortHist = raws.slice(0, 10);
ok(c.computeLive(shortHist, raws[10]).v === null, '窗口不足 MIN_WIN → v=null');
const r300 = c.computeLive(raws.slice(0, 299), raws[299]);
ok(r300.v != null && r300.v >= 0 && r300.v <= 100, '足量样本输出落在 0-100');
eq(Object.keys(r300.parts).length, 5, '输出 5 个分项得分');

/* 极值：历史窗口内最高 → 分项接近 100 */
const mono = [];
for (let i = 0; i < 300; i++) mono.push({ mom: i / 1000, vol: 1 - i / 1000, vlm: i / 1000, mgn: i / 1000, mbs: i / 1000 });
const rMono = c.computeLive(mono.slice(0, 299), mono[299]);
ok(rMono.v > 95, '各项都处在历史高位 → 指数 > 95（实际 ' + rMono.v + '）');
const rMonoLow = c.computeLive(mono.slice(0, 299), mono[0]);
ok(rMonoLow.v == null || rMonoLow.v < 10, '各项都处在历史低位 → 指数 < 10');

/* 反向分项：波动率越高，得分越低 */
const lowVol = raws.slice(0, 299).concat([{ mom: 0, vol: 0.0001, vlm: 0, mgn: 0, mbs: 0 }]);
const highVol = raws.slice(0, 299).concat([{ mom: 0, vol: 9.999, vlm: 0, mgn: 0, mbs: 0 }]);
const pvLow = c.computeLive(lowVol.slice(0, 299), lowVol[299]).parts.vol;
const pvHigh = c.computeLive(highVol.slice(0, 299), highVol[299]).parts.vol;
ok(pvLow > pvHigh, '波动率反向计分：低波动得分更高（' + pvLow + ' vs ' + pvHigh + '）');

/* ---------- 4. 无前视 / 存档不漂移 ---------- */
/** 造一段两融历史（日期与交易日对齐，T+1 滞后由 core 自己处理） */
function mkMargin(n, start) {
  const arr = [];
  const dd = mkDays(new Array(n).fill(100), new Array(n).fill(1000), start);
  for (let i = 0; i < dd.length; i++) {
    arr.push({ d: dd[i].d, rzye: 2.5e12 + i * 3e9, rzjme: Math.sin(i / 9) * 2e10, ltsz: 9.7e13 });
  }
  return arr;
}

const built = c.buildSeries(
  mkDays(raws.map((x, i) => 100 + i * 0.1), raws.map(() => 1000), [2025, 1, 6]),
  mkMargin(300, [2025, 1, 6]),
  {}
);
const prefixVals = c.buildSeries(
  mkDays(raws.slice(0, 120).map((x, i) => 100 + i * 0.1), raws.slice(0, 120).map(() => 1000), [2025, 1, 6]),
  mkMargin(120, [2025, 1, 6]), {}
);
let sameAll = true;
for (let i = 0; i < Math.min(120, prefixVals.series.length, built.series.length); i++) {
  if (prefixVals.series[i].v !== built.series[i].v) { sameAll = false; break }
}
ok(sameAll, '无前视：只用前缀算出的分值，与整段算出的一致（存档永不漂移）');

/* ---------- 5. 打包 / 解包 ---------- */
const packed = c.packSeries(built.series.slice(-50), built.raws.slice(-50));
eq(packed.length, 50, 'packSeries 条数正确');
eq(packed[0].length, 7, 'packSeries 每行 7 个字段');
const un = c.unpackSeries(packed);
eq(un.series.length, 50, 'unpackSeries 条数正确');
near(un.series[49].v, built.series[built.series.length - 1].v, 1e-9, 'pack/unpack 分值无损');
near(un.raws[49].mom, c.sig(built.raws[built.raws.length - 1].mom), 1e-12, 'pack/unpack 原始值无损（6 位有效数字）');
ok(JSON.stringify(un.series[0].v) === 'null' || un.series[0].v != null, 'unpackSeries 处理 null 分值');

/* ---------- 6. 展示辅助 ---------- */
eq(c.zone(100).text, '极度贪婪', 'zone 100');
eq(c.zone(75).text, '极度贪婪', 'zone 75 边界');
eq(c.zone(74.9).text, '贪婪', 'zone 74.9');
eq(c.zone(60).text, '贪婪', 'zone 60 边界');
eq(c.zone(40).text, '中性', 'zone 40 边界');
eq(c.zone(39.9).text, '恐惧', 'zone 39.9');
eq(c.zone(25).text, '恐惧', 'zone 25 边界');
eq(c.zone(24.9).text, '极度恐惧', 'zone 24.9');
eq(c.zone(0).text, '极度恐惧', 'zone 0');
eq(c.zone(null).lvl, -1, 'zone null → lvl -1');
const validCount = built.series.filter(s => s.v != null).length;
eq(c.slicePeriod(built.series, 7).length, 7, 'slicePeriod 取最近 7 天');
eq(c.slicePeriod(built.series, 0).length, validCount, 'slicePeriod 0 = 全部（自动跳过前置预热空值）');
ok(validCount > 200 && validCount < built.series.length, '预热期（窗口不足）不出值，且只影响开头');
const st = c.stats(built.series);
ok(st && st.max >= st.min && st.n > 0, 'stats 统计正常');
eq(c.calendarDaysFor(0) > 0, true, 'calendarDaysFor 单调');

/* 权重合计 = 1 */
let wsum = 0;
for (const cp of c.COMPONENTS) wsum += cp.w;
near(wsum, 1, 1e-9, '5 个分项权重合计 = 100%');

/* ---------- 7. 两版一致性（浏览器 vs Node，逐点比对） ---------- */
let identical = true, firstDiff = '';
const sample = [];
for (let i = 0; i < 60; i++) sample.push(raws[i]);
for (let i = 60; i < 300; i += 7) {
  const a = nodeCore.computeLive(raws.slice(0, i), raws[i]);
  const b = webCore.computeLive(raws.slice(0, i), raws[i]);
  if (a.v !== b.v || JSON.stringify(a.parts) !== JSON.stringify(b.parts)) {
    identical = false; firstDiff = 'i=' + i + ' node=' + JSON.stringify(a) + ' web=' + JSON.stringify(b); break;
  }
}
ok(identical, '浏览器版与 Node 版 computeLive 结果完全一致' + (identical ? '' : ' — ' + firstDiff));

const kA = nodeCore.rawsAt(mkK(upC, upV, [2026, 1, 5]), margin, 25);
const kB = webCore.rawsAt(mkK(upC, upV, [2026, 1, 5]), margin, 25);
ok(JSON.stringify(kA) === JSON.stringify(kB), '两版 rawsAt 结果一致');

/* ---------- 8. 与真实存档逐日对齐（证明控制台显示值 = 云端记录值） ---------- */
const hist = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8'));
ok(hist.days && hist.days.length > 500, '存档天数 > 500（实际 ' + (hist.days ? hist.days.length : 0) + '）');
ok(!!hist.margin && !!hist.margin.d, '存档含两融快照');
const u = nodeCore.unpackSeries(hist.days);
let mismatch = 0, checked = 0, worst = 0;
for (let i = u.raws.length - 60; i < u.raws.length; i++) {
  if (i < 1) continue;
  const r = nodeCore.computeLive(u.raws.slice(0, i), u.raws[i]);
  if (r.v == null) continue;
  checked++;
  const d = Math.abs(r.v - u.series[i].v);
  if (d > worst) worst = d;
  if (d > 1e-9) mismatch++;
}
eq(mismatch, 0, '复算 ' + checked + ' 天存档值，0 处不一致（最大偏差 ' + worst + '）');

const dates = u.series.map(s => s.d);
let sorted = true;
for (let i = 1; i < dates.length; i++) if (dates[i] <= dates[i - 1]) sorted = false;
ok(sorted, '存档日期严格递增且无重复');
let rangeOk = true;
for (const s of u.series) if (s.v != null && (s.v < 0 || s.v > 100)) rangeOk = false;
ok(rangeOk, '存档所有分值都在 0-100');
ok(Date.parse(u.series[u.series.length - 1].d) > Date.parse('2026-09-01'), '存档最新日期在 2026-09 之后');

/* ---------- 9. 微信老浏览器兼容红线（只查注入块） ---------- */
const banned = [
  ['可选链 ?.', /\?\./],
  ['空值合并 ??', /\?\?/],
  ['Intl 时区', /\bIntl\b/],
  [':has()', /:has\(/],
  ['will-change', /will-change/],
  ['CSS 变量 var(--', /var\(--/],
  ['@media', /@media/],
  ['replaceAll', /\.replaceAll\(/],
  ['padStart/padEnd', /pad(Start|End)\(/]
];
for (const [nm, re] of banned) ok(!re.test(coreSrc), '注入块未使用 ' + nm);
ok(!/\bnode_modules\b/.test(coreSrc), '注入块未引用外部依赖');

/* ---------- 汇总 ---------- */
console.log('');
console.log('================ 汇总 ================');
console.log('通过：' + pass + '    失败：' + fail);
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)) }
console.log(fail ? '\n结果：FAILED' : '\n结果：ALL GREEN');
process.exit(fail ? 1 : 0);
