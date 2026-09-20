/* 恐贪页 UX 三项优化 · 专项测试
 *  ① 首屏入口卡吸顶（不随股票监控列表滚走）
 *  ② 按当前情绪阶段给出可执行建议 + 后续走势预判（拒绝「观望为主」式空话）
 *  ③ 走势图左右滑动查看任意交易日节点（日期 + 数值）
 * 运行：node _tests/fng-ux-test.js
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
let JSDOM;
try { JSDOM = require(path.join(WS, 'jsdom')).JSDOM; }
catch (e) { console.log('SKIP：未安装 jsdom（' + e.message + '）'); process.exit(0); }

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { c ? pass++ : (fail++, fails.push(n)); };

const SRC = 'D:/mywork/stock-alert-console/console.html';
const html = fs.readFileSync(SRC, 'utf8');

/** 去掉注释后再做文案检查 —— 否则会命中我们自己的"禁止出现×"说明性注释 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */ 与 /** ... */
    .replace(/<!--[\s\S]*?-->/g, '');   // HTML 注释
}
const code = stripComments(html);

/* ================= A. 静态结构 ================= */
ok(/id="fngSticky"/.test(html), 'A1 存在吸顶容器 #fngSticky');
ok(/\.fg-sticky\.on\{[^}]*position:sticky/.test(html), 'A2 吸顶样式使用 position:sticky');
ok(/\.fg-sticky\.on\{[^}]*top:0/.test(html), 'A3 吸顶在 top:0');
{
  const iE = html.indexOf('id="fngSticky"'), iC = html.indexOf('id="fngEntry"'), iL = html.indexOf('id="list"');
  ok(iE > 0 && iC > iE && iL > iC, 'A4 入口卡在吸顶容器内，且整体位于股票列表之前');
  const m = html.match(/\.fg-sticky\.on\{[^}]*z-index:(\d+)/);
  ok(m && Number(m[1]) <= 10, 'A5 吸顶层级低于页面/弹层（z-index=' + (m ? m[1] : '?') + '）');
}
ok(/id="fngAdvCard"/.test(html), 'A6 存在操作建议卡');
ok(/id="fngAdvDo"/.test(html) && /id="fngAdvDont"/.test(html), 'A7 有「该做的 / 别做的」容器');
ok(!/观望为主/.test(code), 'A8 实际文案不含「观望为主」这类放之四海皆准的空话');
{
  const iAdv = html.indexOf('id="fngAdvCard"'), iChart = html.indexOf('id="fngChart"');
  ok(iAdv > 0 && iAdv < iChart, 'A9 建议卡位于走势图上方（先给结论，再看图）');
}
ok(/touch-action:pan-y/.test(html), 'A10 曲线设置 touch-action:pan-y（纵滑仍可翻页）');

/* ================= B/C. 行为级 ================= */
(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/console.html?demo=1'
  });
  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 900));

  /* ---------- ① 吸顶 ---------- */
  ok(!!d.getElementById('fngEntry'), 'B1 入口卡已渲染');
  ok(d.getElementById('fngSticky').className.indexOf('on') >= 0, 'B2 有数据时吸顶容器开启（class 含 on）');

  /* ---------- 打开详情页 ---------- */
  d.getElementById('fngEntry').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  ok(d.getElementById('pgFng').classList.contains('on'), 'B3 详情页已打开');

  /* ---------- ② 分阶段建议 ---------- */
  const SAMPLES = [12, 30, 50, 68, 88];
  const zoneName = [], views = [], combos = [];
  SAMPLES.forEach((v, k) => {
    w.fngRenderAdvice(v);
    const title = d.getElementById('fngAdvTitle').textContent;
    const view = d.getElementById('fngAdvView').textContent;
    const doN = d.getElementById('fngAdvDo').querySelectorAll('li').length;
    const dnN = d.getElementById('fngAdvDont').querySelectorAll('li').length;
    zoneName.push(title); views.push(view);
    combos.push(d.getElementById('fngAdvDo').textContent + '||' + d.getElementById('fngAdvDont').textContent);
    ok(doN >= 1 && dnN >= 1, 'C' + (k + 1) + ' 分值为 ' + v + ' 时，「该做/别做」各至少 1 条（' + doN + '/' + dnN + '）');
    ok(view.length >= 40, 'C' + (k + 1) + 'b 分值为 ' + v + ' 时有实质走势预判（' + view.length + ' 字）');
    ok(/%/.test(d.getElementById('fngAdvEv').textContent), 'C' + (k + 1) + 'c 附历史实证数据');
  });
  ok(new Set(views).size === 5, 'D1 五个阶段的走势预判互不相同（' + new Set(views).size + '/5）');
  ok(new Set(combos).size === 5, 'D2 五个阶段的「该做/别做」互不相同（' + new Set(combos).size + '/5）');
  ok(new Set(zoneName).size === 5, 'D3 五个阶段的阶段名互不相同');

  // 低位：必须点明"不要割肉" + 给出分批做法
  w.fngRenderAdvice(12);
  ok(/割肉/.test(d.getElementById('fngAdvDont').textContent), 'E1 极度恐惧时明确提示「不要割肉」');
  ok(/分批|分成/.test(d.getElementById('fngAdvDo').textContent), 'E2 极度恐惧时给出「分批建仓」的具体做法');
  ok(/回暖|最低|最冷/.test(d.getElementById('fngAdvView').textContent), 'E3 极度恐惧时点明「离回暖最近」');
  // 高位：必须点明"不要追高" + 给出减仓
  w.fngRenderAdvice(88);
  ok(/追高/.test(d.getElementById('fngAdvDont').textContent), 'E4 极度贪婪时明确提示「不要追高」');
  ok(/减仓|止盈|兑现/.test(d.getElementById('fngAdvDo').textContent), 'E5 极度贪婪时给出「减仓/止盈」做法');
  // 中性不装专家
  w.fngRenderAdvice(50);
  ok(/接近随机|不提供方向|选股/.test(d.getElementById('fngAdvView').textContent + d.getElementById('fngAdvDo').textContent), 'E6 中性阶段承认情绪无方向，不硬给信号');

  // 恢复到当前真实分值的建议
  w.fngRender();
  ok(/现在该怎么做/.test(d.getElementById('fngAdvTitle').textContent), 'E7 重渲染后建议卡回到当前分值的建议');

  /* ---------- ③ 曲线滑动 ---------- */
  const ch = d.getElementById('fngChart');
  ok(!!d.getElementById('fngCursor'), 'F1 曲线内存在游标图层 #fngCursor');
  ch.getBoundingClientRect = function () { return { left: 0, top: 0, width: 320, height: 170, right: 320, bottom: 170 }; };
  const view = w.FNG.view;
  ok(view && view.length > 1, 'F2 图表视图已缓存（' + (view ? view.length : 0) + ' 点）');

  const rd = d.getElementById('fngRead');
  const md = x => ch.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, clientX: x }));
  md(0);
  ok(rd.className.indexOf('on') >= 0, 'F3 按压曲线后读数条出现');
  ok(rd.textContent.indexOf(view[0].d) > -1, 'F4 最左侧显示首个交易日 ' + view[0].d);
  ok(rd.textContent.indexOf(view[0].v.toFixed(1)) > -1, 'F5 显示该日数值 ' + view[0].v.toFixed(1));

  md(319);
  ok(rd.textContent.indexOf(view[view.length - 1].d) > -1, 'F6 最右侧显示最新交易日 ' + view[view.length - 1].d);
  ok(/最新/.test(rd.textContent), 'F7 最右节点标注「最新」');

  const cur = d.getElementById('fngCursor').innerHTML;
  ok(cur.indexOf('<line') >= 0, 'F8 绘制了竖直指示线');
  ok(cur.indexOf('circle') >= 0, 'F9 绘制了节点圆点');
  ok(cur.indexOf(view[view.length - 1].d.slice(5)) >= 0, 'F10 图上标签带日期');

  const mid = Math.floor((view.length - 1) / 2);
  w.fngSetCursor(mid);
  ok(w.FNG.ci === mid, 'F11 定位到中间节点索引正确');
  ok(rd.textContent.indexOf(view[mid].v.toFixed(1)) > -1, 'F12 中间节点数值与数据一致');

  w.fngSetCursor(-5); ok(w.FNG.ci === 0, 'F13 左越界钳制到 0');
  w.fngSetCursor(9999); ok(w.FNG.ci === view.length - 1, 'F14 右越界钳制到末位');

  // 触摸：纵向滑动不抢页面滚动
  const tev = (type, x, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.touches = [{ clientX: x, clientY: y }]; return e; };
  w.fngClearCursor();
  ok(w.FNG.ci === null, 'F15 游标可清除');
  ch.dispatchEvent(tev('touchstart', 160, 100));
  ch.dispatchEvent(tev('touchmove', 162, 180));
  ok(w.FNG.ci === null, 'F16 纵向滑动不触发节点定位（交还页面滚动）');
  // 触摸：横向滑动定位
  ch.dispatchEvent(tev('touchstart', 60, 100));
  ch.dispatchEvent(tev('touchmove', 300, 102));
  ok(w.FNG.ci != null && w.FNG.ci > 0, 'F17 横向滑动可定位到右侧节点');
  ok(rd.className.indexOf('on') >= 0, 'F18 横滑时读数条可见');

  // 切换周期 → 游标与读数复位
  w.fngSetPeriod('7d');
  ok(w.FNG.view.length === 7, 'F19 切到 7 天：视图 7 点');
  ok(w.FNG.ci === null, 'F20 切换周期后游标复位');
  ok(rd.className.indexOf('on') < 0, 'F21 切换周期后读数条隐藏');
  w.fngSetPeriod('2y');
  ok(w.FNG.view.length === 420, 'F22 切到 2 年：视图 420 点');

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})();
