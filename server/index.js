require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const http       = require('http');
const { Server } = require('socket.io');
const { isURL }  = require('validator');
const { logMessage } = require('./chat-log');
const {
  applyModMiddleware,
  banUser,
  unbanUser,
  isBanned
} = require('./mods');


mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser:    true,
  useUnifiedTopology: true,
});
mongoose.connection
  .on('error', e => console.error('MongoDB error:', e))
  .once('open', () => console.log('✔ Connected to MongoDB'));

const app    = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

applyModMiddleware(io);
app.use(express.static('public'));

const QueueItemSchema = new mongoose.Schema({
  url:         { type: String, required: true },
  votes:       { type: Number, default: 0 },
  requestedBy: { type: String, required: true },
});
const RoomSchema = new mongoose.Schema({
  name:  { type: String, unique: true },
  queue: [QueueItemSchema],
});
const Room = mongoose.model('Room', RoomSchema);

// in-memory tracking of users per room
const roomUsers = {};

app.use(express.static('public'));

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('join', async (roomName, username) => {
    roomUsers[roomName] ||= [];
    roomUsers[roomName] = roomUsers[roomName].filter(u => u.socketId !== socket.id);

    if (roomUsers[roomName].some(u => u.username === username)) {
      socket.emit('name taken', username);
      return;
    }
socket.on('request users', () => {
  const names = roomUsers[currentRoom].map(u => u.username);
  io.in(currentRoom).emit('room users', names);
});

// … inside io.on('connection', socket => { … })
socket.on('ban user', targetUsername => {
  // 1) Verify mod
  const me = roomUsers[currentRoom]?.find(u => u.socketId === socket.id);
  if (!me?.isMod) {
    return socket.emit('error', 'Only moderators can ban.');
  }

  // 2) Find the victim’s socket by matching username
  const victim = roomUsers[currentRoom]
    ?.find(u => u.username === targetUsername);
  if (!victim) return;

  const victimSocket = io.sockets.sockets.get(victim.socketId);
  if (!victimSocket) return;

  // 3) Ban the IP
  const victimIP = victimSocket.handshake.address;
  banIP(victimIP);

  // 4) Notify & disconnect
  victimSocket.emit('banned', 'You have been banned.');
  victimSocket.disconnect();

  // 5) Notify the room (for UI)
  io.in(currentRoom).emit('user banned', targetUsername);
});

socket.on('change room', ({ oldRoom, newRoom }) => {
  socket.leave(oldRoom);
  socket.join(newRoom);
  io.in(newRoom).emit('room renamed', newRoom);
});

    const isMod = roomUsers[roomName].length === 0;
    currentRoom = roomName;
    socket.join(roomName);
    roomUsers[roomName].push({ socketId: socket.id, username, isMod });

    // broadcast users + mods
    io.in(roomName).emit('room users', roomUsers[roomName].map(u => u.username));
    io.in(roomName).emit('room mods', roomUsers[roomName].filter(u => u.isMod).map(u => u.username));

    // announce join
    io.in(roomName).emit('user joined', username);

    // load or create queue
    let room = await Room.findOne({ name: roomName });
    if (!room) room = await Room.create({ name: roomName, queue: [] });
    socket.emit('queue updated', room.queue);
  });
socket.on('kick user', targetUsername => {
  const me = roomUsers[currentRoom]?.find(u => u.socketId === socket.id);
  if (!me?.isMod) {
    return socket.emit('error', 'Only moderators can kick.');
  }

  const victim = roomUsers[currentRoom]
    ?.find(u => u.username === targetUsername);
  if (!victim) return;

  const vs = io.sockets.sockets.get(victim.socketId);
  if (vs) {
    vs.emit('kicked', 'You have been kicked by a moderator.');
    vs.disconnect();
  }

  io.in(currentRoom).emit('user kicked', targetUsername);
});

  socket.on('name change', ({ oldName, newName }) => {
    if (!currentRoom) return;
    const users = roomUsers[currentRoom] ||= [];

    if (users.some(u => u.username === newName && u.socketId !== socket.id)) {
      socket.emit('name taken', newName);
      return;
    }

    users.forEach(u => { if (u.socketId === socket.id) u.username = newName });
    io.in(currentRoom).emit('room users', users.map(u => u.username));
    io.in(currentRoom).emit('room mods', users.filter(u => u.isMod).map(u => u.username));
    io.in(currentRoom).emit('name change', { oldName, newName });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const before = roomUsers[currentRoom] || [];
    const me     = before.find(u => u.socketId === socket.id);
    const leaving = me?.username;

    let remaining = before.filter(u => u.socketId !== socket.id);
    if (!remaining.some(u => u.isMod) && remaining.length) remaining[0].isMod = true;
    roomUsers[currentRoom] = remaining;

    io.in(currentRoom).emit('room users', remaining.map(u => u.username));
    io.in(currentRoom).emit('room mods', remaining.filter(u => u.isMod).map(u => u.username));
    if (leaving) io.in(currentRoom).emit('user left', leaving);
  });

// B) Moderator-only “ban user” command
socket.on('ban user', targetUserId => {
  // … your mod‐check & banUser(targetUserId) …

  // ─── Make sure you have exactly these lines (and nothing that touches the DOM) ───
  const victim = Array.from(io.sockets.sockets.values())
    .find(s => s.handshake.auth.userId === targetUserId);
  if (victim) {
    victim.emit('banned', 'You have been banned by a moderator.');
    victim.disconnect();
  }
  io.in(currentRoom).emit('user banned', targetUserId);
  // ────────────────────────────────────────────────────────────────────────────────
});

  socket.on('request track', async ({ url, requestedBy }) => {
    if (!currentRoom) return;
    // basic sanitization
    if (!isURL(url, { protocols: ['http','https'], require_protocol: true })) return;
    const room = await Room.findOne({ name: currentRoom });
    room.queue.push({ url, requestedBy });
    await room.save();
    io.in(currentRoom).emit('queue updated', room.queue);
  });

  socket.on('vote track', async ({ idx, username }) => {
    if (!currentRoom) return;
    const room = await Room.findOne({ name: currentRoom });
    if (!room.queue[idx]) return;
    room.queue[idx].votes++;
    await room.save();
    io.in(currentRoom).emit('queue updated', room.queue);
    io.in(currentRoom).emit('user action', { type:'upvote', username, url: room.queue[idx].url });
  });

  socket.on('downvote track', async ({ idx, username }) => {
    if (!currentRoom) return;
    const room = await Room.findOne({ name: currentRoom });
    if (!room.queue[idx]) return;
    room.queue[idx].votes = Math.max(room.queue[idx].votes - 1, 0);
    await room.save();
    io.in(currentRoom).emit('queue updated', room.queue);
    io.in(currentRoom).emit('user action', { type:'downvote', username, url: room.queue[idx].url });
  });

  socket.on('play track', async ({ url }) => {
    if (!currentRoom) return;
    const room = await Room.findOne({ name: currentRoom });
    room.queue = room.queue.filter(i => i.url !== url);
    await room.save();
    io.in(currentRoom).emit('queue updated', room.queue);
    const startTime = Date.now() + 2000;
    io.in(currentRoom).emit('play track at', { url, startTime });
  });

  socket.on('track ended', async () => {
    if (!currentRoom) return;
    const room = await Room.findOne({ name: currentRoom });
    if (!room.queue.length) return;
    room.queue.shift();
    await room.save();
    io.in(currentRoom).emit('queue updated', room.queue);
    if (room.queue.length) {
      const nextUrl   = room.queue[0].url;
      const startTime = Date.now() + 2000;
      io.in(currentRoom).emit('play track at', { url: nextUrl, startTime });
    }
  });

  socket.on('force play track', ({ url }) => {
    if (!currentRoom) return;
    const me = (roomUsers[currentRoom]||[]).find(u => u.socketId===socket.id);
    if (!me?.isMod) return;
    Room.findOne({ name: currentRoom })
      .then(r => { r.queue = r.queue.filter(i=>i.url!==url); return r.save(); })
      .then(r => {
        io.in(currentRoom).emit('queue updated', r.queue);
        io.in(currentRoom).emit('play track at', { url, startTime: Date.now() });
      });
  });

  socket.on('chat message', ({ text, username }) => {
    if (!currentRoom) return;
    const timestamp = new Date().toISOString();
  logMessage({ user: username, message: text, timestamp });
    io.in(currentRoom).emit('chat message', { text, username });
  });

});

const PORT = process.env.PORT||3000;
server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
