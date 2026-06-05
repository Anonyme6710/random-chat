const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10e6 // 10MB pour les photos
});

app.use(express.static(path.join(__dirname, 'public')));

let waitingUser = null;
const pairs = {};

io.on('connection', (socket) => {

  socket.on('find', () => {
    if (waitingUser && waitingUser.id !== socket.id) {
      const partner = waitingUser;
      waitingUser = null;
      pairs[socket.id] = partner.id;
      pairs[partner.id] = socket.id;
      socket.emit('matched');
      partner.emit('matched');
    } else {
      waitingUser = socket;
      socket.emit('waiting');
    }
  });

  socket.on('message', (msg) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit('message', { text: msg });
  });

  socket.on('image', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit('image', data);
  });

  socket.on('audio', (data) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit('audio', data);
  });

  socket.on('typing', (isTyping) => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit('typing', isTyping);
  });

  socket.on('leave', () => disconnect(socket));
  socket.on('disconnect', () => disconnect(socket));

  function disconnect(socket) {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }
    delete pairs[socket.id];
    if (waitingUser && waitingUser.id === socket.id) waitingUser = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
