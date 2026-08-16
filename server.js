// Minimal zero-dependency static server for Railway.
// Serves index.html and any sibling assets; nothing else is needed to run this app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);

// Optional password gate. Leave the env vars unset and the site is simply public.
const USER = process.env.AUTH_USER || '';
const PASS = process.env.AUTH_PASS || '';
const GATED = Boolean(USER && PASS);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function authed(req){
  if(!GATED) return true;
  const header = req.headers.authorization || '';
  if(!header.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return u === USER && p === PASS;
}

function send(res, code, body, headers){
  res.writeHead(code, Object.assign({'X-Content-Type-Options': 'nosniff'}, headers || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // Health check stays open so Railway can probe it without credentials.
  if(urlPath === '/healthz') return send(res, 200, 'ok', {'Content-Type': 'text/plain'});

  if(!authed(req)){
    return send(res, 401, 'Authentication required', {
      'WWW-Authenticate': 'Basic realm="Worklist", charset="UTF-8"',
      'Content-Type': 'text/plain'
    });
  }

  if(req.method !== 'GET' && req.method !== 'HEAD'){
    return send(res, 405, 'Method not allowed', {'Content-Type': 'text/plain', 'Allow': 'GET, HEAD'});
  }

  const target = path.resolve(ROOT, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  // Refuse anything that resolves outside the app directory.
  if(target !== ROOT && !target.startsWith(ROOT + path.sep)){
    return send(res, 403, 'Forbidden', {'Content-Type': 'text/plain'});
  }

  fs.readFile(target, (err, data) => {
    if(err){
      // Unknown path: hand back the app itself rather than a 404 page.
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, home) => {
        if(e2) return send(res, 404, 'Not found', {'Content-Type': 'text/plain'});
        send(res, 200, home, {'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache'});
      });
    }
    const ext = path.extname(target).toLowerCase();
    send(res, 200, data, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // The app is one file that changes when redeployed — always revalidate.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Worklist listening on ' + PORT + (GATED ? ' (password protected)' : ' (public)'));
});
