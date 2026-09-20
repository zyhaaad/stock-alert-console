/* 导出「恐贪页」实际渲染快照（含本轮三项优化）
 * 用 jsdom 真跑 console.html 的脚本（demo 模式 + 回放真实存档），
 * 导出两块：
 *   ① 首页顶部（放进可滚动框架里，用来演示"入口卡吸顶、不随股票列表滚走"）
 *   ② 恐贪详情页（含分阶段操作建议 + 曲线游标读数）
 * 运行：node _tests/fng-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM } = require(path.join(WS, 'jsdom'));

const SRC = 'D:/mywork/stock-alert-console/console.html';
const ARCH_FILE = 'D:/mywork/stock-alert-cloud/fng-history.json';
const OUT = 'D:/mywork/_preview/fng-page-render.html';
const html = fs.readFileSync(SRC, 'utf8');

(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/console.html?demo=1'
  });
  const w = dom.window, d = w.document;

  // 让"演示数据"这一层直接回放真实存档（750 个交易日），快照即真实口径
  const ARCH = JSON.parse(fs.readFileSync(ARCH_FILE, 'utf8'));
  w.fngDemoHistory = function () {
    return {
      days: ARCH.days.map(function (r) { return { d: r[0], v: r[1] }; }),
      raws: ARCH.days.map(function (r) { return { mom: r[2], vol: r[3], vlm: r[4], mgn: r[5], mbs: r[6] }; }),
      margin: ARCH.margin
    };
  };

  await new Promise(r => setTimeout(r, 900));

  // 数据已是真实存档，去掉"演示模式"横幅以免误导
  const df = d.getElementById('demoflag');
  if (df) df.remove();

  // 先截首页（含吸顶入口卡）
  const home = d.querySelector('.wrap');
  const homeHtml = home ? home.outerHTML : '<div class="hint">未找到首页容器</div>';

  // 打开详情页
  const entry = d.getElementById('fngEntry');
  if (entry) entry.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));

  const page = d.getElementById('pgFng');
  if (!page) { console.error('未找到 #pgFng'); process.exit(1); }

  // 在曲线上定位到一个历年节点，展示滑动读数
  const view = w.FNG.view || [];
  let cursorNote = '（曲线点数不足，未演示滑动）';
  if (view.length > 10) {
    const k = Math.floor(view.length * 0.72);
    w.fngSetCursor(k);
    cursorNote = '游标停在 ' + view[k].d + ' = ' + view[k].v.toFixed(1);
  }

  // 收集控制台样式
  let css = '';
  d.querySelectorAll('style').forEach(s => { css += s.textContent + '\n'; });

  const big = d.getElementById('fngBig') ? d.getElementById('fngBig').textContent : '';
  const zone = d.getElementById('fngZone') ? d.getElementById('fngZone').textContent : '';
  const advTitle = d.getElementById('fngAdvTitle') ? d.getElementById('fngAdvTitle').textContent : '';
  const advN = d.getElementById('fngAdvDo') ? d.getElementById('fngAdvDo').querySelectorAll('li').length : 0;
  const advD = d.getElementById('fngAdvDont') ? d.getElementById('fngAdvDont').querySelectorAll('li').length : 0;
  const cursor = d.getElementById('fngCursor') ? d.getElementById('fngCursor').innerHTML.indexOf('<line') >= 0 : false;
  const rd = d.getElementById('fngRead') ? d.getElementById('fngRead').textContent : '';
  const stickyOn = d.getElementById('fngSticky') && d.getElementById('fngSticky').className.indexOf('on') >= 0;
  const last = ARCH.days[ARCH.days.length - 1];

  const out = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>恐贪情绪指数 · 实际渲染快照</title>
<style>${css}
/* ---- 快照外壳（仅用于展示，不属于控制台） ---- */
body{margin:0;padding:24px;background:#eef1f5;display:flex;flex-direction:column;align-items:center;gap:18px;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
.snapbar{font:13px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;color:#3c4149;max-width:400px;}
.snapbar b{color:#111;font-size:14px}
.snapbar code{background:#fff;padding:1px 5px;border-radius:5px;border:1px solid #dde1e7;font-size:12px}
.snapwrap{width:390px;background:#f4f4f6;border-radius:22px;box-shadow:0 10px 34px rgba(20,28,42,.14);overflow:hidden;}
.snapframe{width:390px;height:430px;overflow:auto;background:#f4f4f6;border-radius:22px;
  box-shadow:0 10px 34px rgba(20,28,42,.14);position:relative;}
.snapframe .wrap{padding-top:14px;}
.snaptip{font-size:11px;color:#8b9096;text-align:center;max-width:390px;line-height:1.6}
.snapchk{font:11px/1.8 system-ui,sans-serif;color:#6d7278;background:#fff;border:1px solid #e3e6ea;
  border-radius:12px;padding:10px 14px;max-width:390px;}
.snapchk b{color:#23262b}
</style></head>
<body>

<div class="snapbar">
  <b>① 首页顶部 · 入口卡吸顶</b><br>
  下面这个框是可以滚动的：往下滚股票列表，恐贪入口卡会钉在顶部，不跟着滚走。
  <span class="snapchk" style="display:inline-block;margin-top:6px;">吸顶状态：<b>${stickyOn ? '已开启（class 含 on）' : '未开启（无数据）'}</b></span>
</div>
<div class="snapframe">
${homeHtml}
</div>
<div class="snaptip">↑ 在这个框里滚动试试：入口卡停住，列表从下方滑过</div>

<div class="snapbar" style="margin-top:10px;">
  <b>② 恐贪详情页 · 操作建议 + 曲线滑动</b><br>
  数据来源：<code>fng-history.json</code> 真实存档（750 个交易日，截至 ${last[0]}）。
  本文件由 jsdom 真跑 <code>console.html</code> 脚本后导出，非手工绘制。
</div>
<div class="snapwrap">
${page.outerHTML}
</div>
<div class="snapchk">
  快照自检：当前值 <b>${big}</b> · 状态 <b>${zone}</b> ·
  建议卡标题 <b>${advTitle.replace(/\s+/g, ' ').trim()}</b>（该做 ${advN} 条 / 别做 ${advD} 条）·
  曲线游标 <b>${cursor ? '已绘制' : '未绘制'}</b> · 读数条 <b>${rd.replace(/\s+/g, ' ').trim() || '—'}</b>（${cursorNote}）
</div>

</body></html>`;

  fs.writeFileSync(OUT, out);
  console.log('已写出：' + OUT + '  ' + Math.round(out.length / 1024) + ' KB');
  console.log('  当前值 ' + big + ' · ' + zone + ' · 吸顶' + (stickyOn ? '已开启' : '未开启'));
  console.log('  建议卡：' + advTitle.replace(/\s+/g, ' ').trim() + '（该做 ' + advN + ' / 别做 ' + advD + '）');
  console.log('  游标：' + (cursor ? '已绘制' : '未绘制') + ' · ' + cursorNote);
  process.exit(0);
})();
