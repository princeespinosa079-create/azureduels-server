const http = require('http');

let posts = [];
let rooms = {};      // {roomId: {msgs: [], createdAt: timestamp}}
let notifs = {};

const PORT = process.env.PORT || 3000;
const CHAT_EXPIRE = 60 * 60 * 1000; // 1 hour in ms

function respond(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function getBody(req, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { cb(JSON.parse(body)); }
    catch(e) { cb(null); }
  });
}

function cleanPosts() {
  const now = Date.now();
  posts = posts.filter(p => !p.tm || (now - p.tm) < 120000);
}

function cleanRooms() {
  const now = Date.now();
  for (const roomId in rooms) {
    if (rooms[roomId].createdAt && (now - rooms[roomId].createdAt) >= CHAT_EXPIRE) {
      delete rooms[roomId];
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { respond(res, 200, {}); return; }
  const url = req.url;

  // GET /posts
  if (req.method === 'GET' && url === '/posts') {
    cleanPosts();
    respond(res, 200, { posts });
    return;
  }

  // POST /posts/clean
  if (req.method === 'POST' && url === '/posts/clean') {
    getBody(req, (body) => {
      if (body && Array.isArray(body.posts)) posts = body.posts;
      respond(res, 200, { ok: true });
    });
    return;
  }

  // POST /posts
  if (req.method === 'POST' && url === '/posts') {
    getBody(req, (body) => {
      if (!body || !body.n || !body.h || !body.w) { respond(res, 400, { error: 'Missing fields' }); return; }
      posts.unshift({ n: body.n, h: body.h, w: body.w, nt: body.nt || '', pid: body.pid || (body.n + '_' + Date.now()), tm: Date.now() });
      if (posts.length > 200) posts = posts.slice(0, 200);
      respond(res, 200, { ok: true });
    });
    return;
  }

  // GET /chat?room=ROOMID
  if (req.method === 'GET' && url.startsWith('/chat?')) {
    const room = new URLSearchParams(url.split('?')[1] || '').get('room');
    if (!room) { respond(res, 400, { error: 'Missing room' }); return; }
    const r = rooms[room];
    // Check if expired
    if (r && r.createdAt && (Date.now() - r.createdAt) >= CHAT_EXPIRE) {
      delete rooms[room];
      respond(res, 200, { msgs: [], expired: true });
      return;
    }
    respond(res, 200, { msgs: r ? r.msgs : [], expired: false });
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url === '/chat') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s || !body.t) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (!rooms[body.room]) rooms[body.room] = { msgs: [], createdAt: Date.now() };
      rooms[body.room].msgs.push({ s: body.s, t: body.t, tm: Date.now() });
      if (rooms[body.room].msgs.length > 200) rooms[body.room].msgs.shift();
      respond(res, 200, { ok: true });
    });
    return;
  }

  // POST /chat/clear
  if (req.method === 'POST' && url === '/chat/clear') {
    getBody(req, (body) => {
      if (body && body.room) delete rooms[body.room];
      respond(res, 200, { ok: true });
    });
    return;
  }

  // POST /offer
  if (req.method === 'POST' && url === '/offer') {
    getBody(req, (body) => {
      if (!body || !body.to || !body.from || !body.have || !body.want) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (!notifs[body.to]) notifs[body.to] = [];
      const names = [body.from, body.to].sort();
      const room = names[0] + '__' + names[1];
      if (!rooms[room]) rooms[room] = { msgs: [], createdAt: Date.now() };
      const offerText = '📦 OFFER: Have ' + body.have + ' | Want ' + body.want + (body.msg ? ' | ' + body.msg : '') + ' [ACCEPT_DECLINE]';
      rooms[room].msgs.push({ s: body.from, t: offerText, tm: Date.now() });
      notifs[body.to].push({ from: body.from, have: body.have, want: body.want, msg: body.msg||'', room: room, tm: Date.now() });
      if (notifs[body.to].length > 50) notifs[body.to].shift();
      respond(res, 200, { ok: true, room: room });
    });
    return;
  }

  // GET /notifs?player=NAME
  if (req.method === 'GET' && url.startsWith('/notifs?')) {
    const player = new URLSearchParams(url.split('?')[1] || '').get('player');
    if (!player) { respond(res, 400, { error: 'Missing player' }); return; }
    respond(res, 200, { notifs: notifs[player] || [] });
    return;
  }

  // POST /notifs/clear
  if (req.method === 'POST' && url === '/notifs/clear') {
    getBody(req, (body) => {
      if (body && body.player) notifs[body.player] = [];
      respond(res, 200, { ok: true });
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && url === '/') {
    respond(res, 200, { status: 'Azure Duels Trade Board running!' });
    return;
  }

  respond(res, 404, { error: 'Not found' });
});

// Auto-clean every minute
setInterval(() => { cleanPosts(); cleanRooms(); }, 60000);

server.listen(PORT, () => {
  console.log('Azure Duels server on port ' + PORT);
});
