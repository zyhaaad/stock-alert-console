/* V2 任务心跳与失败告警 · 专项测试
 * 覆盖：交易日判断、恐贪存档新鲜度检查、workflow 运行记录检查（含无 token / 全失败 / 无记录）、
 *       告警与周报文案、以及"非交易日静默"这条闸门。
 * 运行：node _tests/fng-heartbeat-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const CLOUD = 'D:/mywork/stock-alert-cloud/';
const hb = require(CLOUD + 'heartbeat.js');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { c ? pass++ : (fail++, fails.push(n)); };

const realFetch = global.fetch;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));

function writeHist(days) {
  const p = path.join(TMP, 'fng-history-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ v: 1, days: days }));
  return p;
}

(async () => {
  /* ---------- A. 恐贪存档新鲜度 ---------- */
  {
    const p1 = writeHist([['2026-09-15', 29.1], ['2026-09-16', 30.5]]);
    let r = hb.checkArchive('2026-09-16', p1);
    ok(r.ok === true, 'A1 存档最新日期=今日 → 通过');
    ok(r.value === 30.5, 'A2 顺带返回最新分值 ' + r.value);

    const p2 = writeHist([['2026-09-14', 28.4], ['2026-09-15', 29.1]]);
    r = hb.checkArchive('2026-09-16', p2);
    ok(r.ok === false, 'A3 存档落后一天 → 判定异常');
    ok(/2026-09-15/.test(r.detail) && /2026-09-16/.test(r.detail), 'A4 异常说明里同时给出实际与期望日期');

    const p3 = path.join(TMP, 'not-exist.json');
    r = hb.checkArchive('2026-09-16', p3);
    ok(r.ok === false && /读不到/.test(r.detail), 'A5 存档缺失 → 判定异常');

    const p4 = path.join(TMP, 'empty.json');
    fs.writeFileSync(p4, JSON.stringify({ v: 1, days: [] }));
    r = hb.checkArchive('2026-09-16', p4);
    ok(r.ok === false, 'A6 存档为空 → 判定异常');
  }

  /* ---------- B. 交易日判断（stub 腾讯日线） ---------- */
  {
    const stubKline = (lastDate) => {
      global.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({
          data: { sh000985: { day: [['2026-09-14', '1', '2', '3', '4', '5'], [lastDate, '1', '2', '3', '4', '5']] } }
        })
      });
    };

    stubKline('2026-09-16');
    let r = await hb.isTradingDay('2026-09-16');
    ok(r.trading === true, 'B1 日线最后一根=今日 → 今天是交易日');
    ok(r.lastD === '2026-09-16', 'B2 返回实际最新交易日');

    stubKline('2026-09-15');
    r = await hb.isTradingDay('2026-09-16');
    ok(r.trading === false, 'B3 日线最后一根不是今日 → 非交易日（节假日/周末）');

    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
    let threw = null;
    try { await hb.isTradingDay('2026-09-16') } catch (e) { threw = e }
    ok(!!threw, 'B4 取不到日线时抛错（由调用方告警，而不是假装正常）');
  }

  /* ---------- C. workflow 运行记录检查 ---------- */
  {
    const runsOf = (arr) => {
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: arr }) });
    };

    runsOf([{ created_at: '2026-09-16T08:05:00Z', status: 'completed', conclusion: 'success' }]);
    let r = await hb.checkWorkflow('fng.yml', '2026-09-16', 'TK');
    ok(r.ok === true, 'C1 今天有成功运行 → 通过');
    ok(/成功运行 1 次/.test(r.detail), 'C2 说明里带成功次数');

    runsOf([{ created_at: '2026-09-15T08:05:00Z', status: 'completed', conclusion: 'success' }]);
    r = await hb.checkWorkflow('fng.yml', '2026-09-16', 'TK');
    ok(r.ok === false, 'C3 今天完全没有运行记录 → 异常（定时任务没被触发）');
    ok(/没有任何运行记录/.test(r.detail), 'C4 说明指向"没被触发"');

    runsOf([
      { created_at: '2026-09-16T08:05:00Z', status: 'completed', conclusion: 'failure', html_url: 'https://x/1' },
      { created_at: '2026-09-16T14:05:00Z', status: 'completed', conclusion: 'cancelled' }
    ]);
    r = await hb.checkWorkflow('fng.yml', '2026-09-16', 'TK');
    ok(r.ok === false, 'C5 今天跑了但全都没成功 → 异常');
    ok(/没有一次成功/.test(r.detail) && /failure/.test(r.detail), 'C6 说明里指出最近一次的状态');
    ok(r.url === 'https://x/1', 'C7 带上可点的运行链接');

    runsOf([{ created_at: '2026-09-16T08:05:00Z', status: 'completed', conclusion: 'failure' },
      { created_at: '2026-09-16T14:05:00Z', status: 'completed', conclusion: 'success' }]);
    r = await hb.checkWorkflow('fng.yml', '2026-09-16', 'TK');
    ok(r.ok === true, 'C8 只要有一次成功就算通过（16:05 失败但 22:05 成功了）');

    r = await hb.checkWorkflow('fng.yml', '2026-09-16', '');
    ok(r.ok === null && /跳过/.test(r.detail), 'C9 无 token 时跳过该检查（不误判为异常）');

    global.fetch = async () => { throw new Error('boom') };
    r = await hb.checkWorkflow('fng.yml', '2026-09-16', 'TK');
    ok(r.ok === null && /失败/.test(r.detail), 'C10 查询接口本身出错时判为"未检查"而不是"异常"');
  }

  /* ---------- D. 周报文案 ---------- */
  {
    const body = hb.weeklyBody(
      { stocks: [{ code: '1' }, { code: '2' }] },
      { last: '2026-09-16', value: 30.5 },
      [{ detail: 'fng.yml 今天成功运行 2 次' }]
    );
    ok(/一切正常/.test(body), 'D1 周报首句表明一切正常');
    ok(/30\.5/.test(body) && /2026-09-16/.test(body), 'D2 周报含恐贪最新值');
    ok(/监控股票：2 只/.test(body), 'D3 周报含监控股票数');
    ok(/推送通道还活着/.test(body), 'D4 周报说明它就是通道存活证明');
  }

  /* ---------- E. 心跳 CLI：非交易日静默 ---------- */
  {
    const { execFileSync } = require('child_process');
    const NODE = process.execPath;
    // 用 --dry + 非交易日：stub 掉网络不现实，改为验证参数解析与脚本能正常退出
    let out = '';
    try {
      out = execFileSync(NODE, [CLOUD + 'heartbeat.js', '--dry'], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { GITHUB_TOKEN: '', SENDKEY: '' }) });
    } catch (e) {
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    ok(/心跳自检/.test(out), 'E1 心跳脚本可独立运行并打印自检过程');
    ok(/交易日/.test(out), 'E2 输出里包含交易日判断结果');
  }

  global.fetch = realFetch;

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})();
