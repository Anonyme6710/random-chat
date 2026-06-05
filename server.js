const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10e6 });

app.use(express.static(path.join(__dirname, 'public')));

// waitingQueues: { 2: [socket, ...], 3: [socket, ...], 0: [socket, ...] }
const waitingQueues = { 2: [], 3: [], 4: [], 0: [] };
// rooms: { roomId: Set of socketIds }
const rooms = {};
// socketRoom: socketId -> roomId
const socketRoom = {};

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

  socket.on('find', (size) => {
    // size: 2, 3, 4, 0 (0 = infini/random up to 6)
    const queueSize = [2, 3, 4, 0].includes(size) ? size : 2;
    const needed = queueSize === 0 ? (2 + Math.floor(Math.random() * 5)) : queueSize;

    // Remove from any existing queue
    Object.keys(waitingQueues).forEach(k => {
      waitingQueues[k] = waitingQueues[k].filter(s => s.id !== socket.id);
    });

    waitingQueues[queueSize].push({ socket, needed });
    socket.emit('waiting');

    // Check if we can form a room
    const queue = waitingQueues[queueSize];
    // Group by 'needed' value
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
        // Remove from main queue
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
    if (roomId) broadcastToRoom(roomId, 'message', { text: msg }, socket.id);
  });

  socket.on('image', (data) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'image', data, socket.id);
  });

  socket.on('audio', (data) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'audio', data, socket.id);
  });

  socket.on('typing', (isTyping) => {
    const roomId = socketRoom[socket.id];
    if (roomId) broadcastToRoom(roomId, 'typing', { id: socket.id, isTyping }, socket.id);
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
    Object.keys(waitingQueues).forEach(k => {
      waitingQueues[k] = waitingQueues[k].filter(e => e.socket.id !== socket.id);
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
