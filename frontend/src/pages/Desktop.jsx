import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { Howl } from "howler";
import { QRCodeSVG } from "qrcode.react";
import socket from "../socket";
import sfx from "../sfx";
import { FRONTEND_URL } from "../config";
import GameCanvas from "../components/GameCanvas";

const music = new Howl({
  src: ["/assets/music1.mp3"],
  loop: true,
  volume: 0.4
});

const PHRASES = [
  "Make a game about your company culture",
  "Make a game about your product roadmap",
  "Make a game about your onboarding process",
  "Make a game about your company values",
  "Make a game about your quarterly goals",
  "Make a game about your team's inside jokes",
  "Make a game about your team's pets",
  "Make a game about your brand guidelines",
  "Make a game about your founding story"
];

const SAMPLE_GAME = JSON.stringify({
  title: "My Custom Game",
  questions: [
    {
      question: "What is the capital of France?",
      correct: "Paris",
      wrong: ["London", "Berlin", "Madrid"]
    },
    {
      question: "Which planet is known as the Red Planet?",
      correct: "Mars",
      wrong: ["Venus", "Jupiter", "Saturn"]
    },
    {
      question: "What year did the Titanic sink?",
      correct: "1912",
      wrong: ["1905", "1920", "1898"]
    }
  ]
}, null, 2);

const STORAGE_KEY = "triviabird-custom-games";

function loadSavedGames() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveGame(title, questions) {
  const games = loadSavedGames();
  const existing = games.findIndex((g) => g.title === title);
  if (existing !== -1) {
    games[existing].questions = questions;
  } else {
    games.push({ title, questions });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  return games;
}

export default function Desktop() {
  const { roomCode: urlRoomCode } = useParams();
  const navigate = useNavigate();

  const [connected, setConnected] = useState(socket.connected);
  const [roomCode, setRoomCode] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [playerNames, setPlayerNames] = useState([]);
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [levels, setLevels] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customJson, setCustomJson] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customError, setCustomError] = useState("");
  const [savedGames, setSavedGames] = useState(loadSavedGames);
  const [activeSavedGame, setActiveSavedGame] = useState(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const lobbyRef = useRef(null);
  const qrRef = useRef(null);
  const scrollRef = useRef(null);
  const phraseRef = useRef(null);

  // Create or join room on mount
  useEffect(() => {
    const init = () => {
      if (urlRoomCode) {
        socket.emit("room:join", { roomCode: urlRoomCode }, (res) => {
          if (res.error) {
            // Room doesn't exist, create fresh
            socket.emit("room:create", (r) => {
              setRoomCode(r.roomCode);
              navigate(`/room/${r.roomCode}`, { replace: true });
            });
          } else {
            setRoomCode(res.roomCode);
          }
        });
      } else {
        socket.emit("room:create", (res) => {
          setRoomCode(res.roomCode);
          navigate(`/room/${res.roomCode}`, { replace: true });
        });
      }
    };
    if (socket.connected) {
      init();
    } else {
      socket.once("connect", init);
    }
    return () => socket.off("connect", init);
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // Rotating phrase cycle (re-run when levels load so the ref exists)
  useEffect(() => {
    const el = phraseRef.current;
    if (!el) return;
    let idx = 0;
    el.textContent = PHRASES[0];
    const cycle = () => {
      gsap.to(el, {
        opacity: 0,
        duration: 0.6,
        ease: "power2.in",
        onComplete: () => {
          idx = (idx + 1) % PHRASES.length;
          el.textContent = PHRASES[idx];
          gsap.to(el, { opacity: 1, duration: 0.6, ease: "power2.out" });
        }
      });
    };
    const interval = setInterval(cycle, 4000);
    return () => clearInterval(interval);
  }, [levels]);

  // Infinite auto-scroll marquee with hover acceleration
  useEffect(() => {
    const refs = [scrollRef];
    const cleanups = [];
    for (const ref of refs) {
      const el = ref.current;
      if (!el) continue;
      const BASE_SPEED = 0.5;
      const HOVER_ACCEL = 0.12;
      const HOVER_FRICTION = 0.92;
      const MAX_BOOST = 4;
      let boost = 0;
      let hoverDir = 0;
      let raf = 0;

      const tick = () => {
        if (hoverDir !== 0) {
          boost += hoverDir * HOVER_ACCEL;
          boost = Math.max(-MAX_BOOST, Math.min(MAX_BOOST, boost));
        } else {
          boost *= HOVER_FRICTION;
          if (Math.abs(boost) < 0.01) boost = 0;
        }
        el.scrollLeft += BASE_SPEED + boost;
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
        if (el.scrollLeft < 0) el.scrollLeft += half;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      const onMove = (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const zone = 120;
        if (x < zone) {
          hoverDir = -(1 - x / zone);
        } else if (x > rect.width - zone) {
          hoverDir = 1 - (rect.width - x) / zone;
        } else {
          hoverDir = 0;
        }
      };
      const onLeave = () => { hoverDir = 0; };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [levels]);

  const prevPlayerCountRef = useRef(0);

  useEffect(() => {
    const onPlayersUpdate = (players) => {
      const entries = Object.values(players);
      const newCount = entries.length;
      if (newCount > prevPlayerCountRef.current) sfx.play("player-join");
      prevPlayerCountRef.current = newCount;
      setPlayerCount(newCount);
      setPlayerNames(entries.map((p) => p.name));
    };

    const onPlayerDisconnected = () => {
      sfx.play("player-disconnect");
      prevPlayerCountRef.current = Math.max(0, prevPlayerCountRef.current - 1);
      setPlayerCount((prev) => Math.max(0, prev - 1));
    };

    const onCountdown = ({ timeLeft }) => setCountdown(timeLeft > 0 ? timeLeft : null);

    const onLevelsList = ({ levels: lvls, current }) => {
      setLevels(lvls);
      setSelectedLevel(current);
    };

    const onLevelSelected = ({ levelId }) => setSelectedLevel(levelId);

    socket.on("players:update", onPlayersUpdate);
    socket.on("player:disconnected", onPlayerDisconnected);
    socket.on("trivia:countdown", onCountdown);
    socket.on("levels:list", onLevelsList);
    socket.on("levels:selected", onLevelSelected);

    return () => {
      socket.off("players:update", onPlayersUpdate);
      socket.off("player:disconnected", onPlayerDisconnected);
      socket.off("trivia:countdown", onCountdown);
      socket.off("levels:list", onLevelsList);
      socket.off("levels:selected", onLevelSelected);
    };
  }, []);

  const handleStart = () => {
    if (started) return;
    setStarted(true);

    const qrEl = qrRef.current;
    const tl = gsap.timeline();

    tl.to(lobbyRef.current, {
      opacity: 0,
      duration: 0.5,
      ease: "power2.in",
      onComplete: () => { lobbyRef.current.style.display = "none"; }
    });

    tl.to(document.body, { background: "#000", duration: 0.5, ease: "power2.in" }, "<");

    tl.to(qrEl, {
      scale: 0.5,
      opacity: 0.8,
      duration: 0.6,
      ease: "power2.inOut",
      onComplete: () => {
        gsap.set(qrEl, { clearProps: "all" });
        qrEl.classList.add("qr-fixed");
      }
    }, "-=0.3");

    music.play();
    socket.emit("game:start");
  };

  // --- Custom game modal ---
  const validateQuestionsArray = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) {
      return { error: "\"questions\" must be a non-empty array." };
    }
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      if (!q.question || typeof q.question !== "string") {
        return { error: `Question ${i + 1}: missing "question" string.` };
      }
      if (!q.correct || typeof q.correct !== "string") {
        return { error: `Question ${i + 1}: missing "correct" string.` };
      }
      if (!Array.isArray(q.wrong) || q.wrong.length < 1) {
        return { error: `Question ${i + 1}: "wrong" must be an array with at least 1 answer.` };
      }
      for (let j = 0; j < q.wrong.length; j++) {
        if (typeof q.wrong[j] !== "string") {
          return { error: `Question ${i + 1}: wrong[${j}] must be a string.` };
        }
      }
    }
    return { questions: arr };
  };

  const validateCustomGame = (text) => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "Invalid JSON. Make sure the formatting is correct." };
    }
    // Support both { title, questions } and bare array
    if (Array.isArray(parsed)) {
      return validateQuestionsArray(parsed);
    }
    if (parsed && typeof parsed === "object" && parsed.questions) {
      const result = validateQuestionsArray(parsed.questions);
      if (result.error) return result;
      return { title: parsed.title || "", questions: result.questions };
    }
    return { error: "Must be a { title, questions } object or an array of questions." };
  };

  const handleCustomSubmit = () => {
    const result = validateCustomGame(customJson);
    if (result.error) {
      setCustomError(result.error);
      return;
    }
    const title = customTitle.trim() || result.title || "";
    if (title) {
      const updated = saveGame(title, result.questions);
      setSavedGames(updated);
    }
    socket.emit("game:custom-questions", { questions: result.questions });
    setCustomError("");
    setShowCustomModal(false);
    setCustomJson("");
    setCustomTitle("");
  };

  const handleLoadSaved = (game) => {
    setActiveSavedGame(game.title);
    setSelectedLevel("");
    socket.emit("game:custom-questions", { questions: game.questions });
  };

  const handleDeleteSaved = (title) => {
    const games = loadSavedGames().filter((g) => g.title !== title);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    setSavedGames(games);
    if (activeSavedGame === title) setActiveSavedGame(null);
  };

  const handleCopySample = () => {
    navigator.clipboard.writeText(SAMPLE_GAME);
  };

  const visibleLevels = levels;

  const selectLevel = (id) => {
    setSelectedLevel(id);
    setActiveSavedGame(null);
    socket.emit("game:select-level", { levelId: id });
  };

  const mobileUrl = roomCode ? `${FRONTEND_URL}/mobile/${roomCode}` : `${FRONTEND_URL}/mobile`;

  return (
    <div className="page">
      {started && <GameCanvas />}
      {countdown !== null && (
        <button className="skip-button" onClick={() => socket.emit("game:skip-countdown")}>
          Start Now
        </button>
      )}
      <div ref={lobbyRef} className="lobby-content">
        <img src="/assets/title.png" className="title" alt="Trivia Bird" />
        {roomCode && <p className="room-code">Room: {roomCode}</p>}
        <p>Players: {playerCount}</p>
        {playerNames.length > 0 && (
          <ul className="player-list">
            {playerNames.map((name, i) => (
              <li key={i} className="player-list-item">{name}</li>
            ))}
          </ul>
        )}
        <button className="start-button" onClick={handleStart} disabled={playerCount === 0}>
          Start Game
        </button>
        <p className={`status ${connected ? "connected" : ""}`}>
          Socket: {connected ? "Connected" : "Disconnected"}
        </p>
      </div>
      <div ref={qrRef} className="qr-container">
        <QRCodeSVG value={mobileUrl} size={Math.min(256, window.innerHeight * 0.22)} />
      </div>
      {!started && levels.length > 0 && (
        <div className="category-area">
          <div className="category-strip" ref={scrollRef}>
            {[...visibleLevels, ...visibleLevels].map((l, i) => (
              <button
                key={`${l.id}-${i}`}
                className={`category-chip${selectedLevel === l.id ? " category-chip-selected" : ""}`}
                onClick={() => selectLevel(l.id)}
              >
                {l.name}
              </button>
            ))}
          </div>
          {savedGames.length > 0 && (
            <div className="saved-games-row">
              {savedGames.map((g) => (
                <button
                  key={g.title}
                  className={`saved-game-chip${activeSavedGame === g.title ? " saved-game-selected" : ""}`}
                  onClick={() => handleLoadSaved(g)}
                >
                  {g.title}
                  <span
                    className="saved-game-delete"
                    onClick={(e) => { e.stopPropagation(); handleDeleteSaved(g.title); }}
                  >
                    &times;
                  </span>
                </button>
              ))}
            </div>
          )}
          <button className="custom-game-btn" onClick={() => setShowCustomModal(true)}>
            Custom Game
          </button>
          <p ref={phraseRef} className="rotating-phrase">{PHRASES[0]}</p>
        </div>
      )}

      {/* Custom Game Modal */}
      {showCustomModal && (
        <div className="modal-overlay" onClick={() => setShowCustomModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Custom Game</h2>
            <p className="modal-desc">
              Copy the sample below and hand it to your favorite LLM along with any docs, topics, or inside jokes you want to quiz on. Ask it to generate questions with whatever personality you like — serious, silly, sarcastic — then paste the result back here.
            </p>
            <div className="modal-sample">
              <div className="modal-sample-header">
                <span>Sample format</span>
                <button className="modal-copy-btn" onClick={handleCopySample}>Copy Sample</button>
              </div>
              <pre className="modal-pre">{SAMPLE_GAME}</pre>
            </div>
            <input
              className="modal-title-input"
              type="text"
              placeholder="Game title (to save for later)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              maxLength={40}
            />
            <textarea
              className="modal-textarea"
              rows={10}
              placeholder="Paste your JSON questions here..."
              value={customJson}
              onChange={(e) => { setCustomJson(e.target.value); setCustomError(""); }}
            />
            {customError && <p className="modal-error">{customError}</p>}
            <div className="modal-actions">
              <button className="modal-cancel-btn" onClick={() => setShowCustomModal(false)}>Cancel</button>
              <button className="modal-submit-btn" onClick={handleCustomSubmit}>Load Questions</button>
            </div>
          </div>
        </div>
      )}
      <p className="privacy-link" onClick={() => setShowPrivacy(true)}>Privacy Policy</p>

      {showPrivacy && (
        <div className="modal-overlay" onClick={() => setShowPrivacy(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Privacy Policy</h2>
            <div className="privacy-body">
              <p>Trivia Bird is a real-time multiplayer trivia game. Here is how we handle your data:</p>
              <h3>Data We Collect</h3>
              <p>We collect only the display name you enter when joining a game. No accounts, emails, or passwords are required.</p>
              <h3>How It Works</h3>
              <p>All game data (player names, positions, scores) is held in server memory for the duration of your game session. When the room is empty, all data is permanently deleted.</p>
              <h3>Custom Games</h3>
              <p>If you paste custom trivia questions, they are stored in server memory only while the game room is active. They are never saved to disk or shared with third parties.</p>
              <h3>Cookies &amp; Tracking</h3>
              <p>We do not use cookies, analytics, or any third-party tracking services.</p>
              <h3>Contact</h3>
              <p>Questions? Reach out to the team that shared this game with you.</p>
            </div>
            <div className="modal-actions">
              <button className="modal-submit-btn" onClick={() => setShowPrivacy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
