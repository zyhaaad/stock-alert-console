/* 持仓账本 · DOM 级功能测试（私有）
 * 用 jsdom 真跑预览副本的脚本，验证三页分离后的行为：
 *   · 监控页（首页 #list）：只管监控，**没有任何持仓录入/展示入口**
 *   · 持仓页（pgHoldings）：汇总卡（pfBox）+ 持仓清单 + 录入表单，自成一体
 *   · 推荐页（pgPicks）：AI 备选推荐列表，第三个独立页面
 * 规格依据：用户 2026-09-16「监控的股票不需要记录持仓操作；监控/推荐/持仓
 * 不要显示在一个列表页面里，要独立展示」。
 * 运行：node _tests/position-dom-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);

let JSDOM, VirtualConsole;
try {
  const j = require(path.join(WS, 'jsdom'));
  JSDOM = j.JSDOM; VirtualConsole = j.VirtualConsole;
} catch (e) {
  console.log('SKIP：未安装 jsdom（' + e.message + '）');
  process.exit(0);
}

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, name + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
function has(hay, needle, name) { ok(String(hay).indexOf(needle) >= 0, name + '（找不到「' + needle + '」）'); }
function notHas(hay, needle, name) { ok(String(hay).indexOf(needle) < 0, name + '（不该出现「' + needle + '」）'); }
/* NodeList 没有 .find，这里转成数组用 */
function qa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html';
const html = fs.readFileSync(PREVIEW, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc
  });
  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 700));

  ok(errors.length === 0, '脚本执行期无报错' + (errors.length ? ' — ' + errors[0] : ''));
  ok(typeof w.PositionCore === 'object' && w.PositionCore, 'POSITION-CORE 已注入并挂到 window.PositionCore');
  ok(typeof w.SignalCore === 'object' && w.SignalCore, 'SIGNAL-CORE 已注入并挂到 window.SignalCore');
  ok(typeof w.PositionCore.portfolioOf === 'function', 'PositionCore.portfolioOf 可用');

  /* ---------- 1. ★ 监控首页：三页分离后，这里没有任何持仓元素 ---------- */
  const listEl = d.getElementById('list');
  eq(listEl.querySelectorAll('.pf').length, 0, '★ 监控首页不再渲染持仓汇总卡（汇总卡搬去持仓页）');
  eq(listEl.querySelectorAll('.pos').length, 0, '★ 监控首页不再有个股持仓行');
  eq(listEl.querySelectorAll('.posadd').length, 0, '★ 监控首页没有「＋ 记录持仓」入口');
  notHas(listEl.textContent, '记录持仓', '监控首页读不到「记录持仓」字样');
  eq(listEl.querySelectorAll('.stock[data-i]').length, 2, '监控首页照常渲染 2 张股票卡');
  ok(!!listEl.querySelector('.stock[data-i] .px'), '股票卡照常显示现价');
  ok(!!listEl.querySelector('.stock[data-i] .meta .cond'), '股票卡照常显示提醒条件');

  /* ---------- 2. ★ 监控卡展开面板：只有提醒设置，没有成本/股数 ---------- */
  const c0 = listEl.querySelector('.stock[data-i]');
  const acts0 = c0.querySelector('.acts');
  ok(!!acts0, '第 1 只卡片有展开面板');
  eq(acts0.querySelector('.e-cost'), null, '★ 面板里没有 .e-cost（持仓录入已收归持仓页）');
  eq(acts0.querySelector('.e-qty'), null, '★ 面板里没有 .e-qty');
  eq(acts0.querySelector('.posgroup'), null, '★ 面板里没有持仓分组');
  has(acts0.textContent, '提醒设置', '面板保留「提醒设置」分组');
  notHas(acts0.textContent, '持仓成本', '面板读不到「持仓成本」字样');
  eq(!!acts0.querySelector('[data-act="saveEdit"]'), true, '保存按钮还在');
  eq(!!acts0.querySelector('[data-act="del"]'), true, '删除监控按钮还在');

  /* ---------- 3. ★ 面板保存：只写条件与目标价，持仓清单纹丝不动 ---------- */
  c0.querySelector('.e-target').value = '31';
  acts0.querySelector('[data-act="saveEdit"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(w.G.cfg.stocks[0].target, 31, '目标价被保存');
  eq(w.G.cfg.stocks[0].condition, 'lte', '提醒条件被保存');
  eq(w.G.cfg.holdings.length, 3, '★ 保存监控不改持仓清单（预览持仓 3 条原样）');
  eq(w.PositionCore.findHolding(w.G.cfg.holdings, '002415').cost, 30, '★ 海康威视的持仓成本保持 30 不变');

  /* ---------- 4. ★ 统一添加页（2026-09-17 用户需求）：一个入口，两种用途 ---------- */
  const addPage = d.getElementById('pgAdd');
  eq(d.getElementById('fCost'), null, '★ 添加页已删掉持仓成本输入框（旧 ID）');
  eq(d.getElementById('fQty'), null, '★ 添加页已删掉持仓股数输入框（旧 ID）');
  has(addPage.textContent, '开提醒', '用途分段含「开提醒」');
  has(addPage.textContent, '记持仓', '用途分段含「记持仓」');
  has(addPage.textContent, '两份独立清单', '说明开提醒与记持仓是两份独立清单');
  eq(d.getElementById('addForm').hidden, true, '★ 未选中股票时整块收起（首屏只有一个搜索框）');
  eq(d.getElementById('pnlHolding').hidden, true, '「记持仓」面板默认收起');
  eq(d.getElementById('pnlMonitor').hidden, false, '「开提醒」面板默认就是显示的那一侧');
  // 旧的两套录入入口必须彻底下线：搜索只剩一套、股票字段也只有一份
  eq(d.getElementById('hQuery'), null, '★ 持仓页的独立搜索框 #hQuery 已下线');
  eq(d.getElementById('hSrResult'), null, '★ #hSrResult 已下线');
  eq(d.getElementById('hCode'), null, '★ 持仓页的 #hCode 已下线（改与 #fCode 共用）');
  eq(d.getElementById('hName'), null, '★ 持仓页的 #hName 已下线（改与 #fName 共用）');
  eq(d.getElementById('hManualFields'), null, '★ 第二套手输降级通道 #hManualFields 已下线');
  ok(typeof w.hSearch === 'undefined', '★ hSearch 函数已删除');
  ok(typeof w.hPick === 'undefined', '★ hPick 函数已删除');
  ok(!/\.hsr-it\{/.test(html), '★ .hsr-* 样式定义已清干净');
  has(d.getElementById('pgHoldings').textContent, '记一笔持仓', '持仓页提供跳统一添加页的入口');

  /* ---------- 5. ★ 统一添加页端到端：开提醒 / 记持仓，两份清单独进各的 ---------- */
  // 桩：固定候选，走真实 srBranch 分流（唯一 / 太泛 / 非 A 股）
  w.srFetchItems = async function (q) {
    if (q.indexOf('银行') >= 0) return [
      { Code: '601939', Name: '建设银行', MktNum: '1', SecurityTypeName: '沪A', Classify: 'AStock' },
      { Code: '600016', Name: '民生银行', MktNum: '1', SecurityTypeName: '沪A', Classify: 'AStock' },
      { Code: '00700', Name: '腾讯控股', MktNum: '116', SecurityTypeName: '港股', Classify: 'HKStock' }
    ]
    if (q.indexOf('腾讯') >= 0) return [{ Code: '00700', Name: '腾讯控股', MktNum: '116', SecurityTypeName: '港股', Classify: 'HKStock' }]
    return [{ Code: '600519', Name: '贵州茅台', MktNum: '1', SecurityTypeName: '沪A', Classify: 'AStock' }]
  }

  // 用户唯一入口：首页右下角 FAB
  d.getElementById('fabAdd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  ok(d.getElementById('pgAdd').classList.contains('on'), '★ 首页 FAB 打开统一添加页');
  eq(d.getElementById('addForm').hidden, true, '★ 打开时表单收起：先让用户找到股票');
  has(d.getElementById('srResult').textContent, '两份清单互相独立', '未选股票时给出用途引导');

  // 没选股票就提交 → 明确提示，两份清单都不许动
  const stocks0 = w.G.cfg.stocks.length, holds0 = w.G.cfg.holdings.length;
  d.getElementById('btnAddStock').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  has(d.getElementById('toast').textContent, '请先搜索并选中一只股票', '未选股票就提交 → 明确提示');
  eq(w.G.cfg.stocks.length, stocks0, '未选股票时监控清单不变');
  eq(w.G.cfg.holdings.length, holds0, '未选股票时持仓清单不变');

  // 搜「银行」→ 关键词太泛 → 列 A 股候选（港股被 srIsA 滤掉）
  d.getElementById('fQuery').value = '银行';
  await w.srSearch();
  let cands = qa(d.getElementById('srResult'), '.sr-cand[data-code]');
  eq(cands.length, 2, '太泛关键词列出 2 只 A 股候选（港股被过滤）');
  const candCodes = cands.map(x => x.getAttribute('data-code'));
  ok(candCodes.indexOf('601939') >= 0 && candCodes.indexOf('600016') >= 0, '候选是建设银行 / 民生银行');
  const pickCode = candCodes[1];

  // 点候选 → 选中 + 表单展开 + 默认落在「开提醒」
  cands[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('fCode').value, pickCode, '点候选 → 代码回填 #fCode');
  has(d.getElementById('srResult').textContent, '已选中', '选中卡出现');
  eq(d.getElementById('addForm').hidden, false, '★ 选中后表单才展开');
  eq(d.getElementById('pnlMonitor').hidden, false, '默认落在「开提醒」面板');
  eq(d.getElementById('pnlHolding').hidden, true, '此刻「记持仓」面板收起');
  eq(d.getElementById('addSeg').querySelector('.s.on').getAttribute('data-tab'), 'monitor', '分段高亮「开提醒」');
  has(d.getElementById('addNow').textContent, '未监控', '现状条说明这只还没在监控清单里');

  // 填条件 → 提交 → 只进监控清单
  d.getElementById('fCond').value = 'lte';
  d.getElementById('fTarget').value = '6.5';
  d.getElementById('fTarget').dispatchEvent(new w.Event('input', { bubbles: true }));
  has(d.getElementById('condPreview').textContent, '微信提醒你一条', '条件预览实时给出提醒规则');
  d.getElementById('btnAddStock').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.G.cfg.stocks.length, stocks0 + 1, '★ 开提醒 → 监控清单 +1');
  eq(w.G.cfg.holdings.length, holds0, '★ 开提醒不产生任何持仓记录（两份清单互不污染）');
  const newStock = w.G.cfg.stocks[w.G.cfg.stocks.length - 1];
  eq(newStock.code, pickCode, '新监控项就是刚选的那只');
  eq('cost' in newStock, false, '★ 监控项上没有 cost 字段');
  eq('qty' in newStock, false, '★ 监控项上没有 qty 字段');

  // 提交结果确认卡（不再默默关页）
  let okCard = d.getElementById('srResult').querySelector('.add-ok');
  ok(!!okCard, '★ 提交后出现结果确认卡（旧版是默默关页）');
  has(okCard.textContent, '已开始监控', '确认卡写明「已开始监控」');
  has(okCard.textContent, '价格 ≤ 6.50 元', '确认卡带上提醒条件');
  ok(d.getElementById('pgAdd').classList.contains('on'), '★ 提交后留在页内，可以接着加下一只');
  const otherBtn = qa(okCard, '[data-ok]').find(b => b.getAttribute('data-ok') === 'other');
  ok(!!otherBtn, '★ 确认卡给「顺便记持仓」的出口（这只还没记持仓）');
  has(otherBtn.textContent, '顺便记持仓', '出口文案是「顺便记持仓」');

  // 点「顺便记持仓」→ 切面板，股票不丢、不用重搜
  otherBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('addSeg').querySelector('.s.on').getAttribute('data-tab'), 'holding', '★ 一键切到「记持仓」');
  eq(d.getElementById('fCode').value, pickCode, '★ 切换用途后股票不丢');
  eq(d.getElementById('pnlHolding').hidden, false, '「记持仓」面板展开');
  has(d.getElementById('addNow').textContent, '这只也在监控里', '现状条指出它也在监控里');

  // 切回「开提醒」：现状条换成监控侧视角，并给出跳去改持仓的捷径
  d.getElementById('addSeg').querySelector('.s[data-tab="monitor"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq(d.getElementById('pnlMonitor').hidden, false, '点分段能切回「开提醒」');
  eq(d.getElementById('pnlHolding').hidden, true, '同时收起「记持仓」');
  eq(d.getElementById('fCode').value, pickCode, '来回切换股票始终不丢');
  has(d.getElementById('addNow').textContent, '已在监控清单', '现状条指出它已在监控清单里');
  has(d.getElementById('btnAddStock').textContent, '更新监控条件', '★ 已在监控 → 按钮改成「更新」');
  ok(d.getElementById('addNow').querySelector('[data-go]') === null, '这只还没记持仓 → 不出现跳去改持仓的捷径');
  d.getElementById('addSeg').querySelector('.s[data-tab="holding"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq(d.getElementById('pnlHolding').hidden, false, '再切回「记持仓」继续填');
  has(d.getElementById('addNow').textContent, '去改提醒条件', '记持仓侧给出「去改提醒条件」的捷径（这只在监控里）');

  // 代码非法 / 名称缺失的校验（股票字段两个面板共用，所以只在统一页里判一次）
  d.getElementById('fCode').value = '123';
  d.getElementById('btnAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  has(d.getElementById('toast').textContent, '6 位数字', '代码非 6 位 → 报错');
  d.getElementById('fCode').value = pickCode;
  d.getElementById('fName').value = '';
  d.getElementById('btnAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  has(d.getElementById('toast').textContent, '股票名称', '名称为空 → 报错');
  d.getElementById('fName').value = '民生银行';

  /* ★ 2026-09-20：持仓不再填成本/股数 —— 选中即提交，只进持仓清单 */
  has(d.getElementById('hPreview').textContent, '民生银行', '预览只确认「记下哪一只」（不再算成本金额）');
  has(d.getElementById('btnAddHolding').textContent, '保存持仓', '还没有持仓记录时按钮是「保存持仓」');
  d.getElementById('btnAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.G.cfg.holdings.length, holds0 + 1, '★ 记持仓 → 持仓清单 +1');
  eq(w.G.cfg.stocks.length, stocks0 + 1, '★ 记持仓不往监控清单里塞东西');
  const nh = w.PositionCore.findHolding(w.G.cfg.holdings, pickCode);
  ok(!!nh && nh.code === pickCode, '★ 新持仓只记代码与名称（成本/股数不再需要）');
  ok(d.getElementById('hCost') === null && d.getElementById('hQty') === null,
    '★ 添加页的成本/股数输入框已下线');
  ok(!!d.getElementById('srResult').querySelector('.add-ok'), '记持仓也有结果确认卡');

  // 「再添加一只」→ 回到干净的搜索态
  qa(d.getElementById('srResult'), '[data-ok]').find(b => b.getAttribute('data-ok') === 'again')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq(d.getElementById('fCode').value, '', '「再添加一只」清空已选股票');
  eq(d.getElementById('fQuery').value, '', '并把搜索框也清空');
  eq(d.getElementById('addForm').hidden, true, '表单重新收起，回到「先找股票」');

  // 非 A 股：明确提示，且不会被选中
  d.getElementById('fQuery').value = '腾讯';
  await w.srSearch();
  has(d.getElementById('srResult').textContent, '不是沪深 A 股', '非 A 股明确提示');
  eq(d.getElementById('addForm').hidden, true, '非 A 股不会被选中，表单保持收起');

  // 手输降级通道：搜索挂了也要能加
  d.getElementById('btnManual').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  eq(d.getElementById('srFallback').hidden, false, '「手输 6 位代码」能展开降级通道');
  d.getElementById('fCode').value = '600000';
  d.getElementById('fName').value = '浦发银行';
  w.addFillFields(); w.updateCondPreview(); w.addFormSync();
  eq(d.getElementById('addForm').hidden, false, '手输填好后表单同样展开');

  /* ★ 已在监控的股票也能被选中 —— 旧版在这里「拦住不让选」，
     在合并入口后会把「改条件」和「补记持仓」两条路都堵死。 */
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true },
    { code: '300750', name: '宁德时代', condition: 'gte', target: 190, enabled: true }
  ];
  d.getElementById('fQuery').value = '茅台';
  await w.srSearch();
  eq(d.getElementById('fCode').value, '600519', '★ 已在监控的股票照样能选中');
  eq(d.getElementById('fCond').value, 'gte', '★ 带出它现在的提醒条件');
  eq(d.getElementById('fTarget').value, '1600', '★ 带出它现在的目标价');
  has(d.getElementById('addNow').textContent, '这只也在监控里', '现状条指出它也在监控里');
  has(d.getElementById('btnAddStock').textContent, '更新监控条件', '★ 按钮改成「更新」，不会被误认为重复添加');
  d.getElementById('addSeg').querySelector('.s[data-tab="monitor"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  has(d.getElementById('addNow').textContent, '已在监控清单', '切到「开提醒」后，现状条确认它在监控清单里');
  d.getElementById('fTarget').value = '1700';
  d.getElementById('btnAddStock').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.G.cfg.stocks.filter(s => s.code === '600519').length, 1, '★ 走更新路径，不会产生重复条目');
  eq(w.PositionCore.findHolding(w.G.cfg.holdings, '600519'), null, '★ 改监控条件不产生持仓记录');
  has(d.getElementById('srResult').textContent, '已更新', '确认卡写明「已更新」');

  // 持仓页的入口 → 直接预选到「记持仓」
  d.getElementById('btnGoAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  ok(d.getElementById('pgAdd').classList.contains('on'), '持仓页「记一笔持仓」进统一添加页');
  eq(d.getElementById('addSeg').querySelector('.s.on').getAttribute('data-tab'), 'holding', '★ 预选到「记持仓」');
  eq(d.getElementById('pnlHolding').hidden, false, '记持仓面板直接展开');
  eq(d.getElementById('pnlMonitor').hidden, true, '开提醒面板同时收起');
  eq(d.getElementById('addForm').hidden, true, '还没选股票 → 表单仍整块收起');
  eq(d.getElementById('addNow').innerHTML, '', '没选股票时不显示现状条（避免空标签）');

  // 「监控里还没记持仓」的快捷标签：点一下直接选中并切到记持仓
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1700, enabled: true },
    { code: '300750', name: '宁德时代', condition: 'gte', target: 200, enabled: true }
  ];
  w.G.cfg.holdings = [{ code: '600519', name: '贵州茅台', cost: 1620, qty: 100 }];
  w.renderHQuick();
  eq(d.getElementById('hQuickWrap').style.display !== 'none', true, '有「监控了但没记持仓」的股票 → 显示快捷区');
  const qchips = qa(d.getElementById('hQuick'), '.chip[data-code]');
  eq(qchips.length, 1, '只剩 300750 没记持仓');
  eq(qchips[0].getAttribute('data-code'), '300750', '快捷标签是 300750');
  qchips[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('fCode').value, '300750', '★ 点快捷标签 → 直接选中该股票（不用重搜）');
  eq(d.getElementById('fName').value, '宁德时代', '名称一起带进来');
  eq(d.getElementById('addSeg').querySelector('.s.on').getAttribute('data-tab'), 'holding', '并切到「记持仓」');
  has(d.getElementById('addNow').textContent, '未记持仓', '现状条说明它还没记持仓');
  w.switchView('monitor');
  w.hidePage('pgAdd');

  /* ---------- 6. ★ 持仓页：汇总卡 + 清单，自成一体 ---------- */
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true, addedAt: '2026-09-01' },
    { code: '300750', name: '宁德时代', condition: 'gte', target: 200, enabled: true, addedAt: '2026-09-01' }
  ];
  w.G.cfg.holdings = [
    { code: '600519', name: '贵州茅台', cost: 1620, qty: 100 },   // 亏
    { code: '600036', name: '招商银行', cost: 45, qty: 2000 },    // 只持有、未监控
    { code: '999999', name: '查无此股', cost: 10, qty: 100 }      // 行情取不到（未计价样本）
  ];
  const map2 = { '1.600519': { price: 1565.60 }, '0.300750': { price: 188.30 }, '1.600036': { price: 33.10 } };
  w.renderActive(map2);
  w.openHoldings();
  await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('pgHoldings').classList.contains('on'), 'openHoldings 真的把页面切到持仓页');
  w.renderHoldings(map2);   // 直接传价重渲染，断言不依赖演示行情的异步时序

  const pgH = d.getElementById('pgHoldings');
  has(pgH.textContent, '两批股票', '持仓页开篇就说明"持仓和监控是两批股票"');

  /* ★ 2026-09-20：持仓不再记成本/股数 → 顶部汇总卡（浮盈/市值/成本合计）整体撤下 */
  ok(d.getElementById('pfBox') === null, '★ 持仓页不再有汇总卡 pfBox（没有成本基准就不算账）');
  notHas(pgH.textContent, '浮盈', '★ 持仓页不再出现任何浮盈口径');
  notHas(pgH.textContent, '成本合计', '★ 统计条不再报成本合计');
  has(d.getElementById('hCount').textContent, '共 3 条持仓', '★ 统计条只报条数');

  // 列表渲染
  const hList = d.getElementById('hList');
  const hRows = hList.querySelectorAll('.hg[data-code]');
  eq(hRows.length, 3, '持仓页列出 3 条持仓（按持仓清单，不是监控清单）');
  has(hRows[0].textContent, '贵州茅台', '第 1 条是贵州茅台');
  has(hRows[1].textContent, '招商银行', '第 2 条是招商银行（只在持仓清单里、不在监控里，也照样列出）');

  /* ★ 2026-09-17：持仓卡显示实时价；并且不再有「监控中/未监控」标识 */
  ok(!!hRows[0].querySelector('.hg-pxrow .hg-px'), '★ 持仓卡新增实时价行（现价大字）');
  has(hRows[0].textContent, '1565.60', '★ 持仓卡显示实时价（600519 现价 1565.60）');
  has(hRows[0].querySelector('.hg-rt').textContent, '实时价', '实时价右上方标注「实时价」');
  eq(hRows[0].querySelector('.hg-pnl'), null, '★ 持仓卡的浮盈行已撤下（不再记成本，算不出浮盈）');
  eq(hRows[0].querySelector('.hg-tag'), null, '★ 持仓卡不再有「监控中/未监控」标签');
  eq(d.getElementById('hList').querySelectorAll('.hg-tag').length, 0, '★ 整页持仓卡都没有监控状态标识');
  notHas(hRows[0].textContent, '未监控', '★ 持仓卡读不到「未监控」字样');
  has(hRows[2].textContent, '未取到行情价', '取不到行情的持仓明确提示（不冒充 0）');

  has(hRows[0].querySelector('.hg-acts').textContent, '删除持仓', '每条都有「删除持仓」');
  for (const hr of hRows) {
    eq(hr.querySelector('[data-act="hgMonitor"]'), null, '★ 持仓卡已无「开价格提醒」按钮（2026-09-16 用户确认移除该操作）');
  }

  // 汇总条 + 菜单角标
  has(d.getElementById('hCount').textContent, '共 3 条持仓', '持仓页统计条正确');
  has(d.getElementById('hCount').textContent, '共 3 条持仓', '★ 统计条只报条数（2026-09-20：成本合计已随记账一起撤下）');
  notHas(d.getElementById('hCount').textContent, '没开提醒', '★ 统计条不再提「没开提醒」');
  eq(d.getElementById('hCnt').textContent, '3', '「更多」菜单里的持仓角标同步为 3');

  /* 补记 300750 的持仓：★ 2026-09-17 起录入只有一个入口（统一添加页），
     这里从持仓页的「记一笔持仓」进，再用「监控里还没记持仓」的快捷标签选股票。 */
  d.getElementById('btnGoAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  const quickWrap = d.getElementById('hQuickWrap');
  eq(quickWrap.style.display !== 'none', true, '有「监控了但没记持仓」的股票 → 显示快捷区');
  const chips = qa(d.getElementById('hQuick'), '.chip[data-code]');
  eq(chips.length, 1, '只剩 300750 没记持仓（600519 已记）');
  eq(chips[0].getAttribute('data-code'), '300750', '快捷标签是 300750');
  chips[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('fCode').value, '300750', '点标签 → 代码填进表单');
  eq(d.getElementById('fName').value, '宁德时代', '点标签 → 名称填进表单');

  // 表单预览文案（★ 2026-09-20：不再有成本/股数，预览只确认「记下哪一只」）
  has(d.getElementById('hPreview').textContent, '宁德时代', '选中后预览显示股票名');
  notHas(d.getElementById('hPreview').textContent, '成本金额', '★ 预览不再算成本金额（持仓不记账）');

  // 保存 → 持仓清单增长 + 界面即时更新
  d.getElementById('btnAddHolding').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.G.cfg.holdings.length, 4, '添加后持仓清单 4 条');
  eq(w.PositionCore.findHolding(w.G.cfg.holdings, '300750').code, '300750', '新持仓按代码记下（不再要求成本/股数）');
  eq(d.getElementById('hCnt').textContent, '4', '角标同步为 4');
  eq(d.getElementById('hList').querySelectorAll('.hg[data-code]').length, 4, '列表同步为 4 条');
  eq(d.getElementById('hQuickWrap').style.display, 'none', '全部记完持仓后，快捷区自动隐藏');
  eq(w.G.cfg.stocks.length, 2, '★ 记持仓不会往监控清单里塞东西');
  eq('cost' in w.G.cfg.stocks[1], false, '★ 监控项上依然没有成本字段');
  w.hidePage('pgAdd')     // 后面继续在持仓页上断言

  /* ★ 2026-09-20：成本/股数字段已下线 → 不再有这类校验（代码与名称的校验见上文第 5 段）*/
  eq(d.getElementById('hCost'), null, '★ 添加页不再有成本输入框');
  eq(d.getElementById('hQty'), null, '★ 添加页不再有股数输入框');

  // 展开卡片 → 只看到结论与删除，不再有改成本/股数的表单
  const hRow0 = d.getElementById('hList').querySelectorAll('.hg[data-code]')[0];
  ok(!hRow0.querySelector('.hg-acts').classList.contains('open'), '持仓卡片默认收起');
  hRow0.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  ok(hRow0.querySelector('.hg-acts').classList.contains('open'), '点卡片展开结论面板');
  eq(hRow0.querySelector('.hg-cost'), null, '★ 卡片里不再有改成本的输入框');
  eq(hRow0.querySelector('.hg-qty'), null, '★ 卡片里不再有改股数的输入框');
  eq(hRow0.querySelector('[data-act="hgSave"]'), null, '★ 「保存」按钮已撤下');
  ok(!!hRow0.querySelector('[data-act="hgDel"]'), '★ 只保留「删除持仓」这个操作');

  /* ---------- 7. 删除持仓：只删持仓，不动监控 ---------- */
  w.confirm = function () { return true; };   // delHolding 有确认弹窗，测试里直接放行
  const hRowY = qa(d.getElementById('hList'), '.hg[data-code]')
    .find(x => x.getAttribute('data-code') === '600036');
  hRowY.querySelector('[data-act="hgDel"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.PositionCore.findHolding(w.G.cfg.holdings, '600036'), null, '★ 持仓已被删除');
  eq(w.G.cfg.stocks.length, 2, '★ 监控清单不受影响（600036 本来也不在监控里）');
  eq(w.G.cfg.holdings.length, 3, '持仓清单剩 3 条');
  const hRowZ = qa(d.getElementById('hList'), '.hg[data-code]')
    .find(x => x.getAttribute('data-code') === '600519');
  hRowZ.querySelector('[data-act="hgDel"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  eq(w.PositionCore.findHolding(w.G.cfg.holdings, '600519'), null, '删掉 600519 的持仓记录');
  eq(w.G.cfg.stocks.length, 2, '★ 删持仓不会连带删掉监控（这就是两份清单分离的意义）');
  eq(w.G.cfg.stocks[0].code, '600519', '600519 仍在监控清单里');

  /* ---------- 8. 空持仓：统计条给引导文案，绝不是 0 元 ---------- */
  w.G.cfg.holdings = [];
  w.renderActive(map2);
  w.renderHoldings(null);
  const pf3t = d.getElementById('hCount').textContent;
  has(pf3t, '还没有持仓记录', '无持仓 → 显示引导文案');
  notHas(d.getElementById('pgHoldings').textContent, '¥0.00', '★ 无持仓时绝不显示 0 元盈亏');
  eq(d.getElementById('pfBox'), null, '★ 空态下也不再渲染汇总卡');
  has(d.getElementById('hList').textContent, '还没有持仓', '空持仓时列表给空态提示');
  has(d.getElementById('hList').textContent, '记一笔持仓', '引导文案指向「记一笔持仓」入口');

  /* ---------- 9. 全部取不到价 → 现价显示破折号，不显示假 0（★ 不再有浮盈口径） ---------- */
  w.G.cfg.holdings = [{ code: '999999', name: '查无此股' }];
  w.renderHoldings({});
  const h9 = d.getElementById('hList').querySelector('.hg[data-code="999999"]');
  ok(!!h9, '★ 没有成本/股数也照样列进持仓清单');
  eq(h9.querySelector('.hg-px').textContent, '—', '取不到价 → 现价显示破折号（不冒充 0）');
  has(h9.querySelector('.pct').textContent, '未取到行情价', '并说明原因');
  notHas(h9.textContent, '¥', '★ 卡片上不再出现任何金额');

  /* ---------- 10. ★ 删监控不能删持仓（两份清单相互独立） ---------- */
  w.confirm = function () { return true; };   // 跳过确认弹窗
  w.G.cfg.deleted = [];
  w.G.cfg.stocks = [{ code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true }];
  w.G.cfg.holdings = [{ code: '600519', name: '贵州茅台', cost: 1620, qty: 100 }];
  w.renderActive(map2);
  const delCard = d.getElementById('list').querySelector('.stock[data-i]');
  delCard.querySelector('[data-act="del"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const rec = (w.G.cfg.deleted || [])[0];
  ok(!!rec, '删除后进入归档记录');
  eq('cost' in rec, false, '★ 归档记录里不再存成本价（成本属于持仓清单）');
  eq('qty' in rec, false, '★ 归档记录里不再存股数');
  eq(rec.condition, 'gte', '归档保留了提醒条件（只读保留）');
  eq(w.G.cfg.holdings.length, 1, '★ 删监控后持仓清单一条不少');
  eq(w.G.cfg.holdings[0].cost, 1620, '★ 持仓成本保持不变');

  /* ---------- 11. 恢复监控：老归档里的成本/股数被搬进持仓清单 ---------- */
  w.G.cfg.deleted = [{ code: '000651', name: '格力电器', condition: 'lte', target: 40, cost: 38.5, qty: 800, addedAt: '2026-08-01', removedAt: '2026-09-01T00:00:00.000Z', fire: null }];
  w.G.cfg.stocks = [];
  w.G.cfg.holdings = [];
  await w.restoreStock(0);
  eq(w.G.cfg.stocks.length, 1, '恢复后回到监控清单');
  eq(w.G.cfg.stocks[0].code, '000651', '恢复的是同一只');
  eq('cost' in w.G.cfg.stocks[0], false, '恢复时成本不进监控项');
  eq(w.G.cfg.holdings.length, 1, '老归档里的成本/股数被搬进持仓清单');
  eq(w.G.cfg.holdings[0].cost, 38.5, '搬过去的成本正确');
  eq(w.G.cfg.holdings[0].qty, 800, '搬过去的股数正确');

  /* ---------- 12. 监控列表为空：空态提示，不再靠持仓卡撑门面 ---------- */
  w.G.cfg.stocks = [];
  w.G.cfg.holdings = [];
  w.renderActive(map2);
  const L2 = d.getElementById('list');
  eq(L2.querySelectorAll('.pf').length, 0, '★ 空监控列表也不出现持仓汇总卡');
  has(L2.querySelector('.empty').textContent, '还没有监控任何股票', '空列表提示保留');
  has(L2.querySelector('.empty').textContent, '添加第一只', '空列表指路右下角 +');

  /* ---------- 13. 更多面板：三个独立入口（持仓 / 推荐 / 归档） ---------- */
  ok(!!d.getElementById('rowHoldings'), '更多面板有「我的持仓」入口');
  ok(!!d.getElementById('rowPicks'), '★ 更多面板有「AI 备选推荐」入口');
  ok(!!d.getElementById('rowArchive'), '更多面板有「删除记录」入口');
  has(d.getElementById('rowPicks').textContent, 'AI 备选推荐', '推荐入口文案正确');

  /* ============================================================
   *  14. ★ AI 备选推荐页（pgPicks）—— 第三个独立页面
   * ============================================================ */
  ok(d.getElementById('pgPicks') !== null, 'pgPicks 页面存在');
  ok(typeof w.SignalCore.RULE_VERSION === 'string', 'SignalCore.RULE_VERSION 可用（推荐页口径与云端同源）');

  w.openPicks();
  await new Promise(r => setTimeout(r, 50));
  const pgP = d.getElementById('pgPicks');
  ok(pgP.classList.contains('on'), '点「AI 备选推荐」进入推荐页');
  has(pgP.textContent, '不含 ST、不含科创板', '推荐页写明排除口径（用户点名的要求）');
  has(pgP.textContent, '10 个交易日 ±2%', '推荐页写明胜负口径');

  const picksList = d.getElementById('picksList');
  const pickCards = picksList.querySelectorAll('.pick');
  eq(pickCards.length, 3, '演示数据渲染 2 条备选 + 1 张弱转强观察池卡（预览注入 picksDemoData）');
  has(pickCards[0].textContent, '格力电器', '最新一条排最前（格力电器 2026-09-14）');
  has(pickCards[1].textContent, '贵州茅台', '第二条是贵州茅台');

  /* ★ 2026-09-17：推荐卡显示实时价（现价 + 当日涨跌 + 较推荐日涨跌） */
  has(pickCards[0].querySelector('.px').textContent, '42.86', '★ 推荐卡显示实时现价（格力 42.86）');
  has(pickCards[0].querySelector('.px').textContent, '+1.82%', '推荐卡显示当日涨跌');
  has(pickCards[0].querySelector('.px').textContent, '实时', '并标注是实时价');
  has(pickCards[0].querySelector('.pick-sub').textContent, '推荐价 41.20 元', '副行保留推荐日价');
  has(pickCards[0].querySelector('.pick-sub').textContent, '较推荐日 +4.03%', '★ 算出「较推荐日」涨跌幅（42.86/41.20−1）');
  has(pickCards[1].querySelector('.px').textContent, '1565.60', '第二条推荐也显示实时价（茅台）');
  has(pickCards[1].querySelector('.pick-sub').textContent, '较推荐日 +7.97%', '茅台的较推荐日涨幅也正确（1565.60/1450−1）');
  has(pickCards[1].textContent, '推荐理由', '每条都有「推荐理由」段');
  has(pickCards[1].textContent, '2 连板', '推荐理由列出具体因子（龙头战法版演示数据）');
  has(pickCards[1].textContent, '打板·题材龙头', '副行带策略标签');
  has(pickCards[1].textContent, '发酵期', '头部带情绪周期标签');
  has(pickCards[1].textContent, '买入价 1595.00 元', '副行带建议买入价');
  has(pickCards[1].textContent, '买卖纪律', '每条都有「买卖纪律」段');
  has(pickCards[1].textContent, '高开 >7% 放弃', '买入纪律写明防接盘触发条件');
  has(pickCards[1].textContent, '+3.42%', '已判定条目回填了推荐后累计涨跌幅');
  has(pickCards[1].textContent, '判胜', '已判定条目标明胜负');
  has(pickCards[0].textContent, '满 10 个交易日后自动回填', '未到期条目说明会自动回填');
  has(d.getElementById('picksStat').textContent, '已判定 1 条', '统计条汇总已判定条数');
  has(d.getElementById('picksStat').textContent, '胜率 100%', '统计条算出胜率');
  has(d.getElementById('picksStat').textContent, '10 个交易日 ±2%', '统计条带口径说明');
  eq(d.getElementById('picksCnt').textContent, '2', '更多面板里的推荐角标同步为 2');
  has(pickCards[1].textContent, '规则版本 L2', '每条标注规则版本（胜率按版本可比）');
  has(pickCards[1].textContent, '止损', '★ 买卖纪律渲染具体止损行');
  has(pickCards[1].textContent, '1515.25', '★ 止损价按买入价×0.95 算出（茅台 1595.00→1515.25）');
  has(pickCards[1].textContent, '-5%', '止损行标注 -5% 口径');
  has(pickCards[1].textContent, '【盘后推荐·明日进场】', '★ 买入说明标明这是盘后推荐、次日进场');
  has(pickCards[1].textContent, '竞价 9:15-9:25 只看不动', '★ 第一步=竞价观察再决定挂不挂单（消除"挂涨停又高开放弃"歧义）');
  has(pickCards[1].textContent, '不要开盘就挂单', '★ 打板②：未涨停挂涨停价会被价格优先立即成交，必须贴板扫板');
  has(pickCards[1].textContent, '价格优先', '写明交易机制原因（瞬间按卖一价成交）');
  has(pickCards[1].textContent, '炸板回落', '打板固有风险（炸板止损）写明');
  has(pickCards[1].textContent, '1706.65', '高开放弃线算成具体价格（1595×1.07）');
  has(pickCards[1].textContent, '当天 T+1 卖不了', '成交后 T+1 不可卖写明');
  has(pickCards[1].textContent, '跌破 1515.25 当日走', '卖出纪律含具体止损价');
  has(pickCards[1].textContent, '打板·贴板扫板', '★ 卡片头部高亮徽章标明操作类型（打板=橙）');
  has(pickCards[0].textContent, '低吸·挂单等回踩', '★ 卡片头部高亮徽章标明操作类型（低吸=蓝）');
  has(pickCards[0].textContent, '收盘前撤单即可，无损失', '低吸限价单未回踩=不成交=撤单无损失（机制正确）');
  has(pickCards[0].textContent, '不会立即成交', '低吸②写明限价单挂着等的机制');
  has(picksList.textContent, '弱转强观察池', '★ 弱转强观察池区块渲染');
  has(picksList.textContent, '国芳集团', '观察池演示数据渲染（游资打法补位）');
  has(picksList.textContent, '弱转弱不接', '观察池带明确竞价确认条件与放弃条件');
  has(picksList.textContent, '不计入推荐', '观察池明确标注不计入推荐与胜负统计');

  /* ---------- 15. ★ 快捷切换条：持仓页/推荐页保留；首页（主视图）已按用户要求去掉 ---------- */
  w.switchView('monitor')
  eq(d.getElementById('pgHoldings').classList.contains('on'), false, 'switchView(monitor) 收起持仓页')
  eq(d.getElementById('pgPicks').classList.contains('on'), false, 'switchView(monitor) 收起推荐页')
  eq(d.querySelectorAll('.vtabs').length, 2, '★ 首页切换条已去掉：只剩持仓页/推荐页各一条')
  eq(d.querySelector('.wrap .vtabs'), null, '★ 首页仪表盘不再有「监控/持仓/今日推荐」切换按钮')

  var hTabs = d.getElementById('pgHoldings').querySelectorAll('.vtab')
  eq(hTabs.length, 3, '持仓页切换条仍是三项')
  has(hTabs[2].textContent, '今日推荐', '第三项文案是「今日推荐」（用户口径）')

  // 计数随清单同步（首页没有 tab 了，计数只出现在持仓/推荐页的切换条上）
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true },
    { code: '300750', name: '宁德时代', condition: 'gte', target: 200, enabled: true }
  ];
  w.renderActive(map2)
  eq(hTabs[0].querySelector('.n').textContent, '2', '监控 tab 计数随监控清单同步（同步逻辑覆盖所有剩余切换条）')

  // 持仓页自己的切换条高亮 + 点「今日推荐」tab 直达推荐页
  w.switchView('holdings')
  await new Promise(r => setTimeout(r, 30))
  ok(d.getElementById('pgHoldings').classList.contains('on'), '持仓页正常打开')
  eq(d.getElementById('pgHoldings').querySelectorAll('.vtab.on').length, 1, '持仓页自己的切换条高亮「持仓」')

  // 持仓页点「今日推荐」tab → 直达推荐页，旧页收起
  d.getElementById('pgHoldings').querySelector('.vtab[data-view="picks"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 30))
  ok(d.getElementById('pgPicks').classList.contains('on'), '持仓页点「今日推荐」tab 直达推荐页')
  eq(d.getElementById('pgHoldings').classList.contains('on'), false, '切换时旧页面收起')
  eq(d.getElementById('pgPicks').querySelector('.vtab.on').getAttribute('data-view'), 'picks', '推荐页切换条高亮「今日推荐」')

  // 推荐页点「监控」tab → 回主视图
  d.getElementById('pgPicks').querySelector('.vtab[data-view="monitor"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 30))
  eq(d.getElementById('pgPicks').classList.contains('on'), false, '点「监控」tab 收起推荐页')
  eq(d.getElementById('list').querySelectorAll('.stock[data-i]').length, 2, '主视图监控列表正常')

  // 菜单入口与 tab 高亮保持一致
  w.openPicks()
  await new Promise(r => setTimeout(r, 30))
  ok(d.getElementById('pgPicks').classList.contains('on'), '更多菜单进推荐页仍然可用')
  eq(d.getElementById('pgPicks').querySelector('.vtab.on').getAttribute('data-view'), 'picks', '菜单进入后 tab 高亮同步')
  w.switchView('monitor')

  /* ---------- 15.5 ★ 大盘风格驾驶舱（pgStyle）—— 2026-09-19 新增 ---------- */
  ok(d.getElementById('pgStyle') !== null, '★ pgStyle 驾驶舱页面存在（与推荐页=龙头战法分列）');
  ok(d.getElementById('rowStyle') !== null, '★ 更多菜单有「大盘驾驶舱」入口');
  ok(typeof w.renderStyle === 'function' && typeof w.styleDemoData === 'function' &&
     typeof w.openStyle === 'function', '★ renderStyle/styleDemoData/openStyle 可用');
  ok(w.STYLE && w.STYLE.data && w.STYLE.loaded, '★ 预览注入 STYLE 演示数据（首次渲染之前）');

  const styleBody = d.getElementById('styleBody');
  has(styleBody.textContent, '题材主升浪', '★ 演示渲染出风格结论（theme-run 分支）');
  has(styleBody.textContent, '操作指南', '风格卡带操作指南');
  ok(styleBody.textContent.indexOf('15%') >= 0, '★ 指南含防过热接盘口径（20日涨幅>15%不新开仓）');
  has(styleBody.textContent, '今日题材榜', '题材榜区块渲染');
  has(styleBody.textContent, '板块主力净流入', '板块资金流区块渲染');

  const swiper = styleBody.querySelector('#stySwiper');
  ok(swiper !== null, '★ 优选横滑轮播容器存在（scroll-snap 左右滑）');
  const styCards = qa(swiper, '.sty-card');
  eq(styCards.length, 3, '★ 演示渲染 3 只优选（上限 ≤3）');
  eq(styleBody.querySelectorAll('#styDots i').length, 3, '轮播页点与优选数一致');
  styCards.forEach((card, ci) => {
    ok(card.querySelector('button[data-act="styDel"]') !== null, '★ 优选卡 ' + (ci + 1) + ' 有删除按钮');
    ok(card.querySelector('button[data-act="styHold"]') !== null, '优选卡 ' + (ci + 1) + ' 有「记持仓」按钮');
    ok(qa(card, 'ul li').length >= 3, '★ 优选卡 ' + (ci + 1) + ' 理由齐全（资金/板块/结构/位置 ≥3 条）');
    has(card.textContent, '止损', '★ 优选卡 ' + (ci + 1) + ' 带止损纪律（打错必须斩）');
    has(card.textContent, '结构裁决', '优选卡 ' + (ci + 1) + ' 带 PS 结构裁决行');
  });
  /* 演示数据自洽：与真实引擎字段一一对应，不许有占位假数据 */
  w.styleDemoData().picks.forEach(pk => {
    ok(pk.code && pk.name && isFinite(pk.score), '★ 演示优选 ' + pk.code + ' 代码/名称/评分齐全');
    ok(pk.ps && isFinite(pk.ps.score) && pk.ps.bias, '★ 演示优选 ' + pk.code + ' ps 结构自洽（score/bias）');
    ok(pk.reasons && pk.reasons.length >= 3, '★ 演示优选 ' + pk.code + ' 理由 ≥3 条');
  });
  const sd = w.styleDemoData();
  ok(sd.style && sd.style.why && sd.style.why.length >= 2 && sd.style.guide, '★ 演示风格结论 why/guide 齐全');
  ok(sd.emo && isFinite(sd.emo.zt) && isFinite(sd.emo.maxLbc), '★ 演示情绪快照自洽');
  ok(sd.idx && isFinite(sd.idx.gap), '★ 演示大小盘数据自洽');

  /* 删除 = 本机忽略（localStorage），云端记录保留 */
  w.openStyle();
  await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('pgStyle').classList.contains('on'), '★ openStyle 打开驾驶舱');
  const delBtn = styleBody.querySelector('button[data-act="styDel"]');
  const delCode = delBtn.getAttribute('data-code');
  delBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const igMap = JSON.parse(w.getLS('sa_style_ignored_v1') || '{}');
  ok(Object.keys(igMap).some(k => k.indexOf(delCode) >= 0), '★ 删除后写入本机忽略名单（日期|代码）');
  eq(styleBody.querySelectorAll('#stySwiper .sty-card').length, 2, '★ 删除后轮播只剩 2 张（本批不再显示）');
  has(styleBody.textContent, '已被你删除', '删除后注明「另有 N 只已被你删除」（云端记录不动）');
  /* 清掉忽略名单，恢复 3 张，避免影响后续断言 */
  w.saveLS('sa_style_ignored_v1', '{}');
  w.renderStyle();
  eq(styleBody.querySelectorAll('#stySwiper .sty-card').length, 3, '清空忽略名单后 3 张恢复（幂等）');
  /* 收起驾驶舱，回主视图 */
  d.querySelector('#pgStyle .back').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('pgStyle').classList.contains('on'), false, 'back 按钮收起驾驶舱');

  /* ---------- 16. ★ 持仓页不再有第二套搜索/表单（录入统一在添加页） ---------- */
  w.switchView('holdings')
  await new Promise(r => setTimeout(r, 20))
  ok(d.getElementById('pgHoldings').classList.contains('on'), '持仓页正常打开')
  eq(d.getElementById('pgHoldings').querySelector('#hQuery'), null, '★ 持仓页里没有搜索框（搜索只剩统一添加页那一个）')
  eq(d.getElementById('pgHoldings').querySelector('#hManualFields'), null, '★ 持仓页里没有手输降级表单')
  eq(d.getElementById('pgHoldings').querySelector('#btnAddHolding'), null, '★ 持仓页里没有录入表单（录入只有一个入口）')
  ok(!!d.getElementById('pgHoldings').querySelector('#btnGoAddHolding'), '持仓页只留一个跳转入口')
  // 清空按钮属于搜索框，仍然在统一添加页里工作
  w.hidePage('pgHoldings')
  d.getElementById('fabAdd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 20))
  d.getElementById('fQuery').value = '银行'
  d.getElementById('fQuery').dispatchEvent(new w.Event('input', { bubbles: true }))
  eq(d.getElementById('btnClear').hidden, false, '输入后清空按钮出现')
  d.getElementById('btnClear').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  eq(d.getElementById('fQuery').value, '', '清空按钮清掉输入')
  has(d.getElementById('srResult').textContent, '两份清单互相独立', '清空结果区并回到引导态')
  w.hidePage('pgAdd')
  w.switchView('monitor')

  /* ---------- 17. ★ 老配置自动迁移：stocks[].cost/qty → holdings[] ---------- */
  const legacyStocks = [
    { code: '002415', name: '海康威视', condition: 'lte', target: 31, enabled: true, addedAt: '2026-08-21', cost: 30, qty: 1000 }
  ];
  const mig = w.PositionCore.migrateLegacy(legacyStocks, []);
  eq(mig.changed, true, '老结构能被识别');
  eq(mig.holdings.length, 1, '老的成本/股数被搬进持仓');
  eq('cost' in mig.stocks[0], false, '监控项上的 cost 被摘掉');
  ok(typeof w.G.cfg.holdings === 'object' && w.G.cfg.holdings !== null, '页面全局配置里 holdings 字段一定存在（不会 undefined）');

  /* ---------- 18. ★ 首页仪表盘：距触发最近 / 持仓当日评测 / 推荐入口 ---------- */
  w.G.homeMode = 'dash';
  w.renderHome();
  eq(d.getElementById('dash').style.display, '', '★ 首页默认是仪表盘形态（#dash 显示）');
  eq(d.getElementById('list').style.display, 'none', '★ 首页默认不直接铺全部监控列表（点卡才展开）');
  eq(d.getElementById('homeBack').hidden, true, '「返回首页」按钮默认隐藏');

  // ②-1 已达条件的优先于「还差很多」的
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1565.60, enabled: true },  // 现价已达
    { code: '300750', name: '宁德时代', condition: 'gte', target: 190, enabled: true },      // 还差 0.89%
    { code: '600733', name: '北汽蓝谷', condition: 'lte', target: 3.00, enabled: false }     // 暂停 → 不参与
  ];
  w.renderActive(map2);
  w.renderDash(map2);
  const dash = d.getElementById('dash');
  has(dash.textContent, '距触发最近', '仪表盘有「距触发最近」区块');
  has(dash.textContent, '贵州茅台', '★ 已达条件的监控股排在「距触发最近」最前');
  has(dash.textContent, '已达条件', '最近触发卡直接展示「已达条件」状态');

  // ②-2 都未达标时，按还差的百分比升序
  w.G.cfg.stocks = [
    { code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, enabled: true },  // 差 2.15%
    { code: '300750', name: '宁德时代', condition: 'gte', target: 190, enabled: true }    // 差 0.89%
  ];
  w.renderDash(map2);
  has(dash.querySelector('[data-act="dash-near"]').textContent, '宁德时代', '★ 未达标时选「还差百分比最小」的一只（0.89% < 2.15%）');
  has(dash.querySelector('[data-act="dash-near"]').textContent, '还差 1.70 元（0.89%）', '差距文案与监控列表同源（gapInfo）');

  // ②-3 点击 → 展开全部监控；返回按钮回到仪表盘
  dash.querySelector('[data-act="dash-near"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  eq(d.getElementById('dash').style.display, 'none', '★ 点最近触发卡 → 仪表盘收起');
  eq(d.getElementById('list').style.display, '', '★ 点最近触发卡 → 全部监控列表展开');
  eq(d.getElementById('homeBack').hidden, false, '展开后出现「返回首页」按钮');
  eq(d.getElementById('list').querySelectorAll('.stock[data-i]').length, 2, '全部监控列表照常渲染（含暂停项）');
  d.getElementById('homeBack').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  eq(d.getElementById('dash').style.display, '', '点「返回首页」回到仪表盘');
  eq(d.getElementById('list').style.display, 'none', '返回后全部监控列表收起');

  // ③ 持仓主力博弈卡：V3 多源核验判定 + 5 日线连续站上标识
  //    ★ 2026-09-17 用户要求：持仓行为显示换成「主力博弈 V3」，替换原透视的散户/主力行为块
  w.G.cfg.holdings = [{ code: '600519', name: '贵州茅台', cost: 1620, qty: 100 }];
  w.renderDash(map2);
  has(dash.textContent, '持仓 · 主力博弈', '仪表盘持仓区块已改称「主力博弈」');
  const evRow = dash.querySelector('.ev-row[data-code="600519"]');
  ok(!!evRow, 'V3 卡逐只列出持仓（600519）');
  has(evRow.textContent, '主力', '★ 列出多源核验判定（V3 字样已按要求去掉）');
  has(evRow.textContent, '回补吸筹', '★ 价涨+主力买+20日仍弱 → 主标题「回补吸筹」');
  has(evRow.textContent, '短线可拿，中期仍弱，不追高', '★ 并直接给出「能不能拿、要不要追」的建议');
  has(evRow.textContent, '散户', '★ 散户行为行已放回仪表盘（2026-09-19 用户要求：一眼看到抄底还是割肉）');
  has(evRow.textContent, '割肉', '★ 首页只放短标签（「散户在割肉」→「割肉」），取演示筹码数据 600519');
  notHas(evRow.textContent, '散户在割肉', '★ 首页是短标签，不带「散户在」前缀（避免与 ev-k 标签重复）');
  notHas(evRow.textContent, '建仓/吸筹', '★ 旧透视行为标签已从仪表盘移除');
  has(evRow.textContent, '5日线', '★ 5 日线标识仍在 V3 卡上（口径不变）');
  has(evRow.textContent, '连续 3 天', '★ 连续 ≥2 天 → 写出天数并提示落袋');
  evRow.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('pgHoldings').classList.contains('on'), '★ 点透视行进入持仓详情（持仓页）');
  const focusCard = d.getElementById('hList').querySelector('.hg[data-code="600519"]');
  ok(focusCard.querySelector('.hg-acts').classList.contains('open'), '★ 对应持仓卡被自动展开（免再点一次）');
  has(focusCard.textContent, '主力博弈', '★ 持仓卡含「主力博弈」区块（V3 字样已按要求去掉）');
  notHas(focusCard.textContent, 'V3', '★ 持仓卡上不再出现「V3」字样（用户 2026-09-19 要求去掉版本号标识）');
  /* 2026-09-20「只留结论」：三源明细 / 共识票数 / 冲突天数 / 置信度都是推理中间量，已撤下界面
     （翻译函数 v3SrcNote / v3Sub 仍保留并单测，见 ③i 段；只是不再渲染到详情页）*/
  has(focusCard.textContent, '主力 → 回补吸筹', '★ 主力行为判定直接给结论（V3 三源投票的产物）');
  has(focusCard.textContent, '短线可拿，中期仍弱，不追高', '★ 并直接给出「能不能拿、要不要追」的建议');
  notHas(focusCard.textContent, '1,620.00', '★ 持仓不再记成本 → 详情里不再出现自己的成本数字');
  has(focusCard.textContent, '主力 → 回补吸筹', '★ 详情只给规则结论（主力行为判定）');
  notHas(focusCard.textContent, '① 当日涨跌', '★ 三源明细已撤下（只留结论，不展示推理过程）');
  notHas(focusCard.textContent, '多源共识', '★ 共识票数 / 冲突天数 / 置信度已撤下');
  notHas(focusCard.innerHTML, 'cd-row', '★ 指标格（cd-row）已从详情页撤下');
  has(focusCard.textContent, '散户在割肉', '★ 散户行为行已放回持仓详情（2026-09-19 用户要求：抄底还是割肉一眼看到）');
  has(focusCard.textContent, '恐慌盘在往外倒', '★ 详情给的是完整说明，不只是一个标签');
  ok(!!focusCard.querySelector('.cd-desc .st.good'), '★ 散户徽章按 tone 上色（割肉=good→蓝，沿用跟=蓝/躲=橙，不用红绿）');
  notHas(focusCard.innerHTML, 'cd-k">主力成本', '★ 旧透视的「主力成本」数据格已下线（综合研判文案里提及主力成本属正常）');
  notHas(focusCard.textContent, '获利盘', '★ 旧透视的「获利盘」已从持仓卡下线');
  notHas(focusCard.textContent, '走势', '★ 卡上已无干巴巴的「走势」');
  notHas(focusCard.textContent, '机会', '★ 卡上已无干巴巴的「机会」');
  ok(!!focusCard.querySelector('.hg-ma5'), '★ 持仓卡上有 5 日线标识区块');
  has(focusCard.querySelector('.hg-ma5').textContent, '连续 3 天站上 5 日线', '★ 5 日线标识文案含天数');
  // ★ 重画不能把手动展开的面板收起来：行情/透视数据异步回来会再调 renderHoldings，
  //   不保留状态的话"点首页卡进来看详情"会瞬间被收起（这次就是这么发现的）
  const actsOf = () => d.getElementById('hList').querySelector('.hg[data-code="600519"] .hg-acts');
  w.renderHoldings(map2);
  ok(actsOf().classList.contains('open'), '★ 重画后展开状态被保留（异步数据回来不打断阅读）');
  actsOf().classList.remove('open');
  w.renderHoldings(map2);
  ok(!actsOf().classList.contains('open'), '手动收起后重画不再弹开（以用户操作为准）');
  actsOf().classList.add('open');
  w.switchView('monitor');

  // ③b 5 日线三态：0 天不显示 / 1 天只标天数 / ≥2 天提示卖出（用户指定口径）
  w.G.cfg.holdings = [
    { code: '002415', name: '海康威视', cost: 30, qty: 100 },
    { code: '600733', name: '北汽蓝谷', cost: 5, qty: 100 },
    { code: '600036', name: '招商银行', cost: 30, qty: 100 }
  ];
  w.renderHoldings(map2);
  const cardOf = c => d.getElementById('hList').querySelector('.hg[data-code="' + c + '"]');
  eq(cardOf('002415').querySelector('.hg-ma5'), null, '★ 连续 0 天 → 完全不显示（用户口径）');
  ok(!!cardOf('600733').querySelector('.hg-ma5'), '★ 连续 1 天 → 有标识');
  ok(cardOf('600733').querySelector('.hg-ma5').className.indexOf('watch') >= 0, '1 天用弱化样式（不是买卖信号）');
  has(cardOf('600733').querySelector('.hg-ma5').textContent, '5 日线上 1 天', '★ 1 天 → 只标天数');
  has(cardOf('600036').querySelector('.hg-ma5').textContent, '连续 2 天站上 5 日线', '★ 2 天 → 提示卖出（≥2 天即触发）');
  ok(cardOf('600036').querySelector('.hg-ma5').className.indexOf('watch') < 0, '≥2 天用告警样式（与 1 天区分开）');
  has(cardOf('002415').textContent, '放量突破', '★ 三源全上 + 放量 → 主标题「放量突破」');
  has(cardOf('002415').textContent, '别追高', '★ 摘要/详情里都有明明白白的操作提示');

  // ③c V3 判定结论都能落到卡上（用户在意的就是这一句话）
  w.G.cfg.holdings = [{ code: '600036', name: '招商银行', cost: 30, qty: 100 }];
  w.renderHoldings(map2);
  has(cardOf('600036').textContent, '趋势持有', '★ 连续 3 天冲突 + 20 日涨 18.7% → 趋势持有');
  has(cardOf('600036').textContent, '价格压过资金分歧', '★ 并解释为什么这时候不看资金流');
  notHas(cardOf('600036').textContent, '置信度', '★ 置信度属推理中间量，已撤下界面（算法层 conf 未改）');
  w.G.cfg.holdings = [{ code: '600733', name: '北汽蓝谷', cost: 5, qty: 100 }];
  w.renderHoldings(map2);
  has(cardOf('600733').textContent, '观望', '★ 三源平票 → 观望');
  has(cardOf('600733').textContent, '信号打架', '★ 说清为什么观望：信号打架先不动手');
  notHas(cardOf('600733').textContent, '置信度', '★ 观望态同样不再展示置信度');

  // ③d ma5Of 纯函数：逐日各用「截止当日」的 5 日线，不是拿今天的均线套历史
  const mkb = seq => seq.map((p, i) => ({ d: '2026-08-' + (i < 9 ? '0' + (i + 1) : String(i + 1)),
    o: p, c: p, h: p * 1.005, l: p * 0.995, v: 1000 }));
  /* ★ 底座必须多头排列（MA5>MA10>MA20>MA30）：用户 2026-09-17 追加的前提，
     不是多头排列就整条不判断。40 根缓涨 9→10 + 1 根回落 9.70 当断口。 */
  const ramp40 = (() => { const a = []; for (let i = 0; i < 40; i++) a.push(9 + i / 39); return a; })();
  const aligned = ramp40.concat([9.70]);
  const s3 = w.ma5Of(mkb(aligned.concat([11, 11.5, 12])));
  eq(s3.days, 3, '★ ma5Of：3 天开收盘都站上 → days=3');
  eq(s3.sig, 'sell', '★ days≥2 → sig=sell（提醒卖出）');
  const s1 = w.ma5Of(mkb(aligned.concat([11])));
  eq(s1.days, 1, '★ ma5Of：只有最后 1 天站上 → days=1');
  eq(s1.sig, 'watch', '★ days=1 → sig=watch（只标天数）');
  const s0 = w.ma5Of(mkb(aligned.concat([9])));
  eq(s0.days, 0, '★ ma5Of：开收都在均线下 → days=0');
  eq(s0.sig, null, '★ days=0 → sig=null（不显示）');
  // ★ 非多头排列 → 整条不判断（同一条尾巴、只换底座）
  const ten = new Array(20).fill(10);
  const sN = w.ma5Of(mkb(ten.concat([11, 11.5, 12])));
  eq(sN.days, 0, '★ ma5Of：非多头排列（20 根横盘）→ days=0（"其他情况不触发判断"）');
  eq(sN.sig, null, '★ 非多头排列 → sig=null（持仓页不渲染标识）');
  eq(sN.aligned, false, '★ 并回报 aligned=false，界面可据此解释为什么不显示');
  ok(w.ma5Of([]) === null || w.ma5Of([]).days === 0, 'K 线为空不报错');

  // ③e chipEnsure 幂等：持仓清单签名没变就直接返回（否则 renderDash ↔ chipEnsure 会互相触发）
  w.G.chipSig = '600733';
  w.G.chipMap['__mark__'] = { probe: 1 };
  await w.chipEnsure();
  ok(!!w.G.chipMap['__mark__'], '★ chipEnsure 幂等：签名一致时直接返回，不重算不覆盖');
  delete w.G.chipMap['__mark__'];
  // V3 入口同款幂等（renderDash 末尾会调它，没这个保护就无限递归重画）
  w.G.v3Sig = '600733';
  w.G.v3Map['__mark__'] = { probe: 1 };
  await w.v3Ensure();
  ok(!!w.G.v3Map['__mark__'], '★ v3Ensure 幂等：签名一致时直接返回，不重算不覆盖');
  delete w.G.v3Map['__mark__'];

  // ③f V3 渲染函数：没有数据时也不能崩（核验还没跑完）
  const savedV3 = w.G.v3Map;
  w.G.v3Map = {};
  eq(w.v3BriefHtml('600519'), '', '无 V3 数据 → 摘要为空字符串（不占位、不报错）');
  has(w.v3DetailHtml('600519'), '主力博弈', '无数据时详情块仍给出「主力博弈」标题（V3 字样已去掉）');
  ok(w.v3DetailHtml('600519').indexOf('正在多源核验') >= 0 || w.v3DetailHtml('600519').indexOf('暂不可用') >= 0,
    '并说明是在核验中还是不可用');
  w.G.v3Map = savedV3;
  // 旧透视渲染函数保留可用（代码没删，随时可回退）
  const savedMap = w.G.chipMap;
  w.G.chipMap = {};
  eq(w.chipBriefHtml('600519'), '', '★ 旧透视函数仍可调用（无数据 → 空摘要）');
  has(w.chipDetailHtml('600519'), '透视模式', '★ 旧透视渲染函数保留，随时可回退');
  has(w.retailLineHtml('600519'), '暂无筹码数据', '★ 散户行缺数据时给空态文案，不硬凑');
  // ★ 隔离性：散户行是纯展示，清空 chipMap 不该动摇 V3 的任何结论（不参与投票）
  const v3Before = w.v3Head('600519') ? w.v3Head('600519').t : '';
  const voteBefore = JSON.stringify(w.v3Vote(w.G.v3Map['600519'].dirs));
  eq(w.v3Head('600519').t, v3Before, '★ 清空筹码数据后 V3 主标题不变（散户行不参与投票）');
  eq(JSON.stringify(w.v3Vote(w.G.v3Map['600519'].dirs)), voteBefore, '★ V3 投票结果不变（算法层零改动）');
  w.G.chipMap = savedMap;

  // ③f-2 综合研判 FUSION F4（2026-09-19 二次修复；分支与回测脚本 rules-fusion.js 的 fusion4 逐条一致）
  eq(w.FUSION_VERSION, 'F4', '★ 融合规则版本 = F4');
  const savedV3F = w.G.v3Map, savedChipF = w.G.chipMap, savedQuoteF = w.G.quoteMap;
  function mkFusion(mainK, retailK, opt) {
    opt = opt || {};
    const v3 = { ret20: opt.ret20 !== undefined ? opt.ret20 : 0.05 };
    if (opt.psFlags) v3.ps = { flags: opt.psFlags };
    w.G.v3Map = { '999991': v3 };
    w.G.chipMap = { '999991': { main: { key: mainK }, retail: { key: retailK },
      chips: { mainCost: opt.mainCost !== undefined ? opt.mainCost : 10 }, price: opt.price || 10 } };
    w.G.quoteMap = {};
    return w.fusionVerdict({ code: '999991' });
  }
  let fv;
  fv = mkFusion('accumulate', 'slow-buy', { psFlags: { force_no_trade: true } });
  ok(fv.act === '躲' && fv.why === '诱多过滤', '★ F4①：诱多过滤（罕见）保留硬躲');
  fv = mkFusion('accumulate', 'slow-buy', { psFlags: { sell_bias: true } });
  ok(fv.act === '跟' && fv.why === '主力在建仓' && fv.pullback === true,
    '★ F4②：破位 + 主力在建仓 → 保留跟并标注（回踩）—— 回测 20 日 +4.76%、4/4 时段全正，是回踩买点不是风险');
  fv = mkFusion('accumulate', 'surrender', { psFlags: { sell_bias: true }, mainCost: 10, price: 10.5 });
  ok(fv.act === '跟' && fv.why === '主力建仓+散户割肉' && fv.strong === true && fv.pullback === true,
    '★ F4③：破位 + 黄金组合 → 跟·strong·回踩标注（回测 20 日 +5.50%）');
  fv = mkFusion('outflow', 'slow-buy', { psFlags: { sell_bias: true } });
  ok(fv.act === '躲' && fv.why === '破位+主力派发', '★ F4④：破位 + 主力同向在撤 → 才升级为躲');
  fv = mkFusion('distribute', 'chase', { psFlags: { sell_bias: true } });
  ok(fv.act === '躲' && fv.why === '破位+主力派发', '★ F4⑤：破位 + 主力派发 → 躲');
  fv = mkFusion('lift', 'take-profit', { psFlags: { sell_bias: true } });
  ok(fv.act === '躲' && fv.why === '主力已获利', '★ F4⑥：破位但筹码侧本就是躲 → 维持躲');
  fv = mkFusion(null, null, { psFlags: { sell_bias: true } });
  ok(fv && fv.act === '观望' && fv.why === '破位待核验', '★ F4⑦：破位但筹码缺失 → 观望待核验（不硬凑）');
  fv = mkFusion('lift', 'take-profit', { ret20: 0.2 });
  ok(fv.act === '躲' && fv.why === '高位派发', '★ F4⑧：20日涨>15% 且主力派发/拉升 → 躲（高位派发）');
  fv = mkFusion('lift', 'take-profit', { ret20: 0.05 });
  ok(fv.act === '躲' && fv.why === '主力已获利', '★ F4⑨：主力已获利（非高位）→ 躲（回测 4/4 时段为负）');
  fv = mkFusion('driftdown', 'watch', {});
  ok(fv.act === '观望' && fv.why === '主力在撤', '★ F4⑩：主力在撤 → 观望不躲（回测 3/4 时段后续仍涨）');
  fv = mkFusion('flat', 'dip-buy', {});
  ok(fv.act === '观望' && fv.why === '散户抄底', '★ F4⑪：散户抄底 → 观望');
  fv = mkFusion('accumulate', 'slow-buy', { mainCost: 10, price: 13 });
  ok(fv.act === '观望' && fv.why === '已远离主力成本', '★ F4⑫：高出主力成本 25% → 观望（安全边际不足）');
  fv = mkFusion('accumulate', 'slow-buy', { mainCost: 10, price: 10.5 });
  ok(fv.act === '跟' && fv.why === '主力在建仓' && !fv.pullback, '★ F4⑬：主力建仓+未透支+结构正常 → 跟（无回踩标注）');
  fv = mkFusion('flat', 'surrender', {});
  ok(fv.act === '跟' && fv.why === '散户割肉', '★ F4⑭：散户割肉 → 跟');
  fv = mkFusion('lock', 'watch', {});
  ok(fv.act === '观望' && fv.why === '方向不明', '★ F4⑮：均无方向 → 观望');
  w.G.v3Map = { '999991': { ret20: 0.05 } };
  w.G.chipMap = {};
  w.G.quoteMap = {};
  eq(w.fusionVerdict({ code: '999991' }), null, '★ F4⑯：筹码缺失且无硬裁决 → 返回 null（不硬凑结论）');
  /* 隔离：融合只读不写 */
  w.G.v3Map = savedV3F; w.G.chipMap = savedChipF; w.G.quoteMap = savedQuoteF;
  const v3StateBefore = JSON.stringify(w.G.v3Map['600519']);
  w.fusionVerdict({ code: '600519' });
  eq(JSON.stringify(w.G.v3Map['600519']), v3StateBefore, '★ 融合只读：调用前后 V3 状态零变化');
  /* 演示数据下的展示：首页综合行 + 详情综合研判 */
  const savedHoldF = w.G.cfg.holdings;
  w.G.cfg.holdings = [{ code: '600519', name: '贵州茅台', cost: 1620, qty: 100 }];
  w.renderDash(map2);
  const evRowF = dash.querySelector('.ev-row[data-code="600519"]');
  ok(!!evRowF, '★ 首页持仓卡渲染 600519（F2 展示用例前置）');
  /* ★ 2026-09-20 改版：短期「综合」只在结论变化时提示（用户是中长线，不需要每天出信号） */
  w.localStorage.removeItem('sa_ml_f4_v1');
  w.renderDash(map2);
  const evRowF2 = dash.querySelector('.ev-row[data-code="600519"]');
  has(evRowF2.textContent, '综合', '★ 首页持仓卡短期「综合」行：结论变化时给出提示');
  has(evRowF2.textContent, '已远离主力成本', '★ 演示 600519：现价高出主力成本 30.9% → 综合研判「观望 · 已远离主力成本」');
  has(evRowF2.textContent, '结论有变化', '★ 综合行标注「结论有变化」（说明它只在变化时说话）');
  /* 同一结论再渲染一次 → 不再重复提示（噪音治理的核心） */
  w.renderDash(map2);
  const evRowF3 = dash.querySelector('.ev-row[data-code="600519"]');
  notHas(evRowF3.textContent, '综合', '★ 同一结论重复渲染不再提示「综合」行（日频噪音治理）');
  has(w.v3DetailHtml('600519'), '综合研判（次要参考）→ 观望',
    '★ 持仓详情含综合研判（2026-09-20 降级为中性状态条，不再与主力博弈抢视觉权重）');
  /* 2026-09-20 用户要求：详情页只留结论/状态 + 核心指标着色，小字推理与回测口径一律撤下界面 */
  ok(w.v3DetailHtml('600519').indexOf('融合规则 F4') < 0 &&
    w.v3DetailHtml('600519').indexOf('6440 样本点') < 0 &&
    w.v3DetailHtml('600519').indexOf('62.5%') < 0,
    '★ 详情页不再展开融合规则口径/回测数字（只留结论）');
  w.G.cfg.holdings = savedHoldF;

  // ③f-3 中长线关键位置引擎 S2（2026-09-20 换版：卖点换成「高位过热」+ 买点删冗余条件 + 波段定性）
  eq(w.STAGE_VERSION, 'S2', '★ 中长线引擎版本 = S2');
  const savedV3S = w.G.v3Map, savedChipS = w.G.chipMap, savedQuoteS = w.G.quoteMap, savedDayBars = w.G.dayBars;
  function mkStageBars(pxFn, volFn, n) {
    const out = [];
    const base = new Date('2024-01-01T00:00:00Z').getTime();
    for (let i = 0; i < (n || 300); i++) {
      const px = pxFn(i, n || 300);
      const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
      out.push({ d: d, o: px, c: px, h: px * 1.01, l: px * 0.99, v: volFn ? volFn(i, n || 300) : 1e6 });
    }
    return out;
  }
  function mkStage(code, bars, main20, mv) {
    w.G.dayBars = {}; w.G.dayBars[code] = bars;
    w.G.chipMap = { [code]: { flows: { main20: main20 }, chips: { mainCost: 10 } } };
    w.G.quoteMap = {};
    if (mv) w.G.quoteMap[w.secidOf({ code: code })] = { price: bars[bars.length - 1].c, mv: mv };
    return w.weekStage(code);
  }
  /* ① 数据不足 → null（不硬凑结论） */
  w.G.dayBars = { '999992': mkStageBars(() => 10, () => 1e6, 100) };
  eq(w.weekStage('999992'), null, '★ S2①：日K 不足 250 根 → 返回 null（不硬凑）');
  /* ② 主力建仓区：低位 + 周线多头 + 主力净流入
     形态：先高位回落（20→12）→ 横盘 → 近 60 日小幅回升（12→13.2），现价仍在近一年低位区 */
  let ws = mkStage('999992',
    mkStageBars((i, n) => {
      if (i < 100) return 20 - i * 0.08;                 // 高位回落
      if (i < n - 60) return 12;                         // 横盘筑底
      return 12 + (i - (n - 60)) * 0.02;                 // 近 60 日回升
    }, () => 1e6),
    2e9, 2e10);
  ok(ws && ws.key === 'accumulate-zone' && ws.tone === 'good', '★ S2②：主力净流入 + 低位 + 周线多头 → 主力建仓区');
  ok(ws && /\+24\.6%/.test(ws.advice), '★ S2②b：建仓区建议如实标注区间级回测口径（起点买入 60 日 +24.6%）');
  ok(ws && /0\.45 次/.test(ws.advice), '★ S2②b-2：买点「说清代价」—— 如实告知每只每年只出现 0.45 次');
  /* ②c 新增闸门：一年内暴涨暴跌后「半山腰当低位」必须被挡住（2026-09-20 修）
     形态：8 起 → 暴涨到 22.7 → 崩回 11 → 缓慢回升到 13.6。
     此时 pos250 仍 <0.4、周线已转多头、资金也是净流入 —— 旧规则会喊「建仓区」（对应 000767 的 2026-06-23），
     但现价已是近一年最低价（7.92）的 +70%，属于半山腰，必须被新闸门拦下。 */
  ws = mkStage('999992',
    mkStageBars((i) => {
      if (i < 90) return 8                              // 低位起点（区间最低）
      if (i < 140) return 8 + (i - 90) * 0.30           // 暴涨 8 → 22.7
      if (i < 175) return 22.7 - (i - 140) * 0.334      // 崩回 11
      return 11 + (i - 175) * 0.0207                    // 缓慢回升 → 13.6
    }, () => 1e6),
    2e9, 2e10);
  ok(ws && isFinite(ws.pos250) && ws.pos250 < 0.4 && isFinite(ws.wma20) && ws.wma5 > ws.wma20,
    '★ S2②c-前置：该形态的位置/周线/资金三条都满足（旧规则会喊建仓区）—— 所以拦下它的只能是新闸门'
    + '（实际 pos250=' + (ws && isFinite(ws.pos250) ? (ws.pos250 * 100).toFixed(1) + '%' : '—')
    + '，周线 ' + (ws && isFinite(ws.wma20) ? (ws.wma5 > ws.wma20 ? '多头' : '空头') : '—') + '）');
  ok(ws && ws.key === 'trending', '★ S2②c：暴涨暴跌后的「半山腰」不再判建仓区（闸门 A/B 生效）');
  ok(ws && isFinite(ws.premLow) && ws.premLow > 0.30, '★ S2②d：闸门依据「距一年最低价」已暴露给渲染层（premLow=' +
    (ws && isFinite(ws.premLow) ? (ws.premLow * 100).toFixed(0) + '%' : '—') + '）');
  /* ②e 闸门 B 专项（用户 2026-09-20 追加「同周期支撑位」）：
     形态：低位 11.5 长期横盘（这是近一年最低）→ 中段冲高到 20 → 回落 → 最后 20 周在 12.2~14.5 之间走强。
     结果：距一年最低仅 +27%（过闸门 A）、周线已多头、位置分位 <40%、资金净流入 ——
           但现价距「近 20 周最低价」已 +19.7%，即已离开周级支撑，属半山腰，必须被闸门 B 拦下。 */
  ws = mkStage('999992',
    mkStageBars((i) => {
      if (i < 100) return 11.5                            // 近一年最低在这里
      if (i < 140) return 11.5 + (i - 100) * 0.2125       // 冲高到 20
      if (i < 150) return 20 - (i - 140) * 0.85           // 快速回落
      if (i < 165) return 11.5 + (i - 150) * 0.0733       // 回到 12.6
      return 12.6 + (i - 165) * 0.0141                    // 缓升到 14.5
    }, () => 1e6),
    2e9, 2e10);
  ok(ws && isFinite(ws.premLow) && ws.premLow < 0.30 && ws.pos250 < 0.4 && ws.wma5 > ws.wma20,
    '★ S2②e-前置：该形态能过闸门 A（距一年最低 ' + (ws && isFinite(ws.premLow) ? (ws.premLow * 100).toFixed(0) + '%' : '—') +
    '）、位置与周线条件也都满足 —— 所以拦下它的必须是闸门 B');
  ok(ws && isFinite(ws.supDist) && ws.supDist > 0.15,
    '★ S2②f：闸门 B 依据「距近 20 周最低价」已暴露（supDist=' + (ws && isFinite(ws.supDist) ? (ws.supDist * 100).toFixed(0) + '%' : '—') + '）');
  ok(ws && ws.key === 'trending', '★ S2②g：已离开周级支撑（距 20 周最低 >15%）→ 不判建仓区（闸门 B 生效）');
  /* ②h 周级压力/支撑本身要出得来 */
  ok(ws && isFinite(ws.resDist) && ws.resDist < 0, '★ S2②h：距周级压力已算出且为负（现价在 20 周最高价下方）');
  /* ②i 阶段顶部辅助（用户 2026-09-20 追加）：多头排列 + 连续≥2 日站上 MA5 */
  ws = mkStage('999992', mkStageBars((i) => (i < 200 ? 10 : 10 + (i - 200) * 0.06), () => 1e6), 0, 2e10);
  ok(ws && ws.topWarn === true && ws.streak5 >= 2 && ws.maAlign === true,
    '★ S2②i：多头排列 + 连续站上 MA5 → 阶段顶部辅助置位（连续 ' + (ws && ws.streak5) + ' 日）');
  ws = mkStage('999992', mkStageBars(() => 10, () => 1e6), 0, 2e10);
  ok(ws && ws.topWarn === false, '★ S2②j：横盘（非多头排列，连续 0 日）→ 阶段顶部辅助不置位');
  /* ③ 高位过热·减仓（2026-09-20 换版，替换旧「派发完毕」）
        形态：低位长期横盘 12 → 最后 3 日跳到 20。
        此时 MA5>MA10>MA20>MA30（多头排列）、连续 3 日开&收都站上当日 MA5、
        现价偏离 MA5 约 +19%、位置分位 ≈ 98% —— 四条全中。 */
  ws = mkStage('999992', mkStageBars((i, n) => (i < n - 3 ? 12 : 20), () => 1e6), 0, 2e10);
  ok(ws && ws.key === 'sell-overheat' && ws.tone === 'warn',
    '★ S2③：多头排列 + 连续≥2 日站上 MA5 + 偏离 MA5>5% + 位置>65% → 高位过热·减仓（连续 ' +
    (ws && ws.streak5) + ' 日 / 偏离 ' + (ws && isFinite(ws.overMa5) ? (ws.overMa5 * 100).toFixed(1) + '%' : '—') + '）');
  ok(ws && /分批兑现/.test(ws.advice), '★ S2③b：卖点明说「分批兑现、不是清仓」（连板途中会连报几天）');
  ok(ws && /2025/.test(ws.advice), '★ S2③c：卖点如实标注 2025 两时段曾反向，别外推');
  /* ③d 旧「派发完毕」形态（高位 + 60 日大涨 + 缩量）已停用 → 落回趋势运行中；
       但必须把「为什么这次不提醒你减」讲明白（避免"高位却不提示"的困惑）*/
  ws = mkStage('999992',
    mkStageBars((i, n) => (i < n - 60 ? 10 : 10 + (i - (n - 60)) * 0.2), (i, n) => (i < n - 20 ? 1e6 : 5e5)),
    -1e8, 2e10);
  ok(ws && ws.key === 'trending', '★ S2③d：旧「派发完毕」形态不再单独出信号（区间级躲对率仅 50% = 抛硬币，已停用）');
  ok(ws && /已停用/.test(ws.advice), '★ S2③e：高位但未到过热门槛时，如实说明旧规则为何不提醒');
  /* ④ 下跌未完：深跌 + 缩量 + 无资金进场 */
  ws = mkStage('999992',
    mkStageBars((i, n) => (i < n - 60 ? 20 : 20 - (i - (n - 60)) * 0.1), (i, n) => (i < n - 20 ? 1e6 : 5e5)),
    0, 2e10);
  ok(ws && ws.key === 'fall-not-done' && ws.tone === 'bad', '★ S2④：深跌 + 缩量 + 无资金 → 下跌未完（勿抄底）');
  /* ⑤ 其余 = 趋势运行中（不给操作信号） */
  ws = mkStage('999992', mkStageBars(() => 10, () => 1e6), 0, 2e10);
  ok(ws && ws.key === 'trending' && ws.tone === 'mute', '★ S2⑤：无关键变化 → 趋势运行中（不给操作建议）');
  ok(ws && /无需操作/.test(ws.advice), '★ S2⑤b：趋势运行中明说「无需操作」');
  /* ⑥ 只在状态变化时提示（用户诉求：不是每天都出信号） */
  w.localStorage.removeItem('sa_ml_state_v1');
  const c1 = w.mlChanged('999992', 'trending', 'sa_ml_state_v1');
  const c2 = w.mlChanged('999992', 'trending', 'sa_ml_state_v1');
  const c3 = w.mlChanged('999992', 'accumulate-zone', 'sa_ml_state_v1');
  ok(c1 === true && c2 === false && c3 === true, '★ S2⑥：状态变化检测（首次/变化=true，重复=false）');
  /* ⑥b 波段定性靠「起始日只在状态变化时刷新」——否则永远数不出这一段走了多久 */
  const barsT = mkStageBars(() => 10, () => 1e6, 300);
  w.G.dayBars = Object.assign({}, w.G.dayBars, { '999993': barsT });   // 只加，不覆盖 999992（后续用例要用）
  w.localStorage.removeItem('sa_ml_state_v1');
  w.mlChanged('999993', 'trending', 'sa_ml_state_v1');
  const recD1 = JSON.parse(w.localStorage.getItem('sa_ml_state_v1'))['999993'].d;
  w.mlChanged('999993', 'trending', 'sa_ml_state_v1');   // 同状态再来一次
  const recD2 = JSON.parse(w.localStorage.getItem('sa_ml_state_v1'))['999993'].d;
  eq(recD2, recD1, '★ S2⑥b：同一状态重复记录不刷新起始日（否则波段天数永远是 1）');
  const fromD = barsT[barsT.length - 4].d;
  w.localStorage.setItem('sa_ml_state_v1', JSON.stringify({ '999993': { k: 'trending', d: fromD } }));
  eq(w.mlRunDays('999993', 'trending'), 4, '★ S2⑥c：本态已持续交易日数按日K 实数（自起始日共 4 个交易日）');
  eq(w.mlRunDays('999993', 'accumulate-zone'), 0, '★ S2⑥d：状态对不上 → 返回 0（不编数字）');
  eq(w.mlStateSince('999993'), fromD, '★ S2⑥e：起始日原样返回');
  eq(w.mlStateSince('999988'), '', '★ S2⑥f：本地没记录 → 返回空串（不编日期）');
  /* ⑦ 隔离：引擎只读，不改筹码/行情数据 */
  const beforeBars = JSON.stringify(w.G.dayBars['999992'].slice(-3));
  w.weekStage('999992');
  eq(JSON.stringify(w.G.dayBars['999992'].slice(-3)), beforeBars, '★ S2⑦：中长线引擎只读，日K 零修改');
  /* ⑧ 详情页渲染：关键位置块出现且带四维度 */
  w.G.chipMap = { '999992': { main: { key: 'accumulate' }, retail: { key: 'surrender' },
    chips: { mainCost: 10 }, price: 12, flows: { main20: 2e9 } } };
  w.G.v3Map = { '999992': { at: '2026-09-18', state: 'normal', dirs: [1, 1, 1], srcs: 3, agreeN: 3,
    majority: 1, conf: 0.8, chg: 0.01, mainYi: 0.5, ret20: 0.05, vr: 1.1, conflictDays: 0 } };
  const dhtml = w.v3DetailHtml('999992');
  has(dhtml, '中长线 →', '★ S2⑧：持仓详情新增「中长线 → 结论」块');
  /* 2026-09-20「只留结论」：周/月级指标格（一年位置、近 4 周主力…）是判定依据，已撤下界面 */
  notHas(dhtml, '一年位置', '★ S2⑧b：位置分位等判定依据已撤下（结论写在中长线 cd-act 里）');
  notHas(dhtml, '近 4 周主力', '★ S2⑧c：周级资金占比等判定依据已撤下');
  /* ⑨ 波段定性：详情页要显示「本态已持续 N 个交易日」，不是单日指令 */
  const barsAcc = mkStageBars((i, n) => {
    if (i < 100) return 20 - i * 0.08
    if (i < n - 60) return 12
    return 12 + (i - (n - 60)) * 0.02
  }, () => 1e6);
  w.G.dayBars = { '999992': barsAcc };
  w.G.quoteMap = { [w.secidOf({ code: '999992' })]: { price: barsAcc[barsAcc.length - 1].c, mv: 2e10 } };
  w.localStorage.setItem('sa_ml_state_v1',
    JSON.stringify({ '999992': { k: 'accumulate-zone', d: barsAcc[barsAcc.length - 4].d } }));
  const dhtml2 = w.v3DetailHtml('999992');
  has(dhtml2, '第 4 天', '★ S2⑨：波段定性并入中长线标题「中长线 → …（第 4 天）」（状态是一段区间，不是单日指令）');
  notHas(dhtml2, '本态已持续', '★ S2⑨b：波段定性说明段已撤下（天数已写在标题里，不再单开一段）');
  notHas(dhtml2, '4 个交易日', '★ S2⑨c：撤下重复表述（天数只保留标题里那一处）');
  /* ⑨e 列表层「第 N 天」：DOM 层验不了 —— renderDash 会走 chipEnsure 重新取数，
        测试注入的 chipMap 会被覆盖（表现为 weekStage 掉回 trending）。改用**渲染代码**静态断言。 */
  const s2Src = fs.readFileSync(PREVIEW, 'utf8');
  has(s2Src, "' · 第 ' + rd + ' 天'", '★ S2⑨e：首页中长线行渲染代码含「第 N 天」逻辑（波段定性到列表层）');
  has(s2Src, 'function mlRunDays(', '★ S2⑨f：波段天数靠 mlRunDays 按日K 实数（零额外请求）');
  has(s2Src, "changed ? todayStr() : (prev.d || todayStr())", '★ S2⑨g：起始日只在状态变化时刷新（否则天数永远=1）');
  /* ⑩ 风险控制：统一 −10% 止损位（2026-09-20 用户拍板；回测依据 _tests/s1-eval.js） */
  /* ★ 2026-09-20：持仓不再记成本 → 止损位与风险控制块从详情页撤下（函数保留可回退，下面直接单测） */
  notHas(dhtml2, '风险控制', '★ S2⑩：详情页不再有风险控制块（没有成本基准就不给止损位）');
  notHas(dhtml2, '止损位', '★ S2⑩b：详情页不再出现止损价位');
  const savedHoldS3 = w.G.cfg.holdings;
  const lastClose = barsAcc[barsAcc.length - 1].c;
  /* ① 有持仓成本 → 止损位 = 成本 × 0.9 */
  w.G.cfg.holdings = [{ code: '999992', name: '测试股', cost: 10, qty: 100 }];
  const st1 = w.mlStopLoss('999992');
  ok(st1 && Math.abs(st1.stop - 9) < 1e-9, '★ S2⑩c：有持仓成本 10 → 止损位 = 成本 × 0.9 = 9');
  ok(st1 && Math.abs(st1.gap - (lastClose / 9 - 1)) < 1e-9, '★ S2⑩d：给出「现价距止损位」百分比');
  ok(st1 && st1.hit === false, '★ S2⑩e：现价在止损位上方 → 未触发');
  /* ② 贴近止损位（gap<3%）要单独提示 */
  w.G.cfg.holdings = [{ code: '999992', name: '测试股', cost: 14.5, qty: 100 }];
  has(w.mlStopHtml('999992'), '贴近止损位', '★ S2⑩f：现价距止损位不足 3% → 提示「贴近止损位」');
  /* ③ 已跌破 → 说清是纪律不是预测 */
  w.G.cfg.holdings = [{ code: '999992', name: '测试股', cost: 14.7, qty: 100 }];
  const stHtml = w.mlStopHtml('999992');
  has(stHtml, '已跌破止损位', '★ S2⑩g：现价低于止损位 → 明确报「已跌破」');
  has(stHtml, '不是预测，是给「买错了」留的出口', '★ S2⑩h：说清止损是纪律不是预测');
  /* ④ 没记成本 → 用本态起始价近似，且必须标注口径 */
  w.G.cfg.holdings = [];
  const st2 = w.mlStopLoss('999992');
  const sinceC = barsAcc[barsAcc.length - 4].c;
  ok(st2 && Math.abs(st2.stop - sinceC * 0.9) < 1e-9,
    '★ S2⑩i：没记持仓成本 → 止损位 = 本态起始价 ' + sinceC.toFixed(2) + ' × 0.9');
  has(w.mlStopHtml('999992'), '近似', '★ S2⑩j：近似口径必须在界面上标注（不悄悄换基准）');
  /* ⑤ 成本与本态起始日都没有 → 不给数字 */
  w.localStorage.removeItem('sa_ml_state_v1');
  eq(w.mlStopLoss('999992'), null, '★ S2⑩k：既没成本也没本态起始日 → 不给止损位（不编数字）');
  w.localStorage.setItem('sa_ml_state_v1',
    JSON.stringify({ '999992': { k: 'accumulate-zone', d: barsAcc[barsAcc.length - 4].d } }));
  w.G.cfg.holdings = savedHoldS3;
  /* ⑪ 筹码维度接入（2026-09-20 用户拍板「接已建好未接的模块」）：只展示 + 给卖点分级，**不参与触发** */
  w.G.dayBars = { '999992': mkStageBars((i, n) => (i < n - 3 ? 12 : 20), () => 1e6) };
  w.G.quoteMap = { [w.secidOf({ code: '999992' })]: { price: 20, mv: 2e10 } };
  w.G.chipMap = { '999992': { chips: { mainCost: 15, profitRatio: 0.95, concentration: 0.7 }, flows: { main20: 0 } } };
  let wsc = w.weekStage('999992');
  ok(wsc && wsc.key === 'sell-overheat', '★ S2⑪-前置：该形态仍是高位过热（筹码不改变触发）');
  eq(wsc.chipGrade, 'thick', '★ S2⑪：现价高于主力成本 33% ≥15% → 卖点分级 thick');
  has(wsc.advice, '主力已经赚得很厚', '★ S2⑪b：主力获利厚 → 结论里明说「减仓可以更果断」');
  w.G.chipMap = { '999992': { chips: { mainCost: 19.5, profitRatio: 0.6, concentration: 0.5 }, flows: { main20: 0 } } };
  wsc = w.weekStage('999992');
  eq(wsc.chipGrade, 'thin', '★ S2⑪c：现价高于主力成本 2.6% <15% → 分级 thin（按常规分批减即可）');
  w.G.chipMap = { '999992': { flows: { main20: 0 } } };
  wsc = w.weekStage('999992');
  eq(wsc.chipGrade, 'none', '★ S2⑪d：筹码缺失 → 不评级（不猜）');
  has(wsc.advice, '筹码数据没取到', '★ S2⑪e：筹码缺失时如实说明，不编力度');
  ok(wsc && wsc.key === 'sell-overheat', '★ S2⑪f：筹码缺失**不影响触发**（触发条件零改动）');
  w.G.chipMap = { '999992': { chips: { mainCost: 15, profitRatio: 0.95, concentration: 0.7 },
    flows: { main20: 0 }, main: { key: 'lift' }, retail: { key: 'chase' } } };
  const dhtml3 = w.v3DetailHtml('999992');
  notHas(dhtml3, '集中度', '★ S2⑪g：筹码指标格（集中度/获利盘）已撤下界面（卖点分级仍由 chipGrade 单测锁定）');
  has(dhtml3, '主力成本', '★ S2⑪h：详情页给出主力成本');
  ok(dhtml3.indexOf('不参与触发判定') < 0,
    '★ S2⑪i：界面不再放推理说明；「筹码只分级、不触发」由 ⑪f 的算法级断言锁死');
  /* ⑫ 大盘环境接入（2026-09-20「接已建好未接的模块」第二件：恐贪指数 + 风格驾驶舱）—— 只标注，不参与触发
     回测依据 _tests/s1-market-report.md：恐贪低位时卖点后 60 日 −11.5% vs 高位 −5.2%；风格七档 1 天存档无法回测 */
  const savedStyleLoaded = w.STYLE.loaded, savedStyleData = w.STYLE.data;
  const savedFngLoaded = w.FNG.loaded, savedFngLive = w.FNG.live;
  w.STYLE.loaded = false; w.STYLE.data = null; w.FNG.loaded = false; w.FNG.live = null;
  eq(w.mlMarketCtx(), null, '★ S2⑫：大盘数据没加载 → 返回 null（诚实降级，不编数字）');
  ok(w.v3DetailHtml('999992').indexOf('大盘风格') < 0, '★ S2⑫b：没数据就不渲染大盘行（不出现空壳）');
  w.STYLE.loaded = true;
  w.STYLE.data = { date: '2026-09-18', style: { name: '题材主升浪 · 半导体' }, cycle: { cycle: '发酵' }, fng: 58 };
  const mctx = w.mlMarketCtx();
  ok(mctx && mctx.style === '题材主升浪 · 半导体' && mctx.cycle === '发酵' && mctx.fng === 58,
    '★ S2⑫c：mlMarketCtx 读出 风格/情绪周期/恐贪（纯读已加载数据，零额外请求）');
  const dMkt = w.v3DetailHtml('999992');
  has(dMkt, '大盘风格', '★ S2⑫d：详情页给出大盘风格（接风格驾驶舱）');
  has(dMkt, '情绪周期', '★ S2⑫e：详情页给出情绪周期');
  has(dMkt, '恐贪指数', '★ S2⑫f：详情页给出恐贪指数（接恐贪模块）');
  has(dMkt, '仅环境标注', '★ S2⑫g：大盘行明确「仅环境标注」、不参与触发');
  ok(dMkt.indexOf('无法回测') < 0 && dMkt.indexOf('s1-market-report') < 0,
    '★ S2⑫g-2：界面不再展开大盘回测口径（只留格内「仅环境标注」）');
  eq(w.mlFngZone(75), '贪婪', '★ S2⑫h：恐贪 ≥70 → 贪婪');
  eq(w.mlFngZone(50), '中性', '★ S2⑫i：恐贪 30~70 → 中性');
  eq(w.mlFngZone(20), '恐慌', '★ S2⑫j：恐贪 ≤30 → 恐慌');
  w.STYLE.data.fng = 22;
  has(w.v3DetailHtml('999992'), '恐慌', '★ S2⑫k：恐贪低位在「大盘一行」里如实标出「恐慌」档（只标注，不参与判定）');
  w.STYLE.data.fng = 78;
  ok(w.v3DetailHtml('999992').indexOf('恐慌区') < 0, '★ S2⑫l：恐贪高位 → 不说「恐慌区」（有则说、无则静）');
  ok((w.weekStage('999992') || {}).key === 'sell-overheat', '★ S2⑫m：接入大盘后中长线触发条件零改动');
  /* 静态：懒加载不得自己重画（否则 renderDash 末尾调用 → 无限重画）*/
  const mktSrc = fs.readFileSync(PREVIEW, 'utf8');
  has(mktSrc, 'function mlMarketCtx(', '★ S2⑫n：console 有 mlMarketCtx（纯读，零请求）');
  const mkeAt = mktSrc.indexOf('function mlMarketEnsure(');
  const mke = mkeAt < 0 ? '' : mktSrc.slice(mkeAt, mkeAt + 600);
  ok(mke.length > 0 && mke.indexOf('renderDash') < 0 && mke.indexOf('renderActive') < 0 && mke.indexOf('paintFromCache') < 0,
    '★ S2⑫o：懒加载不主动重画（靠行情轮询自然刷新，避开「补完即重画」的无限循环）');
  /* 复原（后续用例依赖演示态的 STYLE/FNG）*/
  w.STYLE.loaded = savedStyleLoaded; w.STYLE.data = savedStyleData;
  w.FNG.loaded = savedFngLoaded; w.FNG.live = savedFngLive;
  /* ⑬ 结论文案加粗渲染（2026-09-20 修：以前 **强调** 被当字面量显示，界面上真能看到星号）*/
  eq(w.mdB('甲**乙**丙'), '甲<b>乙</b>丙', '★ S2⑬：结论文案 **强调** → 粗体');
  eq(w.mdB('没有标记'), '没有标记', '★ S2⑬b：没有标记 → 原样返回（不乱改）');
  eq(w.mdB('<x>**y**</x>'), '<x><b>y</b></x>', '★ S2⑬c：只替换成对 ** 标记，不动其它内容');
  ok(dhtml2.indexOf('**') < 0, '★ S2⑬d：中长线详情里不再出现字面 **（建仓区那段含强调文案）');
  has(s2Src, 'function mdB(', '★ S2⑬e：console 有 mdB（展示层专用，不改算法）');
  has(s2Src, 'mdB(esc(ws.advice))', '★ S2⑬f：advice 走「先 esc 再替换」，不引入注入');
  /* ⑭ 仓位：用户明确「仓位我自己会控制、不用给建议」→ 只留系统必须说清的一条（2026-09-20 降级）*/
  const dPos = w.v3DetailHtml('999992');
  /* ★ 2026-09-20 用户要求撤下：仓位那一整行（仓位你自己控 / 别全进全出）不再上界面 */
  notHas(dPos, '你自己控', '★ S2⑭：详情页不再有「仓位你自己控」那一行');
  notHas(dPos, '别全进全出', '★ S2⑭b：不再出现底仓/全进全出的仓位提示');
  notHas(dPos, '不是清仓或满仓的按钮', '★ S2⑭c：仓位相关文案已整体撤下');
  ok(dPos.indexOf('收益 ÷ 回撤') < 0 && dPos.indexOf('18.14') < 0,
    '★ S2⑭d：不再出现仓位档位对照表（用户不要建议）');
  ok(dPos.indexOf('底仓 70%') < 0 && dPos.indexOf('等权参考') < 0,
    '★ S2⑭e：不再出现「该拿多少仓 / 每只分多少」的仓位建议');
  ok((w.weekStage('999992') || {}).key === 'sell-overheat', '★ S2⑭f：降级后触发条件零改动');
  has(s2Src, 'function mlPositionHtml(', '★ S2⑭g：console 仍保留 mlPositionHtml 渲染入口');
  ok(s2Src.indexOf('function mlPosTarget(') < 0 && s2Src.indexOf('var ML_BASE') < 0,
    '★ S2⑭h：旧仓位建议代码（mlPosTarget / ML_BASE）已整体删除，不留死代码');
  /* ⑮ 详情页信息分层（2026-09-20 用户要求）：去掉小字备注/推理过程，只留结论 + 状态，核心指标着色
     —— 判**渲染产物**（注释不在产物里，故可安全做负断言）*/
  const dBusy = w.v3DetailHtml('999992'); /* 成交/筹码/大盘全有的那一只 */
  ok(dBusy.indexOf('class="cd-note"') < 0,
    '★ S2⑮：持仓详情页不再渲染任何小字备注块（cd-note 清零）');
  /* 被删掉的那几段小字推理（判渲染产物，注释不在产物里，可安全做负断言）*/
  [['综合研判口径', '融合规则的口径说明'], ['筹码维度（接 ChipCore', '筹码维度说明'],
   ['大盘环境（接', '大盘回测口径'], ['中长线口径', 'S2 四维度口径'],
   ['主力博弈口径', '三源投票口径'], ['结构备注', '价格结构备注']].forEach(function(pair){
    ok(dBusy.indexOf(pair[0]) < 0, '★ S2⑮b：小字推理段落已撤下界面 —— ' + pair[1]);
  });
  /* ⚠️ 结论块（cd-act）里保留「口径/代价」说明是**刻意**的（②b/③b/⑪b 等断言在锁它们），
     这次只清「备注型」小字，不碰结论块 —— 两者不混为一起删。 */
  has(dBusy, 'cd-act', '★ S2⑮c：结论块（cd-act）保留 —— 只删推理、不删结论');
  has(dBusy, 'cd-stat', '★ S2⑮d：状态改用可读的状态条（cd-stat：波段定性/顶部辅助/缺源/免责）');
  ok(dBusy.indexOf('cd-v') < 0,
    '★ S2⑮e：指标格整体撤下（cd-v 不再出现在详情页 —— 只展示结论）');
  has(dBusy, '中长线 →', '★ S2⑮f：中长线结论块保留（只删推理、不删结论）');
  /* 指标格撤下后着色逻辑随之撤下；cdCell 仍保留给旧透视（chipDetailHtml 可回退）用 */
  has(s2Src, 'function cdCell(k, v, unit, tone)', '★ S2⑮j：cdCell 保留（旧透视可回退）');
  ok(dBusy.indexOf('60 日涨跌') < 0 && dBusy.indexOf('周线结构') < 0 && dBusy.indexOf('周量能比') < 0,
    '★ S2⑮k：判定依据类指标（60 日涨跌/周线结构/周量能比）已全部撤下界面');
  /* 复原（后续用例依赖演示态的 v3Map/chipMap） */
  w.G.v3Map = savedV3S; w.G.chipMap = savedChipS; w.G.quoteMap = savedQuoteS; w.G.dayBars = savedDayBars;

  // ③g V3 投票内核（口径对齐 mobile_monitor core/v3_multi_source.verify）
  eq(w.v3Vote([1,1,1]).state, 'normal', '★ 三源全同 → 主信号（共识 100% ≥ 66%）');
  eq(w.v3Vote([-1,-1,1]).state, 'normal', '★ 2/3 源同向 → 主信号（共识 66.7%，刚过 AGREE_RATIO）');
  eq(w.v3Vote([1,-1,0]).state, 'downgrade', '★ 平票/无多数 → 数据冲突下修');
  eq(w.v3Vote([1,-1]).state, 'downgrade', '★ 两源对立 → 数据冲突下修');
  eq(w.v3Vote([1,null,null]).state, 'observe', '★ 有效源不足 2 个 → 观察（不参与投票、不计冲突）');
  eq(w.v3Vote([1,1,-1]).majority, 1, '多数方向 = 向上');
  eq(w.v3Vote([1,1,-1]).agreeN, 2, '共识票数 = 2');
  eq(w.v3Vote([-1,-1,1]).majority, -1, '多数方向 = 向下');
  eq(w.v3sign(0.5), 1, 'v3sign：涨 → 1');
  eq(w.v3sign(-0.5), -1, 'v3sign：跌 → -1');
  eq(w.v3sign(0), 0, 'v3sign：0 → 走平（不是向上也不是向下）');

  // ③h ★ 验证用例：三安光电 600703（原样数据：收 12.98 +1.09%，主力 +0.79亿，20 日 -5.9%，成本 12.50）
  //     期望：2/3 共识（66.7% ≥ 0.66）→  回补吸筹，短线可拿、中期仍弱、不追高；成本有垫
  w.G.cfg.holdings = [{ code: '600703', name: '三安光电', cost: 12.50, qty: 1000 }];
  /* 演示行情里没有三安，按实盘数据补一条：收 12.98（+1.09%）。
     ⚠️ 行情键必须走 secidOf（东财格式 1.600703），跟报价管线保持一致 */
  w.G.quoteMap[w.secidOf({ code: '600703' })] = { price: 12.98, chg: 1.09 };
  const sanan = { at: w.todayStr(), state: 'normal', dirs: [1, 1, -1], srcs: 3, agreeN: 2, majority: 1,
    chg: 1.09, mainYi: 0.79, ret20: -0.059, vr: 1.00, conflictDays: 0, conf: 0.8, err: '' };
  w.G.v3Map['600703'] = sanan;
  const sananV = w.v3Vote(sanan.dirs);
  eq(sananV.state, 'normal', '★ 三安光电：2/3 源同向（66.7%）→ 主信号，不是降级');
  eq(sananV.agreeN, 2, '★ 三安光电：共识票数 2');
  const sananHead = w.v3Head('600703');
  ok(sananHead.t.indexOf('回补吸筹') >= 0, '★ 三安光电 → 主标题「回补吸筹」（不是干巴巴的「主信号·向上」）');
  eq(sananHead.k, 'warn', '★ 回补吸筹用琥珀「留意」色（短线可拿但中期仍弱）');
  has(w.v3Sub('600703'), '价涨 + 主力买 + 20日仍弱', '★ 副标题把三源翻译成人话');
  has(w.v3SrcNote(1, sanan), '吸筹 +0.79亿', '★ 主力净额带「吸筹」备注');
  has(w.v3SrcNote(2, sanan), '阴跌 -5.9%', '★ 20 日趋势写成「阴跌」并标出百分比');
  const sananAdvice = w.v3Advice('600703');
  has(sananAdvice, '成本 12.50 元', '★ 操作建议带上自己的持仓成本');
  ok(sananAdvice.indexOf('浮盈') >= 0 || sananAdvice.indexOf('持平') >= 0, '★ 并算出浮盈比例，而不是凭空给目标价');
  ok(sananAdvice.indexOf('13.2') < 0, '★ ★ 不给目标价 —— 目标价是预测，没数据支撑不能编');

  // ③i 行为场景矩阵：三源组合 → 人话标签（用户点的词都要能出来）
  const scene = (dirs, opt) => {
    opt = opt || {};
    const code = '__S' + Math.random().toString(36).slice(2, 7);
    w.G.v3Map[code] = { at: w.todayStr(), state: opt.state || 'normal', dirs: dirs, srcs: 3,
      agreeN: opt.agreeN != null ? opt.agreeN : 3, majority: opt.maj, chg: opt.chg != null ? opt.chg : 1,
      mainYi: opt.mainYi != null ? opt.mainYi : 1, ret20: opt.ret20 != null ? opt.ret20 : 0.05,
      vr: opt.vr, conflictDays: 0, conf: 0.8, err: '' };
    const hd = w.v3Head(code);
    return hd ? hd.t.replace(/[]\s*/u, '') : '(空)';
  };
  eq(scene([1, 1, 1], { vr: 1.9 }), '放量突破', '★ 三源全上 + 放量 → 放量突破');
  eq(scene([1, 1, 1], { vr: 0.5 }), '弱回流', '★ 三源全上但缩量 → 弱回流');
  eq(scene([1, 1, 1]), '主力建仓拉升', '★ 三源全上 → 主力建仓拉升（主升浪）');
  eq(scene([1, 1, -1]), '回补吸筹', '★ 价涨+主力买+20日弱 → 回补吸筹');
  eq(scene([1, -1, -1]), '拉高诱多', '★ 价涨+主力出+20日弱 → 拉高诱多');
  eq(scene([1, -1, 1]), '高位派发', '★ 价涨+主力出+20日强 → 高位派发');
  eq(scene([-1, 1, 1]), '良性回踩', '★ 价跌+主力买+20日强 → 良性回踩');
  eq(scene([-1, 1, -1]), '低位吸筹', '★ 价跌+主力买+20日弱 → 低位吸筹');
  eq(scene([-1, -1, 1], { ret20: 0.08 }), '撤退嫌疑', '★ 价跌+主力出+20日强 → 撤退嫌疑');
  eq(scene([-1, -1, -1], { ret20: 0.25 }), '高位出货完毕', '★ 价跌+主力出+20日高位 → 高位出货完毕');
  eq(scene([-1, -1, -1], { ret20: -0.05 }), '主力持续派发', '★ 价跌+主力出+20日弱 → 主力持续派发');
  eq(scene([1, -1, 0], { state: 'downgrade', maj: null, agreeN: 0 }), '观望', '★ 平票数据打架 → 观望');
  eq(scene([1, -1, 0], { state: 'trend', maj: null, agreeN: 0, cd: 3, ret20: 0.2 }), '趋势持有',
    '★ 冲突 ≥3 天 + 20 日大涨 → 趋势持有');
  eq(scene([null, null, null], { state: 'observe', maj: null, agreeN: 0 }), '待确认', '★ 源不足 → 待确认');
  has(w.v3Sub(Object.keys(w.G.v3Map).find(k => w.G.v3Map[k].state === 'observe')), '缺数据',
    '★ 缺源要说「缺数据」，绝不能说成「走平」');

  // ③i-2 ★ 演示数据必须自洽：dirs 是由 chg/mainYi/ret20 经 v3sign 算出来的，不能手编
  //       （曾踩过：dirs 写 [1,-1,0] 却给 ret20=+18.7%，页面上会同时出现「20日走平」和「趋势上行 +18.7%」）
  const demo = w.demoV3Data();
  Object.keys(demo).forEach(code => {
    const v = demo[code];
    const pair = [['chg', 0], ['mainYi', 1], ['ret20', 2]];
    pair.forEach(([key, idx]) => {
      const val = v[key];
      if (!isFinite(val)) { eq(v.dirs[idx], null, '★ 演示 ' + code + '：' + key + ' 没取到 → dirs[' + idx + '] 必须是 null'); return; }
      eq(v.dirs[idx], w.v3sign(val), '★ 演示 ' + code + '：dirs[' + idx + '] 必须等于 v3sign(' + key + ')');
    });
    eq(v.srcs, v.dirs.filter(x => x !== null).length, '★ 演示 ' + code + '：srcs 等于有效源个数');
    ok(!(v.srcs < v.dirs.length && !v.err), '★ 演示 ' + code + '：少了源就必须写明 err（缺源不能悄悄算完）');
  });

  // ③i-3 ★ 价格结构 v2.1（与 Python 引擎同口径移植）：评分 + 结构裁决
  ok(typeof w.psCalc === 'function' && typeof w.v3PsRow === 'function' && typeof w.psRuling === 'function',
    '★ 价格结构模块已挂载（v3PsRow/psCalc/psRuling）');
  const decoyRow = { close: 40.5, pct: 0.8, volume: 50_000, volMa5: 100_000,
    ma5: 39.0, ma10: 40.0, ma20: 41.0, ret20: -8.0, high20: 42.0, prevLow: 39.5 };
  let psOut = w.psCalc(decoyRow);
  eq(psOut.score, 0, '★ 诱多过滤（空头+缩量反弹+触MA20）→ 0 分硬过滤');
  ok(psOut.flags.force_no_trade === true, '★ 诱多 → force_no_trade');
  const breakRow = { close: 39.0, pct: -2.5, volume: 90_000, volMa5: 100_000,
    ma5: 40.5, ma10: 41.0, ma20: 40.2, ret20: 6.0, high20: 42.0, prevLow: 39.5 };
  psOut = w.psCalc(breakRow);
  ok(psOut.flags.sell_bias === true, '★ 破 MA20 + 死叉 → sell_bias');
  eq(psOut.bias, '减仓偏置(结构破位)', '★ 破位 → 减仓偏置');
  const revRow = { close: 35.64, pct: 8.33, volume: 397_211, volMa5: 253_000,
    ma5: 33.81, ma10: 34.60, ma20: 35.10, ret20: 3.0, high20: 36.5, prevLow: 33.20 };
  psOut = w.psCalc(revRow);
  ok(psOut.flags.reversal_exempt === true && psOut.flags.sell_bias !== true,
    '★ v2.1 反转首日豁免：+8.33% VR1.57 站上 MA5 → 不判破位（牧原 24-09-24 形态）');
  const hugeRow = { close: 47.88, pct: 10.0, volume: 1_000_000, volMa5: 166_000,
    ma5: 44.55, ma10: 43.80, ma20: 43.48, ret20: 12.0, high20: 47.88, prevLow: 43.0 };
  psOut = w.psCalc(hugeRow);
  ok(psOut.flags.pending_confirm === true && psOut.flags.sector_exempt === false,
    '★ VR>3.0 无板块数据 → 待确认（保守，不误判买入）');
  eq(psOut.bias, '待确认(天量/回踩)', '★ 天量 → 待确认');
  /* 演示数据的裁决链：600733 诱多 →  覆盖「观望」标题 */
  ok(w.G.v3Map['600733'].ps.flags.force_no_trade === true, '★ 演示 600733：价格结构判诱多');
  has(w.v3DetailHtml('600733'), '诱多过滤', '★ 价格结构硬裁决落到综合研判结论上（详情只留「躲（诱多过滤）」这一句）');
  notHas(w.v3DetailHtml('600733'), '价格结构', '★ 价格结构评分属推理中间量，已撤下界面');
  has(w.v3BriefHtml('600733'), '不操作(诱多过滤)', '★ 摘要行露出结构硬裁决徽章');
  ok(w.psRuling(w.G.v3Map['600519']).t === '', '★ 演示 600519：无硬裁决 → 标题不被改写');

  // ③j 缺同一张卡的行为（不是纯函数）：确保 600703 这张卡真能渲染出这些话
  w.renderHoldings(map2);
  const sananCard = d.getElementById('hList').querySelector('.hg[data-code="600703"]');
  ok(!!sananCard, '渲染出三安光电的持仓卡');
  has(sananCard.textContent, '回补吸筹', '★ 卡上主标题是「回补吸筹」');
  has(sananCard.textContent, '主力 → 回补吸筹', '★ 卡上给的是主力行为判定结论（三源明细已撤下界面）');
  has(sananCard.textContent, '主力 → 回补吸筹', '★ 卡上给的是主力行为判定结论');
  has(sananCard.textContent, '短线可拿，中期仍弱，不追高', '★ 卡上写明了能不能拿、要不要追高');
  notHas(sananCard.textContent, '成本 12.50', '★ 卡上不再带成本口径（持仓不记账）');
  delete w.G.v3Map['600703'];
  w.G.cfg.holdings = [];

  // ④ 推荐入口卡：显示最新一条，点击进推荐列表
  w.renderDash(map2);
  has(dash.textContent, '今日推荐', '仪表盘有「今日推荐」区块');
  has(dash.querySelector('[data-act="dash-picks"]').textContent, '格力电器', '推荐卡展示最新一条备选（格力电器）');
  has(dash.querySelector('[data-act="dash-picks"]').textContent, '2 条备选', '推荐卡说明共有几条备选');
  dash.querySelector('[data-act="dash-picks"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('pgPicks').classList.contains('on'), '★ 点推荐卡进入推荐股列表页');
  w.switchView('monitor');

  /* ---------- 19. ★ 首屏不白板 + 刷新不闪（2026-09-17 用户反馈"刷新时变白板"） ----------
     根因两条：① #dash 静态是空的，boot() 要等 loadConfig/loadState 两轮网络才画得出内容；
              ② 行情每次回来都 innerHTML 全量重画，数据没变也重建 DOM → 闪、跳动。
     修复：骨架 + 本地缓存秒开 + 内容签名「没变就不动 DOM」。 */
  const rawHtml = fs.readFileSync(PREVIEW, 'utf8');
  ok(/<div id="dash">\s*<div class="dash-h">持仓 · 主力博弈<\/div>/.test(rawHtml),
    '★ #dash 首屏自带骨架（不再是空 div —— 那是"白板"的根源；2026-09-19 定稿：持仓卡第一位）');
  has(rawHtml, '<div class="sk lg"></div>', '骨架里有大号占位条（价格位）');
  ok(/\.sk\{[^}]*skpulse/.test(rawHtml), '骨架带脉动动画（看得出在加载，不是卡死）');

  ok(typeof w.paint === 'function', '★ paint(el, html, key) 已实现');
  const pbox = d.createElement('div');
  pbox.innerHTML = 'A';
  eq(w.paint(pbox, 'B', 'tSig'), true, 'paint：内容变化 → 写入并返回 true');
  eq(pbox.innerHTML, 'B', 'paint：DOM 已更新');
  eq(w.paint(pbox, 'B', 'tSig'), false, '★ paint：内容一样 → 不动 DOM、返回 false（"刷新不闪"的关键）');
  pbox.innerHTML = 'USER';
  w.paint(pbox, 'B', 'tSig');
  eq(pbox.innerHTML, 'USER', '★ paint 跳过时不会覆盖外部对同一容器的改动（展开态/输入内容得以保留）');

  const bootScripts = qa(d, 'script').map(s => s.textContent || '').filter(t => t.indexOf('async function boot') >= 0).join('\n');
  has(bootScripts, "paint(box, h, 'dashSig')", '★ renderDash 走 paint（首页刷新不再整块重画）');
  has(bootScripts, "paint(box, html, 'actSig')", '★ renderActive 走 paint');
  has(bootScripts, "paint(box, html, 'holdSig')", '★ renderHoldings 走 paint');
  has(bootScripts, "paint(box, html, 'pickSig')", '★ renderPicks 走 paint');

  ok(typeof w.readCache === 'function' && typeof w.writeCache === 'function' && typeof w.clearCache === 'function',
    '★ 本地缓存三件套 readCache / writeCache / clearCache 都在');
  eq(w.readCache(), null, '缓存为空时 readCache 返回 null（不抛异常）');
  has(bootScripts, 'function paintFromCache()', '★ 有「先用缓存铺首屏」的 paintFromCache');
  const bootSrc = bootScripts.slice(bootScripts.indexOf('async function boot()'));
  ok(bootSrc.indexOf('paintFromCache()') > 0 && bootSrc.indexOf('paintFromCache()') < bootSrc.indexOf('await loadConfig()'),
    '★ boot 先画缓存、再去联网（顺序反了就还是白板）');
  has(bootSrc, 'writeCache()', 'boot 成功后写缓存，供下次秒开');
  has(bootSrc, '下面是上次的数据', '★ 刷新失败时继续显示缓存数据（而不是把页面清空/踢去设置页）');
  has(bootScripts, 'clearCache()', '配置变更路径会作废旧缓存（换仓库后不能拿错数据顶上来）');

  w.writeCache();
  eq(w.readCache(), null, '★ 演示模式不写本地缓存（不会把示例数据当成真实数据顶上来）');

  /* ---------- 2026-09-21：首页持仓「跟进类靠前 / 过热重点提示 / 一年迷你走势图」 ----------
     规格依据：用户「首页持仓股跟进类的显示靠前，过热的重点提示，卡片增加最近1年日线迷你走势图」。 */
  {
    /* 去注释源码（本项目铁律：注释里提到函数名会让 indexOf 负断言误判，已踩四次） */
    const noCmt = (s) => String(s)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /* ① 排序优先级（纯函数，直接用假数据验证三档） */
    ok(typeof w.dashRowPrio === 'function', '★ dashRowPrio 已实现（首页持仓排序）');
    eq(w.dashRowPrio({ wsD: { key: 'sell-overheat' } }), 0, '过热 → 优先级 0（排最前）');
    eq(w.dashRowPrio({ wsD: { key: 'accumulate-zone' } }), 1, '其它关键位（建仓区）→ 优先级 1');
    eq(w.dashRowPrio({ hd3: { k: 'good' } }), 1, '主力方向明确 → 优先级 1');
    eq(w.dashRowPrio({ m5: { st: { days: 3 } } }), 1, '连站 5 日线 ≥2 天 → 优先级 1');
    eq(w.dashRowPrio({ m5: { st: { days: 1 } } }), 2, '仅站上 1 天 → 不算需跟进');
    eq(w.dashRowPrio({ wsD: { key: 'trending' } }), 2, '趋势运行中且无其它信号 → 优先级 2（沉到后面）');

    /* ⚠️ 铁律：dashRowPrio 绝不能调 mlChanged —— 它有副作用会写 localStorage，
       每只每次渲染只能调一次；若在排序阶段调用会把「新出现 / 第 N 天」判定吃掉 */
    const prioSrc = noCmt((html.match(/function dashRowPrio\(r\)\{[\s\S]*?\n\}/) || [''])[0]);
    ok(prioSrc.length > 0, '取到 dashRowPrio 函数体（用于静态校验）');
    notHas(prioSrc, 'mlChanged', '★ dashRowPrio 不调用 mlChanged（否则会吃掉「新出现」判定）');

    /* ② 迷你走势图（纯函数） */
    ok(typeof w.miniTrendSvg === 'function', '★ miniTrendSvg 已实现（卡片一年迷你走势）');
    eq(w.miniTrendSvg('__none__'), '', '迷你图：无日线 → 返回空串（诚实降级，不编数据）');
    w.G = w.G || {};
    w.G.dayBars = w.G.dayBars || {};
    const rising = [], falling = [];
    for (let i = 0; i < 400; i++) {
      const up = 10 + i * 0.05, dn = 40 - i * 0.05;
      rising.push({ d: 'x', o: up, c: up, h: up + 1, l: up - 1, v: 1 });
      falling.push({ d: 'x', o: dn, c: dn, h: dn + 1, l: dn - 1, v: 1 });
    }
    w.G.dayBars['__up__'] = rising;
    w.G.dayBars['__dn__'] = falling;
    const upSvg = w.miniTrendSvg('__up__'), dnSvg = w.miniTrendSvg('__dn__');
    has(upSvg, '<polyline points=', '迷你图：涨势画出了折线点集');
    eq((upSvg.match(/stroke="#e23a3a"/g) || []).length, 1, '★ 涨势用红色 #e23a3a（A 股红涨绿跌）');
    eq((dnSvg.match(/stroke="#0aa457"/g) || []).length, 1, '★ 跌势用绿色 #0aa457');
    has(upSvg, 'viewBox="0 0 240 40"', '迷你图尺寸 240×40（比 30 更能看出波动）');
    has(upSvg, 'stroke-dasharray="3 3"', '迷你图带起点基准虚线（可判断整段在起点上/下方）');
    has(upSvg, '<polygon points=', '迷你图带面积填充（强化波动轮廓）');
    const upPts = ((upSvg.match(/<polyline points="([^"]+)"/) || [])[1] || '').trim().split(' ').filter(Boolean);
    ok(upPts.length >= 240 && upPts.length <= 250,
      '★ 一年窗口日线「全画」不降采样（实测 ' + upPts.length + ' 点，期望 240~250 —— 抽样会抹平真实波峰波谷）');
    w.G.dayBars['__few__'] = rising.slice(0, 20);
    eq(w.miniTrendSvg('__few__'), '', '迷你图：日线不足 30 根 → 不画');
    delete w.G.dayBars['__up__']; delete w.G.dayBars['__dn__']; delete w.G.dayBars['__few__'];

    /* ③ 首页渲染接线（静态确认，防止以后改首页时被悄悄摘掉） */
    const dashSrc = noCmt(html.slice(html.indexOf('function renderDash(map)')));
    has(dashSrc, 'rows.sort(function(a,b){ var d = dashRowPrio(a) - dashRowPrio(b)',
      '★ renderDash 按 dashRowPrio 排序（跟进类靠前）');
    has(dashSrc, 'return d !== 0 ? d : (a._i - b._i)', '同档用 _i 保序（不依赖 sort 稳定性，测试可复现）');
    has(dashSrc, 'h += miniTrendSvg(hh.code)', '★ 每张持仓卡都渲染迷你走势图');
    has(html, '<span class="pill ev-hot">高位过热 · 重点</span>', '★ 过热行带「高位过热 · 重点」徽章');
    has(html, '.ev-hot{background:#fdf6e3', '徽章样式 .ev-hot 已内嵌（沿用琥珀色系）');
  }

  /* ---------- 2026-09-21 追加：大盘驾驶舱「收盘后立即更新」 ----------
     规格依据：用户「大盘风格驾驶舱的数据要在收盘后立即更新」。
     落地分两头：① 云端 style.js 独立成 style.yml（15:05 快版 + 15:40 定稿），
                   不再挂在 signals.yml 的第 4 步（原来 16:05 才跑、还会被上游失败拖死）；
                ② 控制台把「这份数据到底新不新」摆到明面上 + 支持立即重拉。 */
  {
    const noCmt = (s) => String(s)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /* ① 新鲜度判定（纯函数，不联网） */
    ok(typeof w.styleExpectDate === 'function', '★ styleExpectDate 已实现（算出"现在该有的那份是哪天"）');
    const expectD = w.styleExpectDate();
    ok(/^\d{4}-\d{2}-\d{2}$/.test(expectD), 'styleExpectDate 返回 YYYY-MM-DD（实测 ' + expectD + '）');
    const dw = new Date(expectD + 'T00:00:00Z').getUTCDay();
    ok(dw !== 0 && dw !== 6, '★ 期望日必然是工作日（周六日不会营业，不该拿它当缺更新报警）');

    ok(typeof w.styleFreshHtml === 'function', '★ styleFreshHtml 已实现（新鲜度徽标）');
    has(w.styleFreshHtml({ date: expectD }), '演示数据', '演示态标注来源，不与真实数据混淆');
    const savedDemo = w.DEMO;
    w.DEMO = false;
    has(w.styleFreshHtml({ date: expectD }), '已更新到最新收盘', '★ 日期=期望日 → 已更新到最新收盘');
    has(w.styleFreshHtml({ date: expectD, draft: true }), '收盘快版 · 15:40 定稿覆盖',
      '★ 快版（15:05 那次）如实标注 draft，不当成终值');
    const stale = w.styleFreshHtml({ date: '2026-01-05' });
    has(stale, '云端今日尚未生成', '★ 落后一天以上 → 明确提示未更新');
    has(stale, '2026-01-05', '提示里带上当前这份的日期（知道自己在看哪天）');
    eq(w.styleFreshHtml({}), '', '没有日期 → 不渲染徽标（不编造）');
    w.DEMO = savedDemo;

    /* ② 立即重拉（20s 节流，不能让用户点了就狂刷云端） */
    ok(typeof w.styleHardRefresh === 'function', '★ styleHardRefresh 已实现（绕过 styleEnsure 的一次性幂等）');
    const savedAt = w.STYLE.at, savedLoaded = w.STYLE.loaded, savedData = w.STYLE.data;
    w.STYLE.at = Date.now();
    w.styleHardRefresh(true);
    eq(w.STYLE.loaded, true, '★ 20s 内重复触发被拦下（不重置 loaded、不发请求）');
    w.STYLE.at = savedAt; w.STYLE.loaded = savedLoaded; w.STYLE.data = savedData;

    /* ③ 接线：驾驶舱页真的把新鲜度和按钮渲染出来了 */
    const styBody = d.getElementById('styleBody');
    w.renderStyle();
    has(styBody.innerHTML, 'data-act="styRefresh"', '★ 驾驶舱有「重新拉取」按钮');
    has(styBody.innerHTML, '重新拉取', '按钮文案已上界面');
    const freshSrc = noCmt(html.slice(html.indexOf('function renderStyle()')));
    has(freshSrc, 'styleFreshHtml(st)', '★ renderStyle 渲染新鲜度徽标（不是只在别处算）');
    has(freshSrc, "data-act=\"styRefresh\"", '按钮挂在 renderStyle 产物里（跟着重渲不丢）');

    /* ④ 回到前台自动补拉：只在"该有的没到手 且 已过收盘更新时间"时触发 */
    const visSrc = noCmt(html.slice(html.lastIndexOf("visibilitychange")));
    has(visSrc, 'styleHardRefresh(true)', '★ 回前台时若数据落后，静默补拉一次');
    has(visSrc, '15 * 60 + 13', '★ 收盘更新时间点（15:13）之前不打扰（那时昨天的才是正常的）');
    const hySrc = noCmt((html.match(/function styleHardRefresh\(silent\)\{[\s\S]*?\n\}/) || [''])[0]);
    ok(hySrc.length > 0, '取到 styleHardRefresh 函数体（用于静态校验）');
    has(hySrc, 'STYLE.at = Date.now()', '★ 节流时间戳在开局就记（失败重试也不会狂刷）');

    /* ⑤ 恐贪读数的日期诚实性（fng.js 16:05 才写当天值，驾驶舱 15:05 那版拿到的是昨天的） */
    const savedSD = w.STYLE.data;
    w.STYLE.data = Object.assign({}, savedSD || {}, { date: '2026-09-21', fng: 58, fngDate: '2026-09-18' });
    w.renderStyle();
    has(styBody.innerHTML, '58（09-18）', '★ 恐贪不是当天值时标出它的日期（不把昨天的温度当今天的读数）');
    w.STYLE.data = Object.assign({}, savedSD || {}, { date: '2026-09-21', fng: 58, fngDate: '2026-09-21' });
    w.renderStyle();
    ok(styBody.innerHTML.indexOf('58（') < 0, '恐贪就是当天值 → 不再多标日期（不啰嗦）');
    w.STYLE.data = savedSD;
    w.renderStyle();

    /* ⑥ 取档顺序：不被 CDN 缓存的源必须排在 CDN 之前（2026-09-21 实测：
       jsDelivr 的 gh 缓存滞后可达数天，改完后它还端着 09-19 的旧档，真实已是 09-21） */
    const sfr = noCmt((html.match(/async function styleFetchRaw\(\)\{[\s\S]*?\n\}/) || [''])[0]);
    ok(sfr.length > 0, '取到 styleFetchRaw 函数体（用于静态校验取档顺序）');
    const iAnon = sfr.indexOf('contents/style-history.json?ref=main');
    const iCdn = sfr.indexOf('cdn.jsdelivr.net');
    ok(iAnon > 0 && iCdn > iAnon,
      '★ 匿名 API（不进 CDN、永远最新）排在 jsDelivr 之前 —— 只看顺序不信CDN 的自觉');
    has(sfr, "api.github.com/repos/'", '取档尽力走 GitHub API（带 token 时更稳，匿名也能用）');
  }

  /* ---------- 汇总 ---------- */
  console.log('持仓账本 DOM 测试：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('ALL GREEN');
  process.exit(0);
})().catch(e => { console.log('测试崩溃：' + (e && e.stack || e)); process.exit(1); });
