import { useState, useEffect, useRef } from "react";
import gsap from "gsap";
import { Howl } from "howler";
import { QRCodeSVG } from "qrcode.react";
import socket from "../socket";
import sfx from "../sfx";
import { MOBILE_URL } from "../config";
import GameCanvas from "../components/GameCanvas";

const music = new Howl({
  src: ["/assets/music1.mp3"],
  loop: true,
  volume: 0.4
});

export default function Desktop() {
  const [connected, setConnected] = useState(socket.connected);
  const [playerCount, setPlayerCount] = useState(0);
  const [playerNames, setPlayerNames] = useState([]);
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(null);

  const lobbyRef = useRef(null);
  const qrRef = useRef(null);

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

  const prevPlayerCountRef = useRef(0);

  useEffect(() => {
    const onPlayersUpdate = (players) => {
      const entries = Object.values(players);
      const newCount = entries.length;
      if (newCount > prevPlayerCountRef.current) {
        sfx.play("player-join");
      }
      prevPlayerCountRef.current = newCount;
      setPlayerCount(newCount);
      setPlayerNames(entries.map((p) => p.name));
    };

    const onPlayerDisconnected = () => {
      sfx.play("player-disconnect");
      prevPlayerCountRef.current = Math.max(0, prevPlayerCountRef.current - 1);
      setPlayerCount((prev) => Math.max(0, prev - 1));
    };

    const onCountdown = ({ timeLeft }) => {
      setCountdown(timeLeft > 0 ? timeLeft : null);
    };

    socket.on("players:update", onPlayersUpdate);
    socket.on("player:disconnected", onPlayerDisconnected);
    socket.on("trivia:countdown", onCountdown);

    return () => {
      socket.off("players:update", onPlayersUpdate);
      socket.off("player:disconnected", onPlayerDisconnected);
      socket.off("trivia:countdown", onCountdown);
    };
  }, []);

  const handleStart = () => {
    if (started) return;
    setStarted(true);

    const qrEl = qrRef.current;
    const tl = gsap.timeline();

    // Fade out lobby content and body background together
    tl.to(lobbyRef.current, {
      opacity: 0,
      duration: 0.5,
      ease: "power2.in",
      onComplete: () => {
        lobbyRef.current.style.display = "none";
      }
    });

    tl.to(
      document.body,
      {
        background: "#000",
        duration: 0.5,
        ease: "power2.in"
      },
      "<"
    );

    // Shrink QR and snap to fixed position
    tl.to(
      qrEl,
      {
        scale: 0.5,
        opacity: 0.8,
        duration: 0.6,
        ease: "power2.inOut",
        onComplete: () => {
          gsap.set(qrEl, { clearProps: "all" });
          qrEl.classList.add("qr-fixed");
        }
      },
      "-=0.3"
    );

    music.play();
    socket.emit("game:start");
  };

  return (
    <div className="page">
      {started && <GameCanvas />}
      {countdown !== null && (
        <button
          className="skip-button"
          onClick={() => socket.emit("game:skip-countdown")}
        >
          Start Now
        </button>
      )}
      <div ref={lobbyRef} className="lobby-content">
        <h1>Trivia Bird</h1>
        <p>Players: {playerCount}</p>
        {playerNames.length > 0 && (
          <ul className="player-list">
            {playerNames.map((name, i) => (
              <li key={i} className="player-list-item">{name}</li>
            ))}
          </ul>
        )}
        <button
          className="start-button"
          onClick={handleStart}
          disabled={playerCount === 0}
        >
          Start Game
        </button>
        <p className={`status ${connected ? "connected" : ""}`}>
          Socket: {connected ? "Connected" : "Disconnected"}
        </p>
      </div>
      <div ref={qrRef} className="qr-container">
        <QRCodeSVG value={MOBILE_URL} size={256} />
      </div>
    </div>
  );
}
