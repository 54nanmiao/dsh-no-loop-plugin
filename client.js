/* eslint-disable */
// client.js —— 客户端半边（DSH Web 界面）
//   1) 侧边栏一行：今天命中了几次、当前灵敏度；
//   2) 设置 → 防循环：流中熔断开关、提示词纪律开关、灵敏度三档、四个数字阈值。
// 约定照抄生态插件：只 require('react')，不 require Harness 的 client 包；
// CSS 自带、类名 .dsnl- 前缀、颜色优先引用 --dsw-* token（取不到时给兜底色）。
// 判定逻辑一律在宿主（/plugins/dsh-no-loop-plugin/state 是单一事实源），前端只负责显示与写配置。
window.__ModuleLoader__.load({
  id: 'dsh-no-loop-plugin',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    var name = 'dsh-no-loop-plugin';
    var STATE_URL = '/plugins/dsh-no-loop-plugin/state';
    var CONFIG_URL = '/plugins/dsh-no-loop-plugin/config';
    var NAV_LABEL = '防循环';
    var POLL_MS = 30000;

    var LABELS = { loose: '宽松', normal: '标准', strict: '严格' };

    var CSS = [
      '.dsnl-row{box-sizing:border-box;width:100%;border-radius:var(--dsw-radius-md,8px);min-height:36px;color:var(--dsw-alias-label-primary,#e7e7e7);font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:8px;margin:0 2px;padding:7px 8px;line-height:22px;display:flex;flex:1 1 auto}',
      '.dsnl-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.dsnl-row.dsnl-collapsed{width:36px;height:36px;min-height:36px;justify-content:center;margin:0;padding:0;flex:none;align-self:center}',
      '.dsnl-glyph{flex:none;justify-content:center;align-items:center;display:inline-flex;width:18px}',
      '.dsnl-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.dsnl-title{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;font-size:13px}',
      '.dsnl-sub{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}',
      '.dsnl-dot{width:8px;height:8px;border-radius:50%;display:block;background:var(--dsw-alias-label-tertiary,#8b8b8b)}',
      '.dsnl-dot.dsnl-on{background:#3ecf8e;box-shadow:0 0 0 3px rgba(62,207,142,.16)}',
      '.dsnl-dot.dsnl-hit{background:#ff8a3d;box-shadow:0 0 0 3px rgba(255,138,61,.18)}',
      '.dsnl-section{display:flex;flex-direction:column;width:100%;gap:0}',
      '.dsnl-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.dsnl-field+.dsnl-field{border-top:.5px solid var(--dsw-alias-border-l2,#2c2f33)}',
      '.dsnl-head{display:flex;gap:8px;align-items:center}',
      '.dsnl-label{flex:1;font-size:13px;line-height:1.5;font-weight:500;color:var(--dsw-alias-label-primary,#e7e7e7)}',
      '.dsnl-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8b8b8b)}',
      '.dsnl-switch{width:36px;height:20px;padding:2px;border-radius:999px;border:none;background:var(--dsw-alias-border-l3,#3a3d42);cursor:pointer;display:inline-flex;align-items:center;flex-shrink:0}',
      '.dsnl-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dsnl-thumb{width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 120ms ease;display:block}',
      '.dsnl-switch[aria-checked="true"] .dsnl-thumb{transform:translateX(16px)}',
      '.dsnl-seg{display:inline-flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#2c2f33)}',
      '.dsnl-seg button{border:none;background:0 0;cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 14px;color:var(--dsw-alias-label-secondary,#a9a9a9)}',
      '.dsnl-seg button+button{border-left:1px solid var(--dsw-alias-border-l2,#2c2f33)}',
      '.dsnl-seg button.dsnl-on{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font-weight:600}',
      '.dsnl-num{box-sizing:border-box;width:110px;font:inherit;font-size:13px;line-height:20px;padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#2c2f33);background:var(--dsw-alias-bg-l1,#16181c);color:var(--dsw-alias-label-primary,#e7e7e7)}',
      '.dsnl-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
      '.dsnl-stat{border:1px solid var(--dsw-alias-border-l2,#2c2f33);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}',
      '.dsnl-stat b{font-size:16px;font-weight:650}',
      '.dsnl-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b8b)}',
      '.dsnl-actions{display:flex;gap:8px;align-items:center;padding-top:4px}',
      '.dsnl-btn{box-sizing:border-box;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 12px;border:none;color:var(--dsw-alias-label-primary,#e7e7e7);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsnl-btn-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font-weight:600}',
      '.dsnl-ok{font-size:12px;color:#3ecf8e}',
      '.dsnl-bad{font-size:12px;color:#ff7a7a}',
      '.dsnl-mono{font-family:Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b8b);word-break:break-all}',
    ];

    function injectCss() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('dsnl-css')) return;
      var el = document.createElement('style');
      el.id = 'dsnl-css';
      el.textContent = CSS.join('\n');
      document.head.appendChild(el);
    }

    var shared = { state: null, listeners: [] };
    function setState(s) {
      shared.state = s;
      shared.listeners.forEach(function (fn) { try { fn(s); } catch (e) { void e; } });
    }
    function fetchState() {
      return fetch(STATE_URL, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok) setState(j); return j; })
        .catch(function () { return null; });
    }
    function useShared() {
      var pair = React.useState(shared.state);
      var s = pair[0];
      var setS = pair[1];
      React.useEffect(function () {
        shared.listeners.push(setS);
        if (!shared.state) fetchState();
        return function () {
          shared.listeners = shared.listeners.filter(function (x) { return x !== setS; });
        };
      }, []);
      return s;
    }

    // ================= 侧边栏一行 =================
    function SidebarRow(props) {
      var st = useShared();
      var collapsed = Boolean(props && (props.collapsed || props.isCollapsed));
      var cfg = (st && st.config) || {};
      var stats = (st && st.stats) || {};
      var today = Number(stats.today || 0);
      var total = Number(stats.total || 0);
      var enabled = cfg.streamGuard !== false || cfg.rule !== false;
      var sub = '今日命中 ' + today + ' · ' + (LABELS[cfg.sensitivity] || '标准');
      var dotCls = 'dsnl-dot ' + (today > 0 ? 'dsnl-hit' : (enabled ? 'dsnl-on' : ''));
      var title = '防循环：今日命中 ' + today + ' 次 · 累计 ' + total + ' 次\n' +
        '灵敏度 ' + (LABELS[cfg.sensitivity] || '标准') + ' · 流中熔断 ' + (cfg.streamGuard === false ? '关' : '开') +
        ' · 提示词纪律 ' + (cfg.rule === false ? '关' : '开');
      var content = collapsed
        ? React.createElement('span', { className: dotCls })
        : [
            React.createElement('span', { className: 'dsnl-glyph', key: 'g' }, React.createElement('span', { className: dotCls })),
            React.createElement('span', { className: 'dsnl-body', key: 'b' },
              React.createElement('span', { className: 'dsnl-title' }, '防循环'),
              React.createElement('span', { className: 'dsnl-sub' }, sub)),
          ];
      return React.createElement('button', {
        type: 'button',
        className: 'dsnl-row' + (collapsed ? ' dsnl-collapsed' : ''),
        title: title,
        onClick: function () { fetchState(); },
      }, content);
    }

    // ================= 设置面板 =================
    function Switch(props) {
      return React.createElement('button', {
        type: 'button',
        role: 'switch',
        className: 'dsnl-switch',
        'aria-checked': props.checked ? 'true' : 'false',
        disabled: props.disabled,
        onClick: function () { props.onChange(!props.checked); },
      }, React.createElement('span', { className: 'dsnl-thumb' }));
    }

    function Num(props) {
      return React.createElement('input', {
        type: 'number',
        className: 'dsnl-num',
        value: String(props.value),
        min: props.min,
        max: props.max,
        step: props.step || 10,
        disabled: props.disabled,
        onChange: function (e) { props.onChange(e.target.value); },
      });
    }

    function SettingsSection() {
      var st = useShared();
      var load = React.useState(null);
      var draft = load[0];
      var setDraft = load[1];
      var noteS = React.useState('');
      var note = noteS[0];
      var setNote = noteS[1];
      var busyS = React.useState(false);
      var busy = busyS[0];
      var setBusy = busyS[1];

      var cur = draft || (st && st.config) || {};
      function patch(k, v) {
        var next = Object.assign({}, cur);
        next[k] = v;
        setDraft(next);
        setNote('');
      }
      function save(over) {
        setBusy(true);
        setNote('');
        fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({}, cur, over || {})),
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            setBusy(false);
            if (j && j.ok) { setDraft(null); setNote('已保存并立即生效'); setState(Object.assign({}, shared.state, { config: j.config })); fetchState(); }
            else setNote('失败：' + ((j && (j.reason || j.detail)) || 'unknown'));
          })
          .catch(function (e) { setBusy(false); setNote('失败：' + String((e && e.message) || e)); });
      }

      var stats = (st && st.stats) || {};
      var rows = [];

      rows.push(React.createElement('div', { className: 'dsnl-field', key: 'stat' },
        React.createElement('div', { className: 'dsnl-head' }, React.createElement('span', { className: 'dsnl-label' }, '命中统计')),
        React.createElement('div', { className: 'dsnl-stats' },
          React.createElement('div', { className: 'dsnl-stat' }, React.createElement('b', null, String(stats.today || 0)), React.createElement('span', null, '今天')),
          React.createElement('div', { className: 'dsnl-stat' }, React.createElement('b', null, String(stats.total || 0)), React.createElement('span', null, '累计')),
          React.createElement('div', { className: 'dsnl-stat' }, React.createElement('b', null, (st && st.config && LABELS[st.config.sensitivity]) || '标准'), React.createElement('span', null, '灵敏度'))),
        React.createElement('div', { className: 'dsnl-hint' },
          stats.total
            ? '最近一次：' + (stats.lastAt || '—') + (stats.lastChars ? ' · 截断 ' + stats.lastChars + ' 字' : '') + ' · 理由 ' + (Array.isArray(stats.lastReasons) ? stats.lastReasons.join('、') : '—')
            : '还没有命中记录。命中时会把整段 reasoning 存在插件目录的 data/halt.log 里。'),
        React.createElement('div', { className: 'dsnl-mono' }, (stats.file || ''))));

      rows.push(React.createElement('div', { className: 'dsnl-field', key: 'guard' },
        React.createElement('div', { className: 'dsnl-head' },
          React.createElement('span', { className: 'dsnl-label' }, '流中熔断'),
          React.createElement(Switch, { checked: cur.streamGuard !== false, onChange: function (v) { patch('streamGuard', v); }, disabled: busy })),
        React.createElement('div', { className: 'dsnl-hint' }, '边生成边判；命中就截断这段 reasoning，并换成截断版写进历史，避免复读回灌。关掉后只保留工具与纪律。')));

      rows.push(React.createElement('div', { className: 'dsnl-field', key: 'rule' },
        React.createElement('div', { className: 'dsnl-head' },
          React.createElement('span', { className: 'dsnl-label' }, '提示词纪律'),
          React.createElement(Switch, { checked: cur.rule !== false, onChange: function (v) { patch('rule', v); }, disabled: busy })),
        React.createElement('div', { className: 'dsnl-hint' }, '往系统提示词里加一段「发现自己重复 → 换说法 / 收尾」的纪律。改这一项要重启 DSH 才生效。')));

      rows.push(React.createElement('div', { className: 'dsnl-field', key: 'sens' },
        React.createElement('div', { className: 'dsnl-head' },
          React.createElement('span', { className: 'dsnl-label' }, '灵敏度'),
          React.createElement('div', { className: 'dsnl-seg' }, ['loose', 'normal', 'strict'].map(function (k) {
            return React.createElement('button', {
              key: k,
              type: 'button',
              className: cur.sensitivity === k ? 'dsnl-on' : '',
              disabled: busy,
              onClick: function () { patch('sensitivity', k); },
            }, LABELS[k]);
          }))),
        React.createElement('div', { className: 'dsnl-hint' }, '宽松：要重复很久才拦（长推理更顺）；严格：早早拦（更费 token 的循环断得快）。改完下一段生成就按新档位判。')));

      var nums = [
        ['minProbe', '开始判定的字数', '攒够这么多字才开始判。调大＝更省，反应更慢。', 20, 2000],
        ['probeStep', '判定间隔', '之后每多攒这么多字判一次。调小＝更灵敏，CPU 更忙。', 10, 2000],
        ['probeTail', '只看尾部多少字', '判定时截取末端的窗口。循环通常紧邻结尾，一般不用改。', 400, 20000],
        ['chatMax', '聊天档上限', '整块 reasoning 不足这么多字＝聊天，放宽阈值，别拦正常短思考。', 200, 20000],
      ];
      nums.forEach(function (n) {
        rows.push(React.createElement('div', { className: 'dsnl-field', key: n[0] },
          React.createElement('div', { className: 'dsnl-head' },
            React.createElement('span', { className: 'dsnl-label' }, n[1]),
            React.createElement(Num, { value: cur[n[0]], min: n[3], max: n[4], disabled: busy, onChange: function (v) { patch(n[0], v); } })),
          React.createElement('div', { className: 'dsnl-hint' }, n[2])));
      });

      rows.push(React.createElement('div', { className: 'dsnl-field', key: 'do' },
        React.createElement('div', { className: 'dsnl-actions' },
          React.createElement('button', { type: 'button', className: 'dsnl-btn dsnl-btn-primary', disabled: busy, onClick: function () { save(); } }, busy ? '保存中…' : '保存'),
          React.createElement('button', {
            type: 'button',
            className: 'dsnl-btn',
            disabled: busy,
            onClick: function () {
              setDraft({ streamGuard: true, rule: true, sensitivity: 'normal', minProbe: 80, probeStep: 40, probeTail: 4000, chatMax: 1200 });
              setNote('已填回默认值，点「保存」才生效');
            },
          }, '恢复默认')),
        note ? React.createElement('div', { className: note.indexOf('失败') === 0 ? 'dsnl-bad' : 'dsnl-ok' }, note) : null,
        React.createElement('div', { className: 'dsnl-mono' }, (st && st.file) || '')));

      return React.createElement('div', { className: 'dsnl-section' }, rows);
    }

    // ================= 挂载 =================
    var timers = [];
    function applyClient(ctx) {
      injectCss();
      var slots = ctx.get('slots');
      if (slots && typeof slots.inject === 'function') {
        slots.inject('sidebar.footer.action', function () {
          return slots.register(
            { name: 'sidebar.footer.action', id: 'dsh-no-loop-plugin', order: 92, label: NAV_LABEL },
            function (props) { return React.createElement(SidebarRow, props); }
          );
        });
        slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'dsh-no-loop-plugin', order: 890, label: NAV_LABEL },
            function () { return React.createElement(SettingsSection, null); }
          );
        });
      }
      fetchState();
      timers.push(setInterval(fetchState, POLL_MS));
    }

    exports.name = name;
    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      try { applyClient(ctx); } catch (e) { /* 挂载失败不拖垮宿主界面 */ void e; }
    };
    exports.__unload = function () {
      timers.forEach(function (t) { clearInterval(t); });
      timers = [];
    };

    return module.exports;
  },
});
