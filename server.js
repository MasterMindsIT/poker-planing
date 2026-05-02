const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto'); // Módulo nativo para encriptar y UUID

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Contraseña encriptada en SHA-256 (La contraseña original es "scrum123")
const SCRUM_PASSWORD_HASH = crypto.createHash('sha256').update('scrum123').digest('hex');

const rooms = {};

io.on('connection', (socket) => {

    // 1. El Scrum Master crea la sala con contraseña
    socket.on('create_room', ({ username, roomName, password }) => {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        
        if (hash !== SCRUM_PASSWORD_HASH) {
            socket.emit('error_msg', 'Contraseña incorrecta. Acceso denegado.');
            return;
        }

        const roomId = crypto.randomUUID(); // Genera URL segura
        rooms[roomId] = { name: roomName, users: {}, scrumMaster: socket.id, revealed: false };
        
        socket.join(roomId);
        rooms[roomId].users[socket.id] = { username, vote: null, id: socket.id };
        
        socket.emit('joined', { roomId, roomName, isScrumMaster: true });
        io.to(roomId).emit('update_users', getRoomState(roomId));
    });

    // 2. Los invitados entran con el UUID de la URL
    socket.on('join', ({ username, roomId }) => {
        if (!rooms[roomId]) {
            socket.emit('error_msg', 'La sala no existe o el enlace caducó.');
            return;
        }
        if (Object.keys(rooms[roomId].users).length >= 15) {
            socket.emit('error_msg', 'La sala está llena (máximo 15 usuarios).');
            return;
        }

        socket.join(roomId);
        rooms[roomId].users[socket.id] = { username, vote: null, id: socket.id };
        
        socket.emit('joined', { roomId, roomName: rooms[roomId].name, isScrumMaster: false });
        io.to(roomId).emit('update_users', getRoomState(roomId));
    });

    socket.on('vote', (voteValue) => {
        const roomId = getRoomBySocket(socket.id);
        if (roomId && rooms[roomId] && !rooms[roomId].revealed) {
            rooms[roomId].users[socket.id].vote = voteValue;
            io.to(roomId).emit('update_users', getRoomState(roomId));
        }
    });

    socket.on('reveal', () => {
        const roomId = getRoomBySocket(socket.id);
        if (roomId && rooms[roomId] && rooms[roomId].scrumMaster === socket.id) {
            rooms[roomId].revealed = true;
            io.to(roomId).emit('update_users', getRoomState(roomId));
        }
    });

    socket.on('reset', () => {
        const roomId = getRoomBySocket(socket.id);
        if (roomId && rooms[roomId] && rooms[roomId].scrumMaster === socket.id) {
            rooms[roomId].revealed = false;
            for (let id in rooms[roomId].users) rooms[roomId].users[id].vote = null;
            io.to(roomId).emit('update_users', getRoomState(roomId));
            io.to(roomId).emit('reset_vote_ui');
        }
    });

    socket.on('end_room', () => {
        const roomId = getRoomBySocket(socket.id);
        if (roomId && rooms[roomId] && rooms[roomId].scrumMaster === socket.id) {
            io.to(roomId).emit('room_ended');
            io.in(roomId).socketsLeave(roomId);
            delete rooms[roomId];
        }
    });

    socket.on('disconnect', () => {
        const roomId = getRoomBySocket(socket.id);
        if (roomId && rooms[roomId]) {
            delete rooms[roomId].users[socket.id];
            
            if (Object.keys(rooms[roomId].users).length === 0) {
                delete rooms[roomId]; // Se borra la sala si no queda nadie
            } else if (rooms[roomId].scrumMaster === socket.id) {
                rooms[roomId].scrumMaster = Object.keys(rooms[roomId].users)[0];
                io.to(rooms[roomId].scrumMaster).emit('make_scrum_master');
                io.to(roomId).emit('update_users', getRoomState(roomId));
            } else {
                io.to(roomId).emit('update_users', getRoomState(roomId));
            }
        }
    });
});

function getRoomBySocket(socketId) {
    for (const roomId in rooms) {
        if (rooms[roomId].users[socketId]) return roomId;
    }
    return null;
}

function getRoomState(roomId) {
    const state = { users: [], revealed: rooms[roomId].revealed };
    for (let id in rooms[roomId].users) {
        const u = rooms[roomId].users[id];
        state.users.push({
            id: u.id, username: u.username, hasVoted: u.vote !== null,
            vote: rooms[roomId].revealed ? u.vote : null 
        });
    }
    return state;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
