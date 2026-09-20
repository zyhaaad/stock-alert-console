/* 导出「三页分离」实际渲染快照（监控 / 持仓 / AI 备选推荐 各自独立）
 * 用 jsdom 真跑 console.html 的脚本（demo 模式），导出六块：
 *   ① 监控首页：只管监控，页面上没有任何持仓录入/展示元素（2026-09-16 规格）
 *   ② 监控卡展开面板：只有提醒设置，没有成本/股数
 *   ③ 「我的持仓」页：统计条（只报条数）+ 持仓卡列表（实时价 + 展开看结论），可删
 *   ④ 空持仓：给引导文案，绝不是 0 元
 *      ★ 2026-09-20：汇总卡（pfBox / .pf*）已随「不再记账」整体删除，本快照随之改为抓统计条。
 *   ⑤ 「AI 备选推荐」页：第三个独立页面，含推荐理由 / 买卖纪律 / 胜负回填
 *   ⑥ 更多面板：三个独立入口（我的持仓 / AI 备选推荐 / 删除记录）
 * 运行：node _tests/position-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM } = require(path.join(WS, 'jsdom'));

const SRC = 'D:/mywork/stock-alert-console/console.html';
const OUT = 'D:/mywork/_preview/position-account-render.html';
const html = fs.readFileSync(SRC, 'utf8');

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/console.html?demo=1'
  });
  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 700));

  const df = d.getElementById('demoflag');
  if (df) df.remove();
  const map = w.DEMO_QUOTES;
  const listOf = () => d.getElementById('list');

  /* ---- ⓪ 首页仪表盘：距触发最近 / 持仓透视 / 今日推荐 ---- */
  w.G.homeMode = 'dash';
  w.renderHome();
  w.G.cfg.holdings = [
    { code: '002415', name: '海康威视', cost: 30.00, qty: 1000, addedAt: '2026-08-21' },
    { code: '600519', name: '贵州茅台', cost: 1620.00, qty: 100, addedAt: '2026-09-01' }
  ];
  /* ★ 2026-09-17 主力博弈 V3：仪表盘上的持仓行为行已换成 V3 多源核验判定；
     旧透视（chipMap）代码保留但不再渲染。 */
  w.G.chipMap = w.demoChipData();
  w.G.v3Map = w.demoV3Data();
  /* 5 日线覆盖三种天数：002415=0（不显示，验证「没有就不显示」）/ 600733=1（只标天数）/
     600519=3、600036=2（≥2 提示卖出） */
  w.G.ma5Cache = {
    '002415': { at: w.todayStr(), st: { days: 0, sig: null, ma5: 0 } },
    '600733': { at: w.todayStr(), st: { days: 1, sig: 'watch', ma5: 4.42 } },
    '600519': { at: w.todayStr(), st: { days: 3, sig: 'sell', ma5: 1230.40 } },
    '600036': { at: w.todayStr(), st: { days: 2, sig: 'sell', ma5: 32.55 } }
  };
  w.PICKS.data = w.picksDemoData(); w.PICKS.loaded = true; w.renderPicks();
  w.renderDash(map);
  const dashHtml = d.getElementById('dash').outerHTML;
  const dashOk = ['距触发最近', '持仓 · 主力博弈', '今日推荐', 'V3', '5日线']
    .every(s => dashHtml.indexOf(s) >= 0);
  const dashNoOld = dashHtml.indexOf('走势') < 0 && dashHtml.indexOf('机会') < 0 && dashHtml.indexOf('风险') < 0;

  /* ---- ① 监控首页（全部监控列表）：纯监控 ---- */
  w.G.cfg.stocks = [
    { code: '002415', name: '海康威视', condition: 'lte', target: 31, enabled: true, addedAt: '2026-08-21' },
    { code: '600733', name: '北汽蓝谷', condition: 'lte', target: 3, enabled: false, addedAt: '2026-09-14' },
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true, addedAt: '2026-09-01' },
    { code: '300750', name: '宁德时代', condition: 'gte', target: 200, enabled: true, addedAt: '2026-09-10' }
  ];
  w.G.cfg.holdings = [
    { code: '002415', name: '海康威视', cost: 30.00, qty: 1000, addedAt: '2026-08-21' },
    { code: '600036', name: '招商银行', cost: 28.00, qty: 2000, addedAt: '2026-07-15' }
  ];
  w.G.openIdx = -1;
  w.renderActive(map);
  const monitorList = listOf().outerHTML;
  const noPos = monitorList.indexOf('posadd') < 0 && monitorList.indexOf('class="pos"') < 0 &&
    monitorList.indexOf('持仓成本') < 0;

  /* ---- ② 监控卡展开面板：只有提醒设置 ---- */
  w.G.openIdx = 0;
  w.renderActive(map);
  const openedCard = listOf().querySelector('.stock[data-i]').outerHTML;
  w.G.openIdx = -1;
  w.renderActive(map);

  /* ---- ③ 我的持仓页：汇总卡 + 独立清单 ---- */
  w.G.cfg.holdings = [
    { code: '002415', name: '海康威视', cost: 30.00, qty: 1000, addedAt: '2026-08-21' },
    { code: '600733', name: '北汽蓝谷', cost: 3.02, qty: 5000, addedAt: '2026-08-28' },
    { code: '600519', name: '贵州茅台', cost: 1620.00, qty: 100, addedAt: '2026-09-01' },
    { code: '600036', name: '招商银行', cost: 28.00, qty: 2000, addedAt: '2026-07-15' }
  ];
  w.renderHoldings(map);
  /* 先展开一只，让 V3 详情块也进快照（否则只能看到摘要行） */
  (function(){
    const c0 = d.getElementById('hList').querySelector('.hg[data-code="600519"]');
    if (c0) { const a = c0.querySelector('.hg-acts'); if (a) a.classList.add('open'); }
  })();
  const holdingsPage = point(d.getElementById('pgHoldings'));
  const hListHtml = d.getElementById('hList').innerHTML;
  const hRows = d.getElementById('hList').querySelectorAll('.hg[data-code]').length;
  const hPx = (hListHtml.match(/hg-pxrow/g) || []).length;        // 实时价行数
  const hChip = (hListHtml.match(/class="chip-brief"/g) || []).length;  // V3 判定摘要条数
  const hMa5 = (hListHtml.match(/class="hg-ma5/g) || []).length;        // 5 日线标识个数
  const noMonTag = hListHtml.indexOf('hg-tag') < 0 && hListHtml.indexOf('未监控') < 0;

  /* ---- ④ 空持仓：引导文案 ---- */
  w.G.cfg.holdings = [];
  w.renderHoldings(null);
  /* ★ 2026-09-20：pfBox 已删除 → 空持仓态改抓统计条 #hCount（文案「还没有持仓记录。」） */
  const pfEmpty = point(d.getElementById('hCount'));
  w.renderHoldings(map);

  /* ---- ⑤ AI 备选推荐页 ---- */
  w.PICKS.data = w.picksDemoData();
  w.PICKS.loaded = true;
  w.renderPicks();
  const picksPage = point(d.getElementById('pgPicks'));
  /* ⚠️ 弱转强观察池也用 .pick 类（比本快照脚本晚加），统计「推荐条目」必须排除带行内 style 的那批 */
  const pickNodes = [...d.getElementById('picksList').querySelectorAll('.pick')];
  const pickCount = pickNodes.filter(n => !n.getAttribute('style')).length;
  const weakCount = pickNodes.filter(n => !!n.getAttribute('style')).length;

  /* ---- ⑥ 更多面板 ---- */
  const sheet = point(d.getElementById('sheetMore'));
  const navOk = sheet.indexOf('rowHoldings') >= 0 && sheet.indexOf('rowPicks') >= 0 && sheet.indexOf('rowArchive') >= 0;

  let css = '';
  d.querySelectorAll('style').forEach(s => { css += s.textContent + '\n'; });

  const out = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>三页分离 · 实际渲染快照</title>
<style>${css}
body{margin:0;padding:24px;background:#eef1f5;display:flex;flex-direction:column;align-items:center;gap:20px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
.snapbar{font:13px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;color:#3c4149;max-width:420px;}
.snapbar b{color:#111;font-size:14px}
.snapbar code{background:#fff;padding:1px 5px;border-radius:5px;border:1px solid #dde1e7;font-size:12px}
.snapbox{width:390px;background:#f4f4f6;border-radius:22px;box-shadow:0 10px 34px rgba(20,28,42,.14);padding:14px 0 4px;overflow:hidden;}
.snapbox.full{padding:0;position:relative;height:690px;}
/* 页面本身是 position:fixed 的整屏页，放进快照里要改成绝对定位到这个小屏里 */
.snapbox.full .page{position:absolute;inset:0;border-radius:22px;}
.snapchk{font:11px/1.8 system-ui,sans-serif;color:#6d7278;background:#fff;border:1px solid #e3e6ea;
  border-radius:12px;padding:10px 14px;max-width:420px;}
.snapchk b{color:#23262b}
</style></head>
<body>

<div class="snapbar">
  <b>⓪ 首页仪表盘 —— 恐贪之外只放三块卡</b><br>
  距触发最近的一只监控股（点开看全部）、<b>持仓 · 主力博弈</b>（V3 多源核验判定 +
  5 日线连续站上天数，点某一只进持仓详情）、今日推荐入口。
  恐贪指数吸顶在本卡片上方。<br>
  <b>2026-09-17 变更</b>：持仓卡上的行为判定已从筹码透视换成<b>主力博弈 V3</b>
  （当日涨跌 / 当日主力净额 / 20 日趋势三源方向投票，共识 ≥66% 才给主信号，冲突就观望）。
</div>
<div class="snapbox">${dashHtml}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>① 全部监控列表 —— 点「距触发最近」卡后展开</b><br>
  2026-09-16 规格：监控页不再有任何持仓元素（没有持仓行、没有「＋ 记录持仓」、
  面板里也没有成本/股数）。持仓的记录与展示全部收进第 ③ 页。
  本文件由 jsdom 真跑 <code>console.html</code> 脚本导出，非手工绘制。
</div>
<div class="snapbox">${monitorList}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>② 监控卡展开面板 —— 只有提醒设置</b><br>
  条件 + 目标价，改完点保存。找不到任何"持仓"字样。
</div>
<div class="snapbox">${openedCard}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>③「我的持仓」页 —— 独立清单 + 各引擎结论（2026-09-20 定稿）</b><br>
  统计条只报「共 N 条持仓」+ 持仓卡列表：<b>只可删</b>（不再录成本/股数，因此也不算盈亏/市值/成本合计）。<br>
  每条卡显示<b>实时价</b>与<b>5 日线连续站上标识</b>（≥2 天提示卖出 / 1 天只标天数 / 0 天不显示）。
  点开卡片只给<b>结论</b>：主力博弈（V3）+ 散户行为 + 综合研判（次要参考，中性状态条）+ 中长线（S2，含第 N 天）。<br>
  三源明细 / 共识票数 / 冲突天数 / 置信度 / 指标格等推理中间量已全部撤下；
  风控（止损位）与仓位行也随记账口径一并撤（无成本即无基准），但函数保留可回退。
</div>
<div class="snapbox full">${holdingsPage}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>④ 空持仓 —— 引导文案，绝不是 0 元</b><br>
  一条持仓都没记时，统计条给引导文案（「还没有持仓记录。」），表单在「记一笔持仓」入口。
</div>
<div class="snapbox">${pfEmpty}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>⑤「AI 备选推荐」页 —— 第三个独立页面</b><br>
  云端每日筛选（不含 ST / 科创板），写明推荐理由与买卖纪律，
  按「10 个交易日 ±2%」回填胜负、追踪胜率。2026-09-17 起每条还显示
  <b>实时价 + 较推荐日涨跌</b>。不推送，只在这里看。
</div>
<div class="snapbox full">${picksPage}</div>

<div class="snapbar" style="margin-top:8px;">
  <b>⑥ 更多面板 —— 三个独立入口</b><br>
  我的持仓 / AI 备选推荐 / 删除记录，各进各的页，互不掺和。
</div>
<div class="snapbox">${sheet}</div>

<div class="snapchk">
  快照自检：⓪ 仪表盘三卡齐全 <b>${dashOk ? '✓' : '✗'}</b> ·
  ⓪b 仪表盘无旧「走势/机会/风险」 <b>${dashNoOld ? '✓' : '✗'}</b> ·
  ① 监控页无持仓元素 <b>${noPos ? '✓' : '✗'}</b> ·
  ② 面板含成本框 <b>${openedCard.indexOf('e-cost') >= 0 ? '✗ 有（不该有）' : '✓ 无'}</b> ·
  ③ 持仓页 <b>${hRows}</b> 条（实时价 ${hPx} / V3 摘要 ${hChip} / 5日线标识 ${hMa5} /
  无监控标识 <b>${noMonTag ? '✓' : '✗'}</b>）·
  ⑤ 推荐页 <b>${pickCount}</b> 条备选（另有 ${weakCount} 条弱转强观察池） ·
  ⑥ 三入口齐全 <b>${navOk ? '✓' : '✗'}</b>
</div>

</body></html>`;

  fs.writeFileSync(OUT, out);
  const allOk = dashOk && dashNoOld && noPos && openedCard.indexOf('e-cost') < 0 && hRows === 4 &&
    hPx === 4 && hChip === 4 && hMa5 === 3 && noMonTag && pickCount === 2 && weakCount === 1 && navOk;
  console.log('已写出：' + OUT + '  ' + Math.round(out.length / 1024) + ' KB');
  console.log('  ⓪ 首页仪表盘三卡齐全（距触发最近/持仓·主力博弈/今日推荐）：' + dashOk);
  console.log('  ⓪b 仪表盘已无旧「走势/机会/风险」：' + dashNoOld);
  console.log('  ① 监控页无持仓元素：' + noPos);
  console.log('  ② 面板无成本框：' + (openedCard.indexOf('e-cost') < 0));
  console.log('  ③ 持仓页行数：' + hRows + '（实时价 ' + hPx + ' / V3 摘要 ' + hChip + ' / 5日线标识 ' + hMa5 + ' / 无监控标识 ' + noMonTag + '）');
  console.log('  ⑤ 推荐页条数：' + pickCount + '（弱转强观察池 ' + weakCount + ' 条，不计推荐）');
  console.log('  ⑥ 三入口齐全：' + navOk);
  console.log(allOk ? 'ALL GREEN' : 'FAILED');
  process.exit(allOk ? 0 : 1);
})();

/* 只保留某个元素的 outerHTML（用于把页面里的一块单独摆进快照） */
function point(el) { return el ? el.outerHTML : '<div class="empty">（未渲染）</div>'; }
