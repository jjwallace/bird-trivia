import { useState, useEffect, useRef, useCallback } from "react";
import gsap from "gsap";
import socket from "../socket";
import sfx from "../sfx";
import Joystick from "../components/Joystick";
import CelebrationOverlay from "../components/CelebrationOverlay";

export default function Mobile() {
  const [connected, setConnected] = useState(socket.connected);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [triviaAnswers, setTriviaAnswers] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [revealCorrect, setRevealCorrect] = useState(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const selectedAnswerRef = useRef(null);
  const nameDisplayRef = useRef(null);

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

  const handleJoin = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    socket.emit("player:join", { name: trimmed });
    setJoined(true);
  };

  useEffect(() => {
    if (joined && nameDisplayRef.current) {
      gsap.from(nameDisplayRef.current, {
        y: window.innerHeight / 3,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        onComplete: () => setAnimationDone(true)
      });
    }
  }, [joined]);

  useEffect(() => {
    const onTriviaAnswers = ({ answers }) => {
      setTriviaAnswers(answers);
      setSelectedAnswer(null);
      setRevealCorrect(null);
      sfx.play("answers-appear");
    };

    const onTriviaQuestion = () => {
      setTriviaAnswers(null);
      setSelectedAnswer(null);
      selectedAnswerRef.current = null;
      setRevealCorrect(null);
      setShowCelebration(false);
    };

    const onTriviaReveal = ({ correctIndex }) => {
      setRevealCorrect(correctIndex);
      const picked = selectedAnswerRef.current;
      if (picked !== null) {
        if (picked === correctIndex) {
          sfx.play("answer-correct");
          setShowCelebration(true);
        } else {
          sfx.play("answer-wrong");
        }
      }
    };

    const onTriviaEnd = () => {
      setTriviaAnswers(null);
      setSelectedAnswer(null);
      setRevealCorrect(null);
      setShowCelebration(false);
    };

    const onPlayerHit = ({ playerId }) => {
      if (playerId === socket.id) {
        sfx.play("bird-hit");
      }
    };

    const onVfxPlay = ({ playerId }) => {
      if (playerId === socket.id) {
        sfx.play("vfx-explosion");
      }
    };

    socket.on("trivia:answers", onTriviaAnswers);
    socket.on("trivia:question", onTriviaQuestion);
    socket.on("trivia:reveal", onTriviaReveal);
    socket.on("trivia:end", onTriviaEnd);
    socket.on("player:hit", onPlayerHit);
    socket.on("vfx:play", onVfxPlay);

    return () => {
      socket.off("trivia:answers", onTriviaAnswers);
      socket.off("trivia:question", onTriviaQuestion);
      socket.off("trivia:reveal", onTriviaReveal);
      socket.off("trivia:end", onTriviaEnd);
      socket.off("player:hit", onPlayerHit);
      socket.off("vfx:play", onVfxPlay);
    };
  }, []);

  const handleAnswer = (index) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(index);
    selectedAnswerRef.current = index;
    sfx.play("answer-select");
    socket.emit("trivia:answer", { answerIndex: index });
  };

  const handleJoystickMove = useCallback(({ angle, strength }) => {
    socket.emit("player:move", { angle, strength });
  }, []);

  const handleJoystickStop = useCallback(() => {
    socket.emit("player:move-stop");
  }, []);

  if (!joined) {
    return (
      <div className="page mobile-name-page">
        <h1>Trivia Bird</h1>
        <form onSubmit={handleJoin} className="name-form">
          <input
            id="name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={16}
            autoFocus
            className="name-input name-input-large"
          />
          <button type="submit" className="join-button">Join</button>
        </form>
        <p className="status-bottom">
          <span className={`status ${connected ? "connected" : ""}`}>
            Socket: {connected ? "Connected" : "Disconnected"}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="page mobile-game">
      <CelebrationOverlay active={showCelebration} />
      <div ref={nameDisplayRef} className="name-display">
        {name}
      </div>

      {triviaAnswers && (
        <div className="trivia-answers">
          {triviaAnswers.map((answer, i) => {
            const isSelected = selectedAnswer === i;
            const isHidden = selectedAnswer !== null && !isSelected;
            const isCorrect = revealCorrect === i;
            const isWrong = revealCorrect !== null && isSelected && !isCorrect;

            return (
              <button
                key={i}
                className={
                  "trivia-answer-btn" +
                  (isSelected ? " selected" : "") +
                  (isHidden ? " hidden" : "") +
                  (isCorrect ? " correct" : "") +
                  (isWrong ? " wrong" : "")
                }
                onTouchStart={(e) => { e.preventDefault(); handleAnswer(i); }}
                onClick={() => handleAnswer(i)}
                disabled={selectedAnswer !== null}
              >
                {answer}
              </button>
            );
          })}
        </div>
      )}

      {animationDone && (
        <div className="controls-bar">
          <button className="action-btn action-btn-blue" onTouchStart={(e) => { e.preventDefault(); socket.emit("player:vfx", { type: "shape" }); }} />
          <div className="joystick-area">
            <Joystick onMove={handleJoystickMove} onStop={handleJoystickStop} />
          </div>
        </div>
      )}

      <p className="status-bottom">
        <span className={`status ${connected ? "connected" : ""}`}>
          Socket: {connected ? "Connected" : "Disconnected"}
        </span>
      </p>
    </div>
  );
}
