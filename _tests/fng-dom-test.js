/* 控制台恐贪页 · DOM 级功能测试（私有）
 * 用 jsdom 真跑 console.html 的脚本，验证渲染链路真的能出东西。
 * 运行：node _tests/fng-dom-test.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

// 让 require('jsdom') 找到受管工作区
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);

let JSDOM, VirtualConsole;
try {
  JSDOM = require(path.join(WS, 'jsdom')).JSDOM;
  VirtualConsole = require(path.join(WS, 'jsdom')).VirtualConsole;
} catch (e) {
  console.log('SKIP：未安装 jsdom（' + e.message + '）');
  process.exit(0);
}

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name) } }

const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html';
const html = fs.readFileSync(PREVIEW, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/',
    virtualConsole: vc
  });
  const w = dom.window, d = w.document;

  ok(!!w.__FORCE_DEMO__, '预览页已强制演示模式（不联网）');

  // 等异步 boot 完成
  await new Promise(r => setTimeout(r, 600));

  ok(errors.length === 0, '脚本执行期无报错' + (errors.length ? ' — ' + errors[0] : ''));

  /* ---------- 首屏入口卡 ---------- */
  const entry = d.getElementById('fngEntry');
  ok(!!entry, '存在首屏恐贪入口卡');
  ok(entry.className.indexOf('on') >= 0, '入口卡已显示（有数据）');
  const eval0 = d.getElementById('fngEntryVal').textContent;
  ok(/^\d+(\.\d)?$/.test(eval0), '入口卡数值是数字（' + eval0 + '）');
  ok(parseFloat(eval0) >= 0 && parseFloat(eval0) <= 100, '入口卡数值在 0-100');
  ok(/贪婪|恐惧|中性/.test(d.getElementById('fngEntryZone').textContent), '入口卡有情绪状态文案');
  const spark = d.getElementById('fngEntrySpark').querySelector('svg polyline');
  ok(!!spark, '入口卡迷你曲线已绘制');

  /* ---------- 打开详情页 ---------- */
  entry.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const page = d.getElementById('pgFng');
  ok(page.classList.contains('on'), '点击入口卡打开恐贪详情页');

  const gaugePaths = d.getElementById('fngGauge').querySelectorAll('path');
  ok(gaugePaths.length === 2, '仪表盘绘制了底弧 + 数值弧（实际 ' + gaugePaths.length + ' 条）');
  const dash = gaugePaths[1] && gaugePaths[1].getAttribute('stroke-dasharray');
  ok(!!dash, '数值弧带 stroke-dasharray（按分值取弧长）');
  const ticks = d.getElementById('fngGauge').querySelectorAll('line');
  ok(ticks.length >= 3, '仪表盘有刻度线（' + ticks.length + ' 条）');

  const big = d.getElementById('fngBig').textContent;
  ok(/^\d+(\.\d)?$/.test(big), '大字数值正常（' + big + '）');
  ok(d.getElementById('fngBig').style.color !== '', '大字按情绪分区着色');
  ok(/贪婪|恐惧|中性/.test(d.getElementById('fngZone').textContent), '状态标签正常');
  ok(d.getElementById('fngSub').textContent.length > 4, '有辅助说明文案');

  /* ---------- 曲线与周期切换 ---------- */
  const tabs = d.getElementById('fngTabs').querySelectorAll('.tab');
  ok(tabs.length === 7, '周期切换 7 个档位（实际 ' + tabs.length + '）');
  const tabNames = Array.prototype.map.call(tabs, t => t.textContent).join('/');
  ok(tabNames === '7天/30天/90天/6个月/1年/2年/全部', '周期档位名称正确：' + tabNames);
  ok(d.getElementById('fngTabs').querySelectorAll('.tab.on').length === 1, '默认只有 1 个档位选中');

  ok(!!d.getElementById('fngChart').querySelector('polyline'), '走势折线已绘制');
  ok(d.getElementById('fngChart').querySelectorAll('rect').length === 2, '走势图有贪婪/恐惧两条分区色带');
  ok(d.getElementById('fngRange').textContent.indexOf('个交易日') > 0, '显示区间与交易日数量：' + d.getElementById('fngRange').textContent);

  function ptCount() {
    const pl = d.getElementById('fngChart').querySelector('polyline');
    if (!pl) return 0;
    return pl.getAttribute('points').trim().split(/\s+/).length;
  }
  const cntAll = ptCount();
  ok(cntAll === 90, '默认「90天」档位 90 个点（实际 ' + cntAll + '）');
  ok(/^\d\d-\d\d ~ \d\d-\d\d/.test(d.getElementById('fngRange').textContent.trim()), '区间文案是 MM-DD 格式：' + d.getElementById('fngRange').textContent.trim());
  // 切到 7 天
  function clickTab(name) {
    const t = Array.prototype.filter.call(d.getElementById('fngTabs').querySelectorAll('.tab'), x => x.textContent === name)[0];
    t.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }
  clickTab('7天');
  await new Promise(r => setTimeout(r, 120));
  const cnt7 = ptCount();
  ok(cnt7 === 7, '切到「7天」后折线正好 7 个点（实际 ' + cnt7 + '）');
  clickTab('1年');
  await new Promise(r => setTimeout(r, 120));
  ok(ptCount() === 252, '「1年」= 252 个点（实际 ' + ptCount() + '）');
  clickTab('2年');
  await new Promise(r => setTimeout(r, 120));
  ok(ptCount() === 420, '「2年」= 存档全部 420 个点（演示数据不足 2 年，实际 ' + ptCount() + '）');
  clickTab('全部');
  await new Promise(r => setTimeout(r, 120));
  const cntAll2 = ptCount();
  ok(cntAll2 === 420, '「全部」= 420 个点（实际 ' + cntAll2 + '）');
  ok(cntAll2 > cnt7, '长周期点数确实多于短周期（' + cntAll2 + ' > ' + cnt7 + '）');
  ok(d.getElementById('fngTabs').querySelectorAll('.tab.on').length === 1, '切档后仍只有 1 个选中');

  /* ---------- 统计与分项 ---------- */
  const stats = d.getElementById('fngStats').querySelectorAll('.s');
  ok(stats.length === 3, '区间统计 3 项（最高/最低/均值）');
  const maxV = parseFloat(stats[0].querySelector('.vv').textContent);
  const minV = parseFloat(stats[1].querySelector('.vv').textContent);
  ok(maxV >= minV, '区间最高 ≥ 最低（' + maxV + ' / ' + minV + '）');

  const parts = d.getElementById('fngParts').querySelectorAll('.fg-part');
  ok(parts.length === 5, '分项拆解 5 项（实际 ' + parts.length + '）');
  let partsOk = true, wsum = 0;
  for (const p of parts) {
    const score = p.querySelector('.ph .v').textContent;
    if (!/^\d+(\.\d)?$/.test(score)) partsOk = false;
    if (parseFloat(score) < 0 || parseFloat(score) > 100) partsOk = false;
    const bar = p.querySelector('.fg-track i');
    if (!bar || !bar.style.width) partsOk = false;
    const wm = /(\d+)%/.exec(p.querySelector('.ph .w').textContent);
    if (wm) wsum += parseInt(wm[1], 10);
  }
  ok(partsOk, '5 个分项：得分是 0-100、进度条有宽度');
  ok(wsum === 100, '分项权重合计 100%（实际 ' + wsum + '%）');
  ok(d.getElementById('fngAsOf').textContent.indexOf('口径') > 0, '标注了实时/收盘口径与两融日期');

  const names = Array.prototype.map.call(parts, p => p.querySelector('.ph .kk').textContent).join(',');
  ok(/趋势动量/.test(names) && /波动率/.test(names) && /量能/.test(names) && /融资/.test(names), '分项名称齐全：' + names);
  ok(/反向计分/.test(d.getElementById('fngParts').textContent), '波动率标注了反向计分');

  /* ---------- 涨跌家数与说明 ---------- */
  ok(d.getElementById('fngBreadth').innerHTML.length > 10, '盘面宽度区块有内容');
  ok(/不计入指数/.test(d.body.textContent), '明确说明涨跌家数不计入指数');
  const src = d.getElementById('fngSrc').textContent;
  ok(/252/.test(src), '说明里写清了 252 日百分位窗口');
  ok(/永久不变|不再变|不会漂移/.test(src), '说明里写清了存档不可变');
  ok(/北向/.test(src), '说明里交代了北向资金为何未纳入');

  /* ---------- 更多面板入口 ---------- */
  ok(!!d.getElementById('rowFng'), '更多面板里有恐贪指数入口');
  ok(d.getElementById('fngCnt').textContent.length > 0, '更多面板入口显示当前数值');
  d.getElementById('btnMore').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  ok(d.getElementById('sheetMore').classList.contains('on'), '更多面板可打开');
  d.getElementById('rowFng').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok(d.getElementById('pgFng').classList.contains('on'), '从更多面板也能进入恐贪页');
  ok(!d.getElementById('sheetMore').classList.contains('on'), '进入后更多面板自动收起');

  /* ---------- 既有功能未被破坏 ---------- */
  ok(d.getElementById('list').children.length > 0, '股票列表仍然渲染');
  ok(!!d.getElementById('fabAdd'), '添加按钮仍在');
  d.getElementById('fabAdd').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  ok(d.getElementById('pgAdd').classList.contains('on'), '添加股票页仍可打开');

  ok(errors.length === 0, '全程无脚本报错' + (errors.length ? ' — ' + errors[0] : ''));

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  ✗ ' + f)) }
  console.log(fail ? '\n结果：FAILED' : '\n结果：ALL GREEN');
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
