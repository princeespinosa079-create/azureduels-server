const http = require('http');

let posts = [];
let rooms = {};
let notifs = {};
let deletedRooms = {};
let deletedIds = {}; // track deleted msg IDs per room

const PORT = process.env.PORT || 3000;
const CHAT_EXPIRE = 60 * 60 * 1000;
const GLOBAL_ROOM = '__global__';
const GLOBAL_MAX_MSGS = 1000000; // keep up to 1,000,000 messages in global

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
    if (roomId === GLOBAL_ROOM) continue; // NEVER expire global chat
    if (rooms[roomId].createdAt && (now - rooms[roomId].createdAt) >= CHAT_EXPIRE) {
      delete rooms[roomId];
    }
  }
  for (const roomId in deletedRooms) {
    if (deletedRooms[roomId].at && (now - deletedRooms[roomId].at) > 30 * 24 * 60 * 60 * 1000) {
      delete deletedRooms[roomId];
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

  // POST /posts
  if (req.method === 'POST' && url === '/posts') {
    getBody(req, (body) => {
      if (!body || !body.n) { respond(res, 400, { error: 'Missing fields' }); return; }
      posts = posts.filter(p => p.n !== body.n);
      body.tm = Date.now();
      posts.unshift(body);
      if (posts.length > 100) posts.pop();
      respond(res, 200, { ok: true });
    });
    return;
  }

  // GET /chat?room=ID
  if (req.method === 'GET' && url.startsWith('/chat?')) {
    const room = new URLSearchParams(url.split('?')[1] || '').get('room');
    if (!room) { respond(res, 400, { error: 'Missing room' }); return; }
    const recentDeleted = (deletedIds[room] || []).slice(-100);
    respond(res, 200, { msgs: (rooms[room] && rooms[room].msgs) || [], deleted: recentDeleted });
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url === '/chat') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s || !body.t) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (!rooms[body.room]) rooms[body.room] = { msgs: [], nextId: 1, createdAt: Date.now() };
      if (!rooms[body.room].nextId) rooms[body.room].nextId = 1;
      const msgId = rooms[body.room].nextId++;
      rooms[body.room].msgs.push({ id: msgId, s: body.s, t: body.t, tm: Date.now() });
      // Global chat keeps up to 1000 msgs, others keep 200
      const limit = body.room === GLOBAL_ROOM ? GLOBAL_MAX_MSGS : 200;
      if (rooms[body.room].msgs.length > limit) rooms[body.room].msgs.shift();
      respond(res, 200, { ok: true, id: msgId });
    });
    return;
  }

  // POST /chat/delete — sender can delete own message by id
  if (req.method === 'POST' && url === '/chat/delete') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.id || !body.s) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (rooms[body.room]) {
        const before = rooms[body.room].msgs.length;
        rooms[body.room].msgs = rooms[body.room].msgs.filter(m => {
          if (m.id === body.id && m.s === body.s) {
            if (!deletedIds[body.room]) deletedIds[body.room] = [];
            deletedIds[body.room].push(m.id);
            return false;
          }
          return true;
        });
        respond(res, 200, { ok: true, deleted: before - rooms[body.room].msgs.length });
      } else {
        respond(res, 200, { ok: false });
      }
    });
    return;
  }

  // POST /chat/deleteallcodes — delete all [CODE] messages by sender
  if (req.method === 'POST' && url === '/chat/deleteallcodes') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (rooms[body.room]) {
        rooms[body.room].msgs = rooms[body.room].msgs.filter(m => !(m.s === body.s && m.t && m.t.startsWith('[CODE]')));
        respond(res, 200, { ok: true });
      } else { respond(res, 200, { ok: false }); }
    });
    return;
  }

  // POST /chat/deleteall — delete ALL messages by a specific sender
  if (req.method === 'POST' && url === '/chat/deleteall') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (rooms[body.room]) {
        const before = rooms[body.room].msgs.length;
        rooms[body.room].msgs = rooms[body.room].msgs.filter(m => {
          if (m.s === body.s) {
            if (!deletedIds[body.room]) deletedIds[body.room] = [];
            deletedIds[body.room].push(m.id);
            return false;
          }
          return true;
        });
        respond(res, 200, { ok: true, deleted: before - rooms[body.room].msgs.length });
      } else {
        respond(res, 200, { ok: false });
      }
    });
    return;
  }

  // POST /chat/clearall — owner only, wipes ALL messages in global room
  if (req.method === 'POST' && url === '/chat/clearall') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (body.s !== 'real_name1533') { respond(res, 403, { error: 'No permission' }); return; }
      if (rooms[body.room]) {
        rooms[body.room].msgs = [];
        deletedIds[body.room] = [];
      }
      respond(res, 200, { ok: true });
    });
    return;
  }

  // POST /chat/clear — NEVER clears global chat
  if (req.method === 'POST' && url === '/chat/clear') {
    getBody(req, (body) => {
      if (body && body.room && body.room !== GLOBAL_ROOM) {
        delete rooms[body.room];
        deletedRooms[body.room] = deletedRooms[body.room] || {};
        if (body.by) deletedRooms[body.room][body.by] = Date.now();
      }
      respond(res, 200, { ok: true });
    });
    return;
  }

  // GET /deleted?player=NAME
  if (req.method === 'GET' && url.startsWith('/deleted?')) {
    const player = new URLSearchParams(url.split('?')[1] || '').get('player');
    if (!player) { respond(res, 400, { error: 'Missing player' }); return; }
    const myDeleted = Object.keys(deletedRooms).filter(room => deletedRooms[room][player]);
    respond(res, 200, { deleted: myDeleted });
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

setInterval(() => { cleanPosts(); cleanRooms(); }, 60000);

// Auto-reset global chat every day at exactly 12:00 AM
function scheduleNextMidnightReset() {
  const now = new Date();
  const next = new Date();
  next.setHours(24, 0, 0, 0); // next midnight
  const msUntilMidnight = next - now;
  setTimeout(() => {
    // Wipe global chat
    if (rooms['__global__']) {
      rooms['__global__'].msgs = [];
      deletedIds['__global__'] = [];
      console.log('Auto-reset global chat at midnight:', new Date().toISOString());
    }
    // Schedule next one
    scheduleNextMidnightReset();
  }, msUntilMidnight);
}
scheduleNextMidnightReset();

server.listen(PORT, () => {
  console.log('Azure Duels server on port ' + PORT);
});

// Self-ping every 4 minutes to prevent Railway sleep
const https = require('https');
setInterval(() => {
  try {
    const url = process.env.RAILWAY_STATIC_URL || ('https://azureduels-server-production.up.railway.app');
    https.get(url + '/', () => {}).on('error', () => {});
  } catch(e) {}
}, 4 * 60 * 1000);
