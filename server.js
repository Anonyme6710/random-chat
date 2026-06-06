const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// VAPID Keys
const VAPID_PUBLIC = 'BPe6Ygi4qNkXSB1EXJ_fA9JBb3mpLIjePFPiB-eA-JbEKiGzmfH1y0a_5bQbr0iiW6s3cXLNyltMfBRQvmLFfig';
const VAPID_PRIVATE = '1E0KcR54CXDKuNNA-CMd6fWGYpPGZtStI69DtwDw5gE';

webpush.setVapidDetails('mailto:contact@randomtalk.app', VAPID_PUBLIC, VAPID_PRIVATE);

// Store subscriptions: uid -> subscripion
const subscriptions = {};

// Push subscription endpoint
app.post('/api/subscribe', (req, res) => {
  const { uid, subscription } = req.body;
  if (!uid || !subscription) return res.status(400).json({ error: 'Missing data' });
  subscriptions[uid] = subscription;
  res.json({ success: true });
});

app.get('/api/vapidPublicKey', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// Send push to a user by uid
async function sendPushToUser(uid, title, body) {
  const sub = subscriptions[uid];
  if (!sub) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, url: '/' }));
  } catch(e) {
    if (e.statusCode === 410) delete subscriptions[uid]; // subscription expired
  }
}

// Export for use in socket events
app.locals.sendPushToUser = sendPushToUser;

// Random chat queues
const waitingQueues = { 2: [], 3: [], 4: [], 0: [] };
const rooms = {};
const socketRoom = {};
const socketUid = {}; // socketId -> firebase uid

function generateRoomId() {
  return Math.random().toString(36).substr(2, 9);
}

function broadcastToRoom(roomId, event, data, excludeId = null) {
  if (!rooms[roomId]) return;
  rooms[roomId].forEach(sid => {
    if (sid !== excludeId) io.to(sid).emit(event, data);
  });
}

io.on('connection', (socket) => {

  // Register firebase uid with socket
  socket.on('register_uid', (uid) => {
    if (uid) socketUid[socket.id] = uid;
  });

  socket.on('find', (size) => {
    const queueSize = [2, 3, 4, 0].includes(size) ? size : 2;
    const needed = queueSize === 0 ? (2 + Math.floor(Math.random() * 5)) : queueSize;

    Object.keys(waitingQueues).forEach(k => {
      waitingQueues[k] = waitingQueues[k].filter(s => s.socket.id !== socket.id);
    });

    waitingQueues[queueSize].push({ socket, needed });
    socket.emit('waiting');

    const queue = waitingQueues[queueSize];
    const groups = {};
    queue.forEach(entry => {
      const n = entry.needed;
      if (!groups[n]) groups[n] = [];
      groups[n].push(entry);
    });

    Object.keys(groups).forEach(n => {
      const group = groups[n];
      const neededCount = parseInt(n);
      if (group.length >= neededCount) {
        const members = group.splice(0, neededCount);
        waitingQueues[queueSize] = waitingQueues[queueSize].filter(
          e => !members.find(m => m.socket.id === e.socket.id)
        );
        const roomId = generateRoomId();
        rooms[roomId] = new Set(members.map(m => m.socket.id));
        members.forEach(m => {
          socketRoom[m.socket.id] = roomId;
          m.socket.emit('matched', { roomId, count: members.length });
        });
      }
    });
  });

  socket.on('message', (msg) => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    broadcastToRoom(roomId, 'message', { text: msg, from: socket.id }, socket.id);
    // Push notif to offline room members
    rooms[roomId] && rooms[roomId].forEach(sid => {
      if (sid !== socket.id) {
        const uid = socketUid[sid];
        if (uid) sendPushToUser(uid, '💬 RandomTalk', 'Nouveau message d\'un inconnu');
      }
    });
  });

  socket.on('image', (data) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'image', { data, from: socket.id }, socket.id);
  });

  socket.on('audio', (data) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'audio', { data, from: socket.id }, socket.id);
  });

  socket.on('typing', (isTyping) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'typing', { id: socket.id, isTyping }, socket.id);
  });

  // Friend message push notif
  socket.on('friend_message_sent', ({ toUid, fromPseudo }) => {
    sendPushToUser(toUid, `💬 ${fromPseudo}`, 'T\'a envoyé un message');
  });

  socket.on('leave', () => disconnect(socket));
  socket.on('disconnect', () => disconnect(socket));

  function disconnect(socket) {
    const roomId = socketRoom[socket.id];
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket.id);
      broadcastToRoom(roomId, 'partner_left', {});
      if (rooms[roomId].size === 0) delete rooms[roomId];
    }
    delete socketRoom[socket.id];
    delete socketUid[socket.id];
    Object.keys(waitingQueues).forEach(k => {
      waitingQueues[k] = waitingQueues[k].filter(e => e.socket.id !== socket.id);
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
