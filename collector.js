// 在 http.createServer 回调开头加静态托管（放在 /collect 判断之前）
const PUBLIC_DIR = path.join(__dirname, 'public');
function serveStatic(req, res, p) {
  const file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = fs.readFileSync(file);
    const ext = path.extname(file);
    const type = ext === '.html' ? 'text/html; charset=utf-8'
               : ext === '.js'   ? 'application/javascript; charset=utf-8'
               : 'text/plain; charset=utf-8';
    send(res, 200, data, type);
    return true;
  } catch (e) { return false; }
}
// 路由里：
// if (['/','/index.html','/collector.js'].includes(p) && req.method === 'GET') {
//   if (serveStatic(req, res, p)) return;
// }
