/* 恐贪存档 · 备源顺序与超时 专项测试
 * 背景：用户所在网络 raw.githubusercontent.com 为"黑洞"（连接既不成功也不拒绝，curl 卡满 20s）。
 *       若把它排在可达的 jsDelivr 之前、且不加超时，恐贪页会被拖住很久。
 * 验证：① 源码里 jsDelivr 在 raw 之前；② 真有 AbortController 超时；③ 真跑一遍：jsDelivr 先成功则不再请求 raw。
 * 运行：node _tests/fng-fallback-test.js
 */
const fs = require('fs');
const path = require('path');

const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
let JSDOM;
try { JSDOM = require(path.join(WS, 'jsdom')).JSDOM; }
catch (e) { console.log('SKIP：未安装 jsdom（' + e.message + '）'); process.exit(0); }

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }

const SRC = 'D:/mywork/stock-alert-console/console.html';
const html = fs.readFileSync(SRC, 'utf8');

/* ---------- A. 结构性检查 ---------- */
ok(/AbortController/.test(html), 'A1 源码引入 AbortController（超时能力）');
ok(/function\s+fngFetch\s*\(/.test(html), 'A2 存在带超时的 fngFetch 包装');

{
  const i = html.indexOf('async function fngLoadRaw');
  const body = html.slice(i, i + 2400);
  const iJsd = body.indexOf('cdn.jsdelivr.net');
  const iRaw = body.indexOf('raw.githubusercontent.com');
  ok(iJsd > 0, 'A3 fngLoadRaw 内出现 jsDelivr 备源');
  ok(iRaw > 0, 'A4 fngLoadRaw 内出现 raw 备源');
  ok(iJsd < iRaw, 'A5 备源顺序：jsDelivr 在 raw 之前（本网络 raw 不可达）');
  ok(/fngFetch\(urls\[i\]/.test(body) || /await fngFetch\(/.test(body), 'A6 备源抓取统一走 fngFetch（有超时）');
}

/* ---------- B/C. 行为级：真跑 console.html 的 fngLoadRaw ---------- */
const ARCHIVE = {
  updated: '2026-09-16T09:32:40Z',
  days: [['2026-09-14', 28.4, 10, 20, 30, 40, 50], ['2026-09-15', 29.1, 11, 21, 31, 41, 51], ['2026-09-16', 30.5, 12, 22, 32, 42, 52]],
  margin: { d: '2026-09-15', rzye: 2598300000000, rzjme: 1000000, ltsz: 90000000000000 }
};

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://stock-alert-console.app.workbuddy.host/' });
  const w = dom.window;
  w.localStorage.setItem('sa_owner', 'zyhaaad');
  w.localStorage.setItem('sa_repo', 'stock-alert');
  w.localStorage.removeItem('sa_token');

  const called = [];
  let sawSignal = null;
  w.fetch = function (url, opt) {
    const u = String(url);
    called.push(u.indexOf('api.github.com') >= 0 ? 'api' : u.indexOf('jsdelivr') >= 0 ? 'jsdelivr' : u.indexOf('raw.github') >= 0 ? 'raw' : 'other');
    if (opt && opt.signal) sawSignal = opt.signal;
    if (u.indexOf('jsdelivr') >= 0) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(ARCHIVE); } });
    }
    // raw（或其它的）：模拟黑洞——永不 resolve，但尊重 abort
    return new Promise(function (resolve, reject) {
      if (opt && opt.signal) opt.signal.addEventListener('abort', function () {
        const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e);
      });
    });
  };

  let got = null, err = null;
  try { got = await w.fngLoadRaw(); } catch (e) { err = e; }

  ok(!err, 'B1 有可达备源时不报错' + (err ? ' — ' + err.message : ''));
  ok(!!got && Array.isArray(got.days) && got.days.length === 3, 'B2 成功解析到存档（3 天）');
  ok(called.indexOf('jsdelivr') >= 0, 'B3 请求了 jsDelivr');
  ok(called.indexOf('raw') < 0, 'B4 jsDelivr 成功后不再请求黑洞的 raw（不被拖住）');
  ok(sawSignal && typeof sawSignal.aborted === 'boolean', 'B5 抓取带 AbortSignal（超时插头已接）');

  // 兜底：全部不可达时应"快速失败"而不是永久挂起（api 无 token 被跳过 → jsdelivr 8s 超时 → raw 8s 超时）
  let t0 = Date.now(), rejected = null;
  w.fetch = function (url, opt) {
    return new Promise(function (resolve, reject) {
      if (opt && opt.signal) opt.signal.addEventListener('abort', function () {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    });
  };
  try { await w.fngLoadRaw(); } catch (e) { rejected = e; }
  const dt = Date.now() - t0;
  ok(!!rejected, 'C1 全部不可达时给出错误（而不是永久挂起）');
  ok(dt < 20000, 'C2 失败耗时有上限（' + (dt / 1000).toFixed(1) + 's < 20s，超时生效）');
  ok(rejected && /超时/.test(rejected.message), 'C3 错误信息标注"超时"');

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})();
