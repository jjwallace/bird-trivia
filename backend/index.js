import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import os from "os";
import { readFileSync } from "fs";

const questions = JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf-8"));

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

app.get("/api/ip", (req, res) => {
  res.json({ ip: getLanIp() });
});

// --- Player state ---
const players = {};
let nextColorIndex = 0;
const PLAYER_COLORS = 8;
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 800;
const MAX_SPEED = 8;
const FRICTION = 0.85;
const TICK_RATE = 1000 / 30;

// --- Trivia state ---
const QUESTION_TIMER = 15;
const ANSWER_DELAY = 3000;
const REVEAL_DELAY = 3000;
const TOTAL_QUESTIONS = 10;
const COUNTDOWN_SECONDS = 30;

const SMOKE_KEYS = ["01", "02", "03", "04", "05", "07", "09", "10", "11", "12", "13"];

let triviaState = {
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
};

function prepareQuestion(index) {
  const q = questions[index];
  const answers = [q.correct, ...q.wrong];
  for (let i = answers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }
  const correctIndex = answers.indexOf(q.correct);
  return { question: q.question, answers, correctIndex };
}

function startTrivia() {
  triviaState.active = true;
  triviaState.currentIndex = -1;
  triviaState.phase = "countdown";
  for (const p of Object.values(players)) p.score = 0;

  triviaState.timeLeft = COUNTDOWN_SECONDS;
  io.emit("trivia:countdown", { timeLeft: triviaState.timeLeft });

  triviaState.countdownTimer = setInterval(() => {
    triviaState.timeLeft--;
    io.emit("trivia:countdown", { timeLeft: triviaState.timeLeft });

    if (triviaState.timeLeft <= 0) {
      clearInterval(triviaState.countdownTimer);
      triviaState.countdownTimer = null;
      triviaState.phase = "idle";
      nextQuestion();
    }
  }, 1000);
}

function skipCountdown() {
  if (triviaState.phase !== "countdown") return;
  clearInterval(triviaState.countdownTimer);
  triviaState.countdownTimer = null;
  io.emit("trivia:countdown", { timeLeft: 0 });
  triviaState.phase = "idle";
  nextQuestion();
}

function nextQuestion() {
  triviaState.currentIndex++;
  if (triviaState.currentIndex >= TOTAL_QUESTIONS) {
    endTrivia();
    return;
  }

  triviaState.phase = "showing";
  triviaState.answers = {};
  triviaState.currentQuestion = prepareQuestion(triviaState.currentIndex);

  const smokeKey = SMOKE_KEYS[Math.floor(Math.random() * SMOKE_KEYS.length)];

  io.emit("trivia:question", {
    index: triviaState.currentIndex,
    total: TOTAL_QUESTIONS,
    question: triviaState.currentQuestion.question,
    smokeKey
  });

  triviaState.delayTimeout = setTimeout(() => {
    triviaState.phase = "answering";
    triviaState.timeLeft = QUESTION_TIMER;

    io.emit("trivia:answers", {
      answers: triviaState.currentQuestion.answers
    });

    io.emit("trivia:timer", { timeLeft: triviaState.timeLeft });

    triviaState.timer = setInterval(() => {
      triviaState.timeLeft--;
      io.emit("trivia:timer", { timeLeft: triviaState.timeLeft });

      if (triviaState.timeLeft <= 0) {
        clearInterval(triviaState.timer);
        triviaState.timer = null;
        revealAnswer();
      }
    }, 1000);
  }, ANSWER_DELAY);
}

function revealAnswer() {
  triviaState.phase = "reveal";

  const correct = triviaState.currentQuestion.correctIndex;

  const wrongPlayerIds = [];
  for (const [socketId, answerIndex] of Object.entries(triviaState.answers)) {
    if (answerIndex === correct && players[socketId]) {
      players[socketId].score++;
    } else if (players[socketId]) {
      wrongPlayerIds.push(socketId);
    }
  }

  // Players who didn't answer at all also count as wrong
  for (const id of Object.keys(players)) {
    if (triviaState.answers[id] === undefined) {
      wrongPlayerIds.push(id);
    }
  }

  io.emit("trivia:reveal", {
    correctIndex: correct,
    wrongPlayerIds,
    scores: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, p.score])
    )
  });

  triviaState.revealTimeout = setTimeout(() => {
    nextQuestion();
  }, REVEAL_DELAY);
}

function endTrivia() {
  triviaState.phase = "ended";
  triviaState.active = false;

  io.emit("trivia:end", {
    scores: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, { name: p.name, score: p.score }])
    )
  });
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("player:join", ({ name }) => {
    const colorIndex = nextColorIndex % PLAYER_COLORS;
    nextColorIndex++;
    const player = {
      name: name.trim().substring(0, 16),
      x: Math.floor(Math.random() * (CANVAS_WIDTH - 100)) + 50,
      y: Math.floor(Math.random() * (CANVAS_HEIGHT - 100)) + 50,
      vx: 0,
      vy: 0,
      score: 0,
      inputActive: false,
      colorIndex
    };
    players[socket.id] = player;
    console.log(`Player joined: ${player.name} (${socket.id})`);

    socket.emit("player:joined", {
      id: socket.id,
      name: player.name,
      x: player.x,
      y: player.y,
      colorIndex
    });
  });

  socket.on("player:move", ({ angle, strength }) => {
    const player = players[socket.id];
    if (!player) return;

    // Server clamps strength to [0, 1]
    const s = Math.min(Math.max(strength, 0), 1);
    player.vx = Math.cos(angle) * s * MAX_SPEED;
    player.vy = Math.sin(angle) * s * MAX_SPEED;
    player.inputActive = true;
  });

  socket.on("player:move-stop", () => {
    const player = players[socket.id];
    if (!player) return;
    player.inputActive = false;
  });

  socket.on("player:vfx", ({ type }) => {
    const player = players[socket.id];
    if (!player) return;
    io.emit("vfx:play", { type, x: player.x, y: player.y, playerId: socket.id });

    // Hit detection: shape VFX hits nearby players
    if (type === "shape") {
      const HIT_RADIUS = 120;
      for (const [id, other] of Object.entries(players)) {
        if (id === socket.id) continue;
        const dx = other.x - player.x;
        const dy = other.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < HIT_RADIUS) {
          io.emit("player:hit", { playerId: id });
        }
      }
    }
  });

  socket.on("game:start", () => {
    if (!triviaState.active) {
      startTrivia();
    }
  });

  socket.on("game:skip-countdown", () => {
    skipCountdown();
  });

  socket.on("trivia:answer", ({ answerIndex }) => {
    if (triviaState.phase !== "answering") return;
    if (triviaState.answers[socket.id] !== undefined) return;
    if (!players[socket.id]) return;

    triviaState.answers[socket.id] = answerIndex;

    io.emit("trivia:player-answered", { playerId: socket.id });

    const playerIds = Object.keys(players);
    const allAnswered = playerIds.every((id) => triviaState.answers[id] !== undefined);
    if (allAnswered) {
      clearInterval(triviaState.timer);
      triviaState.timer = null;
      revealAnswer();
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit("player:disconnected", { id: socket.id });
    }
  });
});

// --- Game loop ---
setInterval(() => {
  for (const player of Object.values(players)) {
    // Apply friction when joystick is released
    if (!player.inputActive) {
      player.vx *= FRICTION;
      player.vy *= FRICTION;

      // Stop completely when very slow
      if (Math.abs(player.vx) < 0.1 && Math.abs(player.vy) < 0.1) {
        player.vx = 0;
        player.vy = 0;
      }
    }

    // Apply velocity to position
    player.x += player.vx;
    player.y += player.vy;

    // Clamp to bounds
    player.x = Math.max(20, Math.min(CANVAS_WIDTH - 20, player.x));
    player.y = Math.max(20, Math.min(CANVAS_HEIGHT - 20, player.y));
  }

  if (Object.keys(players).length > 0) {
    io.emit("players:update", players);
  }
}, TICK_RATE);

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`LAN IP: ${getLanIp()}`);
});
