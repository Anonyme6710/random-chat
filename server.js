const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10e6 });

app.use(express.static(path.join(__dirname, 'public')));

const waitingQueues = { 2: [], 3: [], 4: [], 0: [] };
const rooms = {};
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
    if (roomId) broadcastToRoom(roomId, 'message', { text: msg, from: socket.id }, socket.id);
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
