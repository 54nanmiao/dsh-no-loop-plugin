// test-ui.mjs —— 0.2.0 设置面板的后端：配置归一化、宿主路由、灵敏度即时生效
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-loop-ui-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.NO_LOOP_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.NO_LOOP_DATA_DIR, { recursive: true });
const today = new Date().toLocaleDateString('sv-SE');
fs.writeFileSync(path.join(process.env.NO_LOOP_DATA_DIR, 'halt.log'),
  JSON.stringify({ ts: today + 'T10:00:00.000Z', chars: 1234, reasons: ['tail'] }) + '\n', 'utf8');

const mod = await import('./index.js');
const { normalizeConfig, DEFAULTS, RUNTIME, loadConfig, saveConfig, haltStats, CONFIG, apply } = mod;

let ok = 0, bad = 0;
function t(name, cond, extra) {
  if (cond) { ok++; console.log('✅ ' + name); }
  else { bad++; console.log('❌ ' + name + (extra === undefined ? '' : '  实际=' + JSON.stringify(extra))); }
}

// 1) 归一化：非法值回落、越界钳制、灵敏度白名单
const n1 = normalizeConfig({ sensitivity: 'nonsense', minProbe: 5, probeStep: -1, probeTail: 'x', streamGuard: false });
t('非法灵敏度回落 standard', n1.sensitivity === 'normal', n1.sensitivity);
t('minProbe 钳到下限 20', n1.minProbe === 20, n1.minProbe);
t('probeStep 钳到下限 10', n1.probeStep === 10, n1.probeStep);
t('probeTail 非法回落 4000', n1.probeTail === 4000, n1.probeTail);
t('streamGuard=false 保留', n1.streamGuard === false, n1.streamGuard);
t('rule 缺省为 true', n1.rule === true, n1.rule);

// 2) 统计：今日命中 1
const s = haltStats();
t('haltStats 读到今日 1 条', s.ok && s.today === 1 && s.total === 1, s);
t('haltStats 带出最近理由', Array.isArray(s.lastReasons) && s.lastReasons[0] === 'tail', s.lastReasons);

// 3) 路由：假 webServer 收注册
const routes = [];
const fakeCtx = {
  get: () => undefined,
  on: () => () => {},
  inject: (names, cb) => {
    const host = {
      webServer: { register: (r) => { routes.push(r); return () => {}; } },
      effect: (fn) => { fn(); },
    };
    cb(host);
  },
};
apply(fakeCtx, {});
const stateRoute = routes.find((r) => r.path === '/plugins/dsh-no-loop-plugin/state');
const cfgRoute = routes.find((r) => r.path === '/plugins/dsh-no-loop-plugin/config');
t('注册了 /state', Boolean(stateRoute) && stateRoute.kind === 'exact');
t('注册了 /config', Boolean(cfgRoute) && cfgRoute.kind === 'exact');

function fakeRes() {
  const out = { status: 0, headers: null, body: '' };
  out.writeHead = (st, h) => { out.status = st; out.headers = h || null; };
  out.end = (b) => { out.body = String(b || ''); };
  return out;
}

const res1 = fakeRes();
stateRoute.handler({ method: 'GET' }, res1);
const j1 = JSON.parse(res1.body);
t('/state 200 且 ok', res1.status === 200 && j1.ok === true, res1.status);
t('/state 带 config 与 stats', Boolean(j1.config) && j1.stats.today === 1, Object.keys(j1));

// 4) 写配置：严格档 → detector CONFIG 立即跟着变
const before = { ritualCount: CONFIG.ritualCount };
const res2 = fakeRes();
const req2 = { method: 'POST', on(e, fn) { if (e === 'data') fn(Buffer.from('{}')); if (e === 'end') fn(); } };
await cfgRoute.handler(req2, res2);
t('空 body 也能写（合并为默认值）', res2.status === 200 && JSON.parse(res2.body).ok === true, res2.body);

const res3 = fakeRes();
await cfgRoute.handler({ method: 'GET' }, res3);
t('/config GET 200', res3.status === 200 && JSON.parse(res3.body).ok === true);

const res4 = fakeRes();
const req4 = { method: 'POST', on(e, fn) { if (e === 'data') fn(Buffer.from(JSON.stringify({ sensitivity: 'strict' }))); if (e === 'end') fn(); } };
await cfgRoute.handler(req4, res4);
const j4 = JSON.parse(res4.body);
t('/config POST 写成功', res4.status === 200 && j4.ok === true && j4.config.sensitivity === 'strict', j4);
t('落盘文件存在', fs.existsSync(path.join(home, '.dsh', 'no-loop.json')));
t('严格档把 ritualCount 压到 8', CONFIG.ritualCount === 8 && before.ritualCount !== 8, CONFIG.ritualCount);
t('RUNTIME 同步', RUNTIME.sensitivity === 'strict', RUNTIME.sensitivity);

// 5) 坏 JSON → 400
const res5 = fakeRes();
const req5 = { method: 'POST', on(e, fn) { if (e === 'data') fn(Buffer.from('{oops')); if (e === 'end') fn(); } };
await cfgRoute.handler(req5, res5);
t('坏 JSON 返回 400 bad-json', res5.status === 400 && JSON.parse(res5.body).reason === 'bad-json', res5.body);

// 6) 非 GET/POST → 405
const res6 = fakeRes();
await cfgRoute.handler({ method: 'DELETE' }, res6);
t('DELETE 返回 405', res6.status === 405, res6.status);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n设置面板后端: ' + ok + '/' + (ok + bad));
process.exit(bad ? 1 : 0);
