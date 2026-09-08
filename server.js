// Minimal zero-dependency static server for Railway.
// Serves index.html and any sibling assets; nothing else is needed to run this app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);

// Password gate, off by default. It now takes an explicit AUTH_ENABLED=1 as well as the
// two credentials, so leftover AUTH_USER / AUTH_PASS variables cannot lock the site.
const USER = process.env.AUTH_USER || '';
const PASS = process.env.AUTH_PASS || '';
const GATED = process.env.AUTH_ENABLED === '1' && Boolean(USER && PASS);

// Surfaced on /healthz so a deploy can be verified from outside without credentials.
const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || 'local').slice(0, 7);

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

// ---- shared state -------------------------------------------------------------------
// One JSON document, held on disk so every visitor sees the same wedding. DATA_DIR should
// point at a Railway volume; without one the file lives in the container and is lost on
// each redeploy.
// Defaults to /data, the usual Railway volume mount point. Without a volume mounted there
// the directory still works but lives inside the container, so it resets on every deploy.
let DATA_DIR = process.env.DATA_DIR || '/data';
try{
  fs.mkdirSync(DATA_DIR, {recursive: true});
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
}catch(e){
  DATA_DIR = path.join(ROOT, 'data');           // last resort, ephemeral
  try{ fs.mkdirSync(DATA_DIR, {recursive: true}); }catch(e2){}
  console.log('Falling back to ' + DATA_DIR + ' — mount a volume for durable storage');
}
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY = 4 * 1024 * 1024;

function readState(cb){
  fs.readFile(DATA_FILE, 'utf8', (err, txt) => {
    if(err) return cb({rev: 0, state: null});
    try{
      const j = JSON.parse(txt);
      cb({rev: Number(j.rev) || 0, state: j.state || null});
    }catch(e){
      cb({rev: 0, state: null});
    }
  });
}

// Write to a temp file and rename, so a crash mid-write cannot leave a truncated document.
function writeState(rev, state, cb){
  fs.mkdir(DATA_DIR, {recursive: true}, () => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify({rev, state, savedAt: new Date().toISOString()}), err => {
      if(err) return cb(err);
      fs.rename(tmp, DATA_FILE, cb);
    });
  });
}

function handleState(req, res){
  if(req.method === 'GET'){
    return readState(d => send(res, 200, JSON.stringify(d),
      {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}));
  }
  if(req.method === 'PUT' || req.method === 'POST'){
    let body = '', tooBig = false;
    req.on('data', c => {
      body += c;
      if(body.length > MAX_BODY){ tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if(tooBig) return send(res, 413, 'Payload too large', {'Content-Type': 'text/plain'});
      let payload;
      try{ payload = JSON.parse(body); }
      catch(e){ return send(res, 400, 'Malformed JSON', {'Content-Type': 'text/plain'}); }
      if(!payload || typeof payload.state !== 'object' || payload.state === null){
        return send(res, 400, 'Missing state', {'Content-Type': 'text/plain'});
      }
      readState(cur => {
        // Reject a save built on a stale copy rather than silently overwriting whoever
        // edited in between; the client then adopts the newer document.
        const clientRev = Number(payload.rev) || 0;
        if(payload.force !== true && cur.rev !== 0 && clientRev !== cur.rev){
          return send(res, 409, JSON.stringify(cur),
            {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        }
        writeState(cur.rev + 1, payload.state, err => {
          if(err) return send(res, 500, 'Could not save', {'Content-Type': 'text/plain'});
          send(res, 200, JSON.stringify({rev: cur.rev + 1}),
            {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        });
      });
    });
    return;
  }
  return send(res, 405, 'Method not allowed',
    {'Content-Type': 'text/plain', 'Allow': 'GET, PUT'});
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // Health check stays open so Railway can probe it without credentials.
  if(urlPath === '/healthz') return send(res, 200, 'ok ' + VERSION, {'Content-Type': 'text/plain'});

  if(!authed(req)){
    return send(res, 401, 'Authentication required', {
      'WWW-Authenticate': 'Basic realm="Wedding", charset="UTF-8"',
      'Content-Type': 'text/plain'
    });
  }

  // The shared document lives behind the same gate as the page.
  if(urlPath === '/api/state') return handleState(req, res);

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
        send(res, 200, home, {'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store, must-revalidate'});
      });
    }
    const ext = path.extname(target).toLowerCase();
    send(res, 200, data, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // The app is one file that changes when redeployed — always revalidate.
      // no-store, not no-cache: the browser kept serving a stale page after redeploys
      'Cache-Control': ext === '.html' ? 'no-store, must-revalidate' : 'public, max-age=3600'
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Wedding listening on ' + PORT + (GATED ? ' (password protected)' : ' (public)'));
});
