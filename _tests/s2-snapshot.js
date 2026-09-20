/* S2「大盘环境接入」可视快照 —— 把「中长线详情 + 筹码维度 + 大盘环境」渲染成一张静态页，供肉眼确认
 * 运行：node _tests/s2-snapshot.js  → D:/mywork/_preview/s2-market-block.html
 * 数字是构造的演示值，不是真实行情；只为确认排版/文案/降级路径长得对。
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM } = require(path.join(WS, 'jsdom'));

const SRC = 'D:/mywork/stock-alert-console/console.html';
const OUT = 'D:/mywork/_preview/s2-market-block.html';
const html = fs.readFileSync(SRC, 'utf8');
const styleTag = html.slice(html.indexOf('<style'), html.indexOf('</style>') + 8);

function mkBars(pxFn, n) {
  const out = [], base = new Date('2024-01-01T00:00:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const px = pxFn(i, n);
    out.push({ d: new Date(base + i * 86400000).toISOString().slice(0, 10),
      o: px, c: px, h: px * 1.01, l: px * 0.99, v: 1e6 });
  }
  return out;
}

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/console.html?demo=1' });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 800));

  /* 建仓区：长期下行到 12 后横盘，最后 60 日缓涨 → 低位 + 周线转多 */
  const barsAcc = mkBars((i, n) => (i < 100 ? 20 - i * 0.08 : (i < n - 60 ? 12 : 12 + (i - (n - 60)) * 0.02)), 300);
  /* 高位过热：长期平 12 后最后 3 日拉到 20 → 多头排列 + 连续站上 MA5 + 偏离 MA5 >5% + 高分位 */
  const barsTop = mkBars((i, n) => (i < n - 3 ? 12 : 20), 300);

  const stocks = [
    { code: '600703', name: '三安光电', cost: 12.50, bars: barsAcc, main20: 1.2e8, mv: 2e10,
      mainCost: 10.0, profit: 0.62, conc: 0.42, mKey: 'accumulate', mTag: '建仓/吸筹', mTone: 'good' },
    { code: '000767', name: '晋控电力', cost: 21.00, bars: barsTop, main20: 0, mv: 2e10,
      mainCost: 15.0, profit: 0.95, conc: 0.61, mKey: 'distribute', mTag: '高位派发', mTone: 'bad' }
  ];

  const today = w.todayStr();
  w.G.dayBars = {}; w.G.chipMap = {}; w.G.v3Map = {}; w.G.quoteMap = {}; w.G.cfg.holdings = [];
  for (const s of stocks) {
    const last = s.bars[s.bars.length - 1].c;
    w.G.dayBars[s.code] = s.bars;
    w.G.chipMap[s.code] = {
      code: s.code, name: s.name, date: today, price: last,
      chips: { mainCost: s.mainCost, profitRatio: s.profit, concentration: s.conc, avgCost: s.mainCost },
      flows: { main20: s.main20, main5: s.main20 / 4 },
      main: { key: s.mKey, tag: s.mTag, tone: s.mTone, desc: '演示：主力方向' },
      retail: { key: 'surrender', tag: '散户在割肉', tone: 'bad', desc: '演示：价格回落中散户净卖出' },
      stance: { actionText: '跟随主力', desc: '演示：主力进、散户出' }
    };
    w.G.quoteMap[w.secidOf({ code: s.code })] = { price: last, chg: 0.8, mv: s.mv, name: s.name };
    w.G.v3Map[s.code] = { at: '2026-09-18', state: 'normal', dirs: [1, 1, 1], srcs: 3, agreeN: 3,
      majority: 1, conf: 0.8, chg: 0.008, mainYi: 0.42, ret20: 0.05, vr: 1.1, conflictDays: 0 };
    w.G.cfg.holdings.push({ code: s.code, name: s.name, cost: s.cost, qty: 1000 });
  }
  /* 本态起始日（让「第 N 天 / 波段定性 / 止损近似」都有数） */
  w.localStorage.setItem('sa_ml_state_v1', JSON.stringify({
    '600703': { k: 'accumulate-zone', d: barsAcc[barsAcc.length - 4].d },
    '000767': { k: 'sell-overheat', d: barsTop[barsTop.length - 2].d }
  }));
  /* 大盘环境：故意给「恐贪低位」→ 触发「恐慌区 · 减仓可更果断」那句
     ⚠️ mlMarketCtx 的优先级是 FNG（若已加载）> STYLE.data.fng，所以两边都要给低位值，
        否则 demo 引导流程把恐贪页数据 load 进来（约 50）会盖掉这里的 24 */
  w.STYLE.loaded = true;
  w.STYLE.data = { date: '2026-09-18', style: { name: '题材主升浪 · 半导体' }, cycle: { cycle: '发酵' }, fng: 24 };
  w.FNG.loaded = true; w.FNG.live = null;
  w.FNG.series = [{ d: '2026-09-18', v: 24 }];
  w.FNG.raws = [{ mom: -0.03, vol: 0.24, vlm: -0.05, mgn: -0.02, mbs: -4e4 }];

  const rows = stocks.map(s => {
    const st = w.weekStage(s.code);
    const key = st ? st.key : '(null)';
    console.log('  ' + s.code + ' ' + s.name + ' → ' + key);
    return '<div class="card" style="margin:16px 0;">' +
      '<div class="chip-hd"><b>' + s.name + ' ' + s.code + '</b>' +
      '<span class="st mute">' + key + '</span></div>' +
      w.v3DetailHtml(s.code) + '</div>';
  }).join('');

  const page = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>S2 中长线详情 · 精简版</title>' + styleTag + '</head><body>' +
    '<div class="wrap"><header><h1>S2 中长线详情 · 精简版（结论 + 状态 + 核心指标着色）</h1></header>' +
    '<div style="background:#f4f5f7;color:#5d6268;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.5;">' +
    '肉眼确认用：小字备注/推理段落（cd-note）已全部撤下，只留<b>彩色结论块</b>、' +
    '<b>状态条</b>和<b>核心指标格（着色的那几个）</b>。页面里的价格/资金/筹码都是' +
    '<b>构造的演示值</b>，不是真实行情；真实数据由控制台联网取。</div>' +
    rows + '</div></body></html>';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page, 'utf8');
  const cnt = (re) => (page.match(re) || []).length;
  const chk = (k) => (page.indexOf(k) >= 0 ? '有' : '缺');
  console.log('写出 ' + OUT + '  ' + (page.length / 1024).toFixed(1) + 'KB');
  console.log('中长线 →', chk('中长线 →') + ' ｜ 波段定性状态条', chk('波段定性') +
    ' ｜ 着色指标格', cnt(/class="cd-v (good|bad|warn)"/g) + ' 个' +
    ' ｜ 状态条', cnt(/class="cd-stat /g) + ' 个' +
    ' ｜ 小字备注(应为 0)', cnt(/class="cd-note"/g) + ' 个' +
    ' ｜ 大盘风格', chk('大盘风格') + ' ｜ 仅环境标注', chk('仅环境标注') +
    ' ｜ 恐慌区力度提示', chk('恐慌区') + ' ｜ 风险控制', chk('风险控制') +
    ' ｜ 仓位提示', chk('别全进全出'));
  process.exit(0);
})().catch(e => { console.log('快照崩溃：' + (e && e.stack || e)); process.exit(1); });
