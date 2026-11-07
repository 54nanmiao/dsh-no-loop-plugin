// test-client.mjs —— 客户端半边：挂进 slots、能渲染、不炸
// 用一个极小的假 React 跑一遍渲染，不依赖浏览器。
import path from 'node:path';

let captured = null;
const fakeReact = {
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) }; },
  useState(init) { const v = typeof init === 'function' ? init() : init; return [v, () => {}]; },
  useEffect() {},
};

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      const exp = spec.factory(() => fakeReact);
      captured = { id: spec.id, exports: exp };
      return spec;
    },
  },
};
globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
globalThis.document = {
  head: { appendChild() {} },
  getElementById: () => null,
  createElement: () => ({ id: '', set textContent(v) { this._t = v; } }),
};

const p = path.join(import.meta.dirname, 'client.js');
await import('file://' + p.replace(/\\/g, '/'));

let ok = 0, bad = 0;
const t = (name, cond, extra) => { if (cond) { ok++; console.log('✅ ' + name); } else { bad++; console.log('❌ ' + name + (extra === undefined ? '' : '  实际=' + JSON.stringify(extra))); } };

t('__ModuleLoader__ 被调用', Boolean(captured));
t('id 是包名', captured && captured.id === 'dsh-no-loop-plugin', captured && captured.id);
const exp = captured && captured.exports;
t('导出 name', exp && exp.name === 'dsh-no-loop-plugin', exp && exp.name);
t('inject slots', exp && Array.isArray(exp.inject) && exp.inject[0] === 'slots', exp && exp.inject);
t('有 apply/__unload', typeof exp?.apply === 'function' && typeof exp.__unload === 'function');

// 假 slots：记录注册
const regs = [];
const ctx = { get: (k) => k === 'slots' ? { inject: (_n, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }); return () => {}; } } : undefined };
exp.apply(ctx);
t('注册了两个 slot', regs.length === 2, regs.map(r => r.meta.name));
t('侧边栏 slot', regs.some(r => r.meta.name === 'sidebar.footer.action'));
t('设置 slot 在 890', regs.some(r => r.meta.name === 'settings.section' && r.meta.order === 890));

// 迷你渲染：函数组件递归展开，收集文本
function render(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(render).join('');
  if (typeof node === 'function') return render(node({}));
  if (typeof node.type === 'function') return render(node.type(node.props));
  if (node.type === 'input' || node.type === 'textarea') return '';
  return (node.children || []).map(render).join('');
}

const byName = (n) => regs.find(r => r.meta.name === n);
let rowErr = null;
let rowText = '';
try { rowText = render(byName('sidebar.footer.action').comp({})); } catch (e) { rowErr = String(e.message); }
t('侧边栏行渲染不抛错', !rowErr, rowErr);
t('侧边栏行有「防循环」与「今日命中」', rowText.includes('防循环') && rowText.includes('今日命中'), rowText.slice(0, 80));

let setErr = null;
let setText = '';
try { setText = render(byName('settings.section').comp({})); } catch (e) { setErr = String(e.message); }
t('设置面板渲染不抛错', !setErr, setErr);
['命中统计', '流中熔断', '提示词纪律', '灵敏度', '开始判定的字数', '聊天档上限', '保存', '恢复默认']
  .forEach((s) => t('设置面板含「' + s + '」', setText.includes(s)));

exp.__unload();
console.log('\n客户端半边: ' + ok + '/' + (ok + bad));
process.exit(bad ? 1 : 0);
