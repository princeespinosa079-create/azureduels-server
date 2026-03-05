const http = require('http');

// In-memory store (resets if server restarts, but Render keeps it running 24/7)
let posts = [];   // [{n, h, w, nt, t}]
let rooms = {};   // {roomId: [{s, t, tm}]}

const PORT = process.env.PORT || 3000;

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

const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    respond(res, 200, {});
    return;
  }

  const url = req.url;

  // GET /posts — fetch all trade posts (auto-filter expired >2min)
  if (req.method === 'GET' && url === '/posts') {
    const now = Math.floor(Date.now() / 1000);
    const fresh = posts.filter(p => !p.t || (now - p.t) < 120);
    posts = fresh; // clean in memory too
    respond(res, 200, { posts });
    return;
  }

  // POST /posts/clean — receive cleaned list from client
  if (req.method === 'POST' && url === '/posts/clean') {
    getBody(req, (body) => {
      if (body && Array.isArray(body.posts)) posts = body.posts;
      respond(res, 200, { ok: true });
    });
    return;
  }

  // POST /posts — add or update a trade post
  if (req.method === 'POST' && url === '/posts') {
    getBody(req, (body) => {
      if (!body || !body.n || !body.h || !body.w) {
        respond(res, 400, { error: 'Missing fields' });
        return;
      }
      // Remove old post from same player
      posts = posts.filter(p => p.n !== body.n);
      // Add new post at top
      posts.unshift({ n: body.n, h: body.h, w: body.w, nt: body.nt || '', t: Date.now() });
      // Keep max 100 posts
      if (posts.length > 100) posts = posts.slice(0, 100);
      respond(res, 200, { ok: true });
    });
    return;
  }

  // GET /chat?room=ROOMID — fetch messages for a room
  if (req.method === 'GET' && url.startsWith('/chat')) {
    const room = new URLSearchParams(url.split('?')[1] || '').get('room');
    if (!room) { respond(res, 400, { error: 'Missing room' }); return; }
    respond(res, 200, { msgs: rooms[room] || [] });
    return;
  }

  // POST /chat — send a message
  if (req.method === 'POST' && url === '/chat') {
    getBody(req, (body) => {
      if (!body || !body.room || !body.s || !body.t) {
        respond(res, 400, { error: 'Missing fields' });
        return;
      }
      if (!rooms[body.room]) rooms[body.room] = [];
      rooms[body.room].push({ s: body.s, t: body.t, tm: Date.now() });
      // Keep max 200 msgs per room
      if (rooms[body.room].length > 200) rooms[body.room].shift();
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

server.listen(PORT, () => {
  console.log(`Azure Duels server running on port ${PORT}`);
});
