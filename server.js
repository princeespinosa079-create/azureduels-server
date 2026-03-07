const http = require('http');

let posts = [];
let rooms = {};
let notifs = {};
let deletedRooms = {}; // { "player__otherplayer": { by: "playerName", at: timestamp } }

const PORT = process.env.PORT || 3000;
const CHAT_EXPIRE = 60 * 60 * 1000;

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
    if (roomId === '__global__') continue; // global chat never expires
    if (rooms[roomId].createdAt && (now - rooms[roomId].createdAt) >= CHAT_EXPIRE) {
      delete rooms[roomId];
    }
  }
  // Clean deleted rooms older than 30 days
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
    respond(res, 200, { msgs: (rooms[room] && rooms[room].msgs) || [] });
    return;
  }

  // POST /chat
  if (req.method === 'POST' && url === '/chat') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s || !body.t) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (!rooms[body.room]) rooms[body.room] = { msgs: [], createdAt: Date.now() };
      if (!rooms[body.room].nextId) rooms[body.room].nextId = 1;
      const msgId = rooms[body.room].nextId++;
      rooms[body.room].msgs.push({ id: msgId, s: body.s, t: body.t, tm: Date.now() });
      if (rooms[body.room].msgs.length > 200) rooms[body.room].msgs.shift();
      respond(res, 200, { ok: true, id: msgId });
    });
    return;
  }

  // POST /chat/delete  — sender can delete own message by id
  if (req.method === 'POST' && url === '/chat/delete') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.id || !body.s) { respond(res, 400, { error: 'Missing fields' }); return; }
      if (rooms[body.room]) {
        const before = rooms[body.room].msgs.length;
        // Only delete if sender matches
        rooms[body.room].msgs = rooms[body.room].msgs.filter(m => !(m.id === body.id && m.s === body.s));
        respond(res, 200, { ok: true, deleted: before - rooms[body.room].msgs.length });
      } else {
        respond(res, 200, { ok: false });
      }
    });
    return;
  }

  // POST /chat/clear  (also marks as permanently deleted)
  if (req.method === 'POST' && url === '/chat/clear') {
    getBody(req, (body) => {
      if (body && body.room) {
        delete rooms[body.room];
        // Mark as permanently deleted by this player
        deletedRooms[body.room] = deletedRooms[body.room] || {};
        if (body.by) {
          deletedRooms[body.room][body.by] = Date.now();
        }
      }
      respond(res, 200, { ok: true });
    });
    return;
  }

  // GET /deleted?player=NAME  — returns list of room IDs this player has deleted
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
      // Don't create room if either player deleted it
      if (!rooms[room]) rooms[room] = { msgs: [], createdAt: Date.now() };
      // Offer goes via notifs ONLY - not in chat room (private to receiver)
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
