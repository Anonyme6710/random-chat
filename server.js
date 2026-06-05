const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// File d'attente et paires
let waitingUser = null;
const pairs = {}; // socketId -> socketId

io.on('connection', (socket) => {

  // Recherche d'un partenaire
  socket.on('find', () => {
    if (waitingUser && waitingUser.id !== socket.id) {
      // Paire trouvée
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

  // Message
  socket.on('message', (msg) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('message', { text: msg, self: false });
    }
  });

  // Quitter le chat
  socket.on('leave', () => {
    disconnect(socket);
  });

  // Déconnexion
  socket.on('disconnect', () => {
    disconnect(socket);
  });

  function disconnect(socket) {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner_left');
      delete pairs[partnerId];
    }
    delete pairs[socket.id];

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
