import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import os from "os";
import path from "path";
import { readFileSync, existsSync } from "fs";
import crypto from "crypto";

// --- Load levels ---
const levelsDir = new URL("./levels/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("index.json", levelsDir), "utf-8"));
const levels = {};
for (const entry of manifest) {
  levels[entry.id] = JSON.parse(readFileSync(new URL(`${entry.id}.json`, levelsDir), "utf-8"));
}

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

app.get("/api/ip", (req, res) => res.json({ ip: getLanIp() }));

// In production, serve the built frontend
const frontendDist = path.resolve(new URL(".", import.meta.url).pathname, "../frontend/dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

// --- Constants ---
const PLAYER_COLORS = 8;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 800;
const MAX_SPEED = 8;
const FRICTION = 0.85;
const TICK_RATE = 1000 / 30;
const QUESTION_TIMER = 15;
const ANSWER_DELAY = 3000;
const REVEAL_DELAY = 3000;
const TOTAL_QUESTIONS = 10;
const COUNTDOWN_SECONDS = 30;
const SMOKE_KEYS = ["01", "02", "03", "04", "05", "07", "09", "10", "11", "12", "13"];

// --- Room management ---
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(2).toString("hex").toUpperCase();
  } while (rooms[code]);
  return code;
}

function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    players: {},
    nextColorIndex: 0,
    currentLevelId: manifest[0].id,
    currentQuestions: levels[manifest[0].id],
    customQuestions: null,
    triviaState: {
      active: false,
      currentIndex: -1,
      phase: "idle",
      answers: {},
      timer: null,
      delayTimeout: null,
      revealTimeout: null,
      countdownTimer: null,
      timeLeft: 0,
      currentQuestion: null
    },
    gameInterval: null
  };

  // Start game loop for this room
  room.gameInterval = setInterval(() => tickRoom(room), TICK_RATE);

  rooms[code] = room;
  console.log(`Room created: ${code}`);
  return room;
}

function destroyRoom(code) {
  const room = rooms[code];
  if (!room) return;
  clearInterval(room.gameInterval);
  const ts = room.triviaState;
  if (ts.timer) clearInterval(ts.timer);
  if (ts.delayTimeout) clearTimeout(ts.delayTimeout);
  if (ts.revealTimeout) clearTimeout(ts.revealTimeout);
  if (ts.countdownTimer) clearInterval(ts.countdownTimer);
  delete rooms[code];
  console.log(`Room destroyed: ${code}`);
}

function tickRoom(room) {
  for (const player of Object.values(room.players)) {
    if (!player.inputActive) {
      player.vx *= FRICTION;
      player.vy *= FRICTION;
      if (Math.abs(player.vx) < 0.1 && Math.abs(player.vy) < 0.1) {
        player.vx = 0;
        player.vy = 0;
      }
    }
    player.x += player.vx;
    player.y += player.vy;
    player.x = Math.max(20, Math.min(CANVAS_WIDTH - 20, player.x));
    player.y = Math.max(20, Math.min(CANVAS_HEIGHT - 20, player.y));
  }
  if (Object.keys(room.players).length > 0) {
    io.to(room.code).emit("players:update", room.players);
  }
}

function prepareQuestion(questions, index) {
  const q = questions[index];
  const answers = [q.correct, ...q.wrong];
  for (let i = answers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }
  return { question: q.question, answers, correctIndex: answers.indexOf(q.correct) };
}

function startTrivia(room) {
  const ts = room.triviaState;
  const questions = room.customQuestions || room.currentQuestions;
  ts.active = true;
  ts.currentIndex = -1;
  ts.phase = "countdown";
  for (const p of Object.values(room.players)) p.score = 0;

  ts.timeLeft = COUNTDOWN_SECONDS;
  io.to(room.code).emit("trivia:countdown", { timeLeft: ts.timeLeft });

  ts.countdownTimer = setInterval(() => {
    ts.timeLeft--;
    io.to(room.code).emit("trivia:countdown", { timeLeft: ts.timeLeft });
    if (ts.timeLeft <= 0) {
      clearInterval(ts.countdownTimer);
      ts.countdownTimer = null;
      ts.phase = "idle";
      nextQuestion(room);
    }
  }, 1000);
}

function skipCountdown(room) {
  const ts = room.triviaState;
  if (ts.phase !== "countdown") return;
  clearInterval(ts.countdownTimer);
  ts.countdownTimer = null;
  io.to(room.code).emit("trivia:countdown", { timeLeft: 0 });
  ts.phase = "idle";
  nextQuestion(room);
}

function nextQuestion(room) {
  const ts = room.triviaState;
  const questions = room.customQuestions || room.currentQuestions;
  const totalQ = Math.min(TOTAL_QUESTIONS, questions.length);
  ts.currentIndex++;
  if (ts.currentIndex >= totalQ) {
    endTrivia(room);
    return;
  }

  ts.phase = "showing";
  ts.answers = {};
  ts.currentQuestion = prepareQuestion(questions, ts.currentIndex);

  const smokeKey = SMOKE_KEYS[Math.floor(Math.random() * SMOKE_KEYS.length)];

  io.to(room.code).emit("trivia:question", {
    index: ts.currentIndex,
    total: totalQ,
    question: ts.currentQuestion.question,
    smokeKey
  });

  ts.delayTimeout = setTimeout(() => {
    ts.phase = "answering";
    ts.timeLeft = QUESTION_TIMER;

    io.to(room.code).emit("trivia:answers", { answers: ts.currentQuestion.answers });
    io.to(room.code).emit("trivia:timer", { timeLeft: ts.timeLeft });

    ts.timer = setInterval(() => {
      ts.timeLeft--;
      io.to(room.code).emit("trivia:timer", { timeLeft: ts.timeLeft });
      if (ts.timeLeft <= 0) {
        clearInterval(ts.timer);
        ts.timer = null;
        revealAnswer(room);
      }
    }, 1000);
  }, ANSWER_DELAY);
}

function revealAnswer(room) {
  const ts = room.triviaState;
  ts.phase = "reveal";
  const correct = ts.currentQuestion.correctIndex;

  const wrongPlayerIds = [];
  for (const [socketId, answerIndex] of Object.entries(ts.answers)) {
    if (answerIndex === correct && room.players[socketId]) {
      room.players[socketId].score++;
    } else if (room.players[socketId]) {
      wrongPlayerIds.push(socketId);
    }
  }
  for (const id of Object.keys(room.players)) {
    if (ts.answers[id] === undefined) wrongPlayerIds.push(id);
  }

  io.to(room.code).emit("trivia:reveal", {
    correctIndex: correct,
    wrongPlayerIds,
    scores: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [id, p.score])
    )
  });

  ts.revealTimeout = setTimeout(() => nextQuestion(room), REVEAL_DELAY);
}

function endTrivia(room) {
  const ts = room.triviaState;
  ts.phase = "ended";
  ts.active = false;
  room.customQuestions = null;

  io.to(room.code).emit("trivia:end", {
    scores: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [id, { name: p.name, score: p.score }])
    )
  });
}

// --- Socket handling ---
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let currentRoom = null;

  socket.on("room:create", (callback) => {
    const room = createRoom();
    currentRoom = room;
    socket.join(room.code);
    socket.emit("levels:list", { levels: manifest, current: room.currentLevelId });
    if (typeof callback === "function") callback({ roomCode: room.code });
    console.log(`${socket.id} created room ${room.code}`);
  });

  socket.on("room:join", ({ roomCode }, callback) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms[code];
    if (!room) {
      if (typeof callback === "function") callback({ error: "Room not found" });
      return;
    }
    currentRoom = room;
    socket.join(code);
    socket.emit("levels:list", { levels: manifest, current: room.currentLevelId });
    if (typeof callback === "function") callback({ roomCode: code });
    console.log(`${socket.id} joined room ${code}`);
  });

  socket.on("game:select-level", ({ levelId }) => {
    if (!currentRoom) return;
    if (levels[levelId] && !currentRoom.triviaState.active) {
      currentRoom.currentLevelId = levelId;
      currentRoom.currentQuestions = levels[levelId];
      currentRoom.customQuestions = null;
      io.to(currentRoom.code).emit("levels:selected", { levelId });
    }
  });

  socket.on("game:custom-questions", ({ questions }) => {
    if (!currentRoom || currentRoom.triviaState.active) return;
    currentRoom.customQuestions = questions;
    io.to(currentRoom.code).emit("levels:selected", { levelId: "__custom__" });
    console.log(`Room ${currentRoom.code} loaded ${questions.length} custom questions`);
  });

  socket.on("player:join", ({ name }) => {
    if (!currentRoom) return;
    const colorIndex = currentRoom.nextColorIndex % PLAYER_COLORS;
    currentRoom.nextColorIndex++;
    const player = {
      name: name.trim().substring(0, 16),
      x: Math.floor(Math.random() * (CANVAS_WIDTH - 100)) + 50,
      y: Math.floor(Math.random() * (CANVAS_HEIGHT - 100)) + 50,
      vx: 0, vy: 0, score: 0, inputActive: false, colorIndex
    };
    currentRoom.players[socket.id] = player;
    console.log(`Player joined room ${currentRoom.code}: ${player.name}`);
    socket.emit("player:joined", { id: socket.id, name: player.name, x: player.x, y: player.y, colorIndex });
  });

  socket.on("player:move", ({ angle, strength }) => {
    if (!currentRoom) return;
    const player = currentRoom.players[socket.id];
    if (!player) return;
    const s = Math.min(Math.max(strength, 0), 1);
    player.vx = Math.cos(angle) * s * MAX_SPEED;
    player.vy = Math.sin(angle) * s * MAX_SPEED;
    player.inputActive = true;
  });

  socket.on("player:move-stop", () => {
    if (!currentRoom) return;
    const player = currentRoom.players[socket.id];
    if (player) player.inputActive = false;
  });

  socket.on("player:vfx", ({ type }) => {
    if (!currentRoom) return;
    const player = currentRoom.players[socket.id];
    if (!player) return;
    io.to(currentRoom.code).emit("vfx:play", { type, x: player.x, y: player.y, playerId: socket.id });

    if (type === "shape") {
      const HIT_RADIUS = 120;
      for (const [id, other] of Object.entries(currentRoom.players)) {
        if (id === socket.id) continue;
        const dx = other.x - player.x;
        const dy = other.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) < HIT_RADIUS) {
          io.to(currentRoom.code).emit("player:hit", { playerId: id });
        }
      }
    }
  });

  socket.on("game:start", () => {
    if (currentRoom && !currentRoom.triviaState.active) startTrivia(currentRoom);
  });

  socket.on("game:skip-countdown", () => {
    if (currentRoom) skipCountdown(currentRoom);
  });

  socket.on("trivia:answer", ({ answerIndex }) => {
    if (!currentRoom) return;
    const ts = currentRoom.triviaState;
    if (ts.phase !== "answering") return;
    if (ts.answers[socket.id] !== undefined) return;
    if (!currentRoom.players[socket.id]) return;

    ts.answers[socket.id] = answerIndex;
    io.to(currentRoom.code).emit("trivia:player-answered", { playerId: socket.id });

    const playerIds = Object.keys(currentRoom.players);
    if (playerIds.every((id) => ts.answers[id] !== undefined)) {
      clearInterval(ts.timer);
      ts.timer = null;
      revealAnswer(currentRoom);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (currentRoom) {
      if (currentRoom.players[socket.id]) {
        delete currentRoom.players[socket.id];
        io.to(currentRoom.code).emit("player:disconnected", { id: socket.id });
      }
      // Destroy room if empty (no sockets left)
      const socketsInRoom = io.sockets.adapter.rooms.get(currentRoom.code);
      if (!socketsInRoom || socketsInRoom.size === 0) {
        destroyRoom(currentRoom.code);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`LAN IP: ${getLanIp()}`);
});
