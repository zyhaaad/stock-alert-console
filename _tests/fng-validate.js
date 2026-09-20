/* 恐贪指数·有效性验证（私有测试，不随站点发布）
 * 思路：如果指数真的反映情绪，那么「极度贪婪」之后市场应偏弱、「极度恐惧」之后应偏强。
 * 用未来 20 个交易日的收益做检验，并检查分布是否合理。
 * 运行：node _tests/fng-validate.js
 */
const path = require('path');
const core = require(path.join('D:/mywork/stock-alert-cloud', 'fng-core.js'));
const fng = require(path.join('D:/mywork/stock-alert-cloud', 'fng.js'));

const O = [];
const log = (...a) => O.push(a.join(' '));
const pad = (s, n) => { s = String(s); while (s.length < n) s = ' ' + s; return s; };
const padR = (s, n) => { s = String(s); while (s.length < n) s = s + ' '; return s; };
const r2 = x => (x == null || isNaN(x)) ? '—' : (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';

(async () => {
  const days = await fng.fetchKline();
  const margin = await fng.fetchMargin();
  const built = core.buildSeries(days, margin, {});
  const ser = built.series;
  const idx = {};
  days.forEach((d, i) => { idx[d.d] = i; });

  const valid = ser.filter(s => s.v != null);
  log('=== 1. 概况 ===');
  log('交易日 ' + ser.length + ' 天，有效值 ' + valid.length + ' 天，区间 ' + valid[0].d + ' ~ ' + valid[valid.length - 1].d);
  const vs = valid.map(s => s.v);
  const st = core.stats(valid);
  log('当前 ' + st.cur + '  最高 ' + st.max + '  最低 ' + st.min + '  均值 ' + st.avg);

  log('');
  log('=== 2. 分布（每 10 分一档，理想是中间厚两头薄） ===');
  const buckets = new Array(10).fill(0);
  vs.forEach(v => { buckets[Math.min(9, Math.floor(v / 10))]++; });
  for (let i = 0; i < 10; i++) {
    const pct = (buckets[i] / vs.length * 100);
    log('  ' + pad(i * 10 + '-' + (i * 10 + 10), 8) + ' ' + padR(buckets[i], 5) + ' 天  ' + '#'.repeat(Math.round(pct / 1.2)) + ' ' + pct.toFixed(1) + '%');
  }

  log('');
  log('=== 3. 极值之后的 20 日收益（检验方向性） ===');
  function fwd(d, n) {
    const i = idx[d];
    if (i == null || i + n >= days.length) return null;
    return days[i + n].c / days[i].c - 1;
  }
  const sorted = valid.slice().sort((a, b) => b.v - a.v);
  log('  —— 最贪婪 12 天 ——');
  log('  ' + padR('日期', 12) + pad('分值', 7) + pad('后20日', 10) + pad('状态', 9));
  for (const s of sorted.slice(0, 12)) {
    log('  ' + padR(s.d, 12) + pad(s.v.toFixed(1), 7) + pad(r2(fwd(s.d, 20)), 10) + pad(core.zone(s.v).text, 9));
  }
  log('  —— 最恐惧 12 天 ——');
  log('  ' + padR('日期', 12) + pad('分值', 7) + pad('后20日', 10) + pad('状态', 9));
  for (const s of sorted.slice(-12).reverse()) {
    log('  ' + padR(s.d, 12) + pad(s.v.toFixed(1), 7) + pad(r2(fwd(s.d, 20)), 10) + pad(core.zone(s.v).text, 9));
  }

  log('');
  log('=== 4. 分组统计：贪婪组 vs 恐惧组 的后 20 日平均收益 ===');
  function groupAvg(lo, hi, n) {
    const arr = [];
    valid.forEach(s => { if (s.v >= lo && s.v < hi) { const f = fwd(s.d, n); if (f != null) arr.push(f); } });
    if (!arr.length) return null;
    return { n: arr.length, avg: arr.reduce((a, b) => a + b, 0) / arr.length };
  }
  for (const [lo, hi, nm] of [[60, 101, '贪婪(≥60)'], [40, 60, '中性(40-60)'], [0, 40, '恐惧(<40)']]) {
    const g5 = groupAvg(lo, hi, 5), g20 = groupAvg(lo, hi, 20), g60 = groupAvg(lo, hi, 60);
    log('  ' + padR(nm, 14) + '样本 ' + padR(g20 ? g20.n : 0, 5) +
      ' 后5日 ' + padR(g5 ? r2(g5.avg) : '—', 9) +
      ' 后20日 ' + padR(g20 ? r2(g20.avg) : '—', 9) +
      ' 后60日 ' + padR(g60 ? r2(g60.avg) : '—', 9));
  }

  log('');
  log('=== 5. 分项相关性与当前读数拆解 ===');
  const last = valid[valid.length - 1];
  log('  最新 ' + last.d + ' 分值 ' + last.v + '（' + core.zone(last.v).text + '）');
  for (const c of core.COMPONENTS) {
    log('    ' + padR(c.name, 14) + ' 原始 ' + padR(core.sig(last.raw[c.k]), 14) + ' 得分 ' + pad(last.parts[c.k].toFixed(1), 6) + ' 权重 ' + (c.w * 100) + '%');
  }

  log('');
  log('=== 6. 最近 30 天序列 ===');
  for (const s of valid.slice(-30)) {
    log('  ' + s.d + '  ' + pad(s.v.toFixed(1), 6) + '  ' +
      'mom=' + pad(s.parts.mom.toFixed(0), 4) + ' vol=' + pad(s.parts.vol.toFixed(0), 4) +
      ' vlm=' + pad(s.parts.vlm.toFixed(0), 4) + ' mgn=' + pad(s.parts.mgn.toFixed(0), 4) +
      ' mbs=' + pad(s.parts.mbs.toFixed(0), 4) + '  ' + core.zone(s.v).text);
  }

  require('fs').writeFileSync('D:/mywork/_tests/fng-validate-out.txt', O.join('\n'), 'utf8');
  console.log('written');
})().catch(e => {
  require('fs').writeFileSync('D:/mywork/_tests/fng-validate-out.txt', O.join('\n') + '\nFATAL ' + e.stack, 'utf8');
  console.log('fatal');
});
