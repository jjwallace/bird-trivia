import { useEffect, useRef } from "react";
import Phaser from "phaser";
import socket from "../socket";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

const BIRD_SCALE = 0.15;
const HIT_DURATION = 1000;

const CLOUD_08_FRAMES = 45;

// Player bird tint colors (applied over the pink base sprite)
const BIRD_TINTS = [
  0xffffff, // 0: original pink (no tint)
  0x6699ff, // 1: blue
  0x66ff66, // 2: green
  0xffff66, // 3: yellow
  0xff6666, // 4: red
  0x66ffff, // 5: cyan
  0xff66ff, // 6: magenta
  0xffaa44, // 7: orange
];

// Matching CSS hex colors for name labels
const LABEL_COLORS = [
  "#ffaacc", // pink
  "#6699ff", // blue
  "#66ff66", // green
  "#ffff66", // yellow
  "#ff6666", // red
  "#66ffff", // cyan
  "#ff66ff", // magenta
  "#ffaa44", // orange
];

// 3D shape VFX spritesheets (key → frame count)
const SHAPE_SPRITES = {
  "01": 59, "02": 55, "03": 31, "04": 55, "05": 57, "06": 57,
  "07": 37, "08": 41, "09": 35, "10": 33, "11": 23, "12": 31,
  "13": 51, "14": 33, "15": 43, "16": 31
};

// Reveal smoke clouds (all except 06=permanent, 08=hit)
const REVEAL_CLOUDS = {
  "01": 40, "02": 49, "03": 50, "04": 56, "05": 49,
  "07": 28, "09": 52, "10": 39, "11": 31, "12": 37, "13": 61
};

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
    this.playerSprites = {};
    this.playerLabels = {};
    this.playerLastX = {};
    this.latestPlayers = null;
    this.playerCheckmarks = {};
  }

  preload() {
    // Bird frames
    this.load.image("bird-fly-1", "/assets/bird/fly/frame-1.png");
    this.load.image("bird-fly-2", "/assets/bird/fly/frame-2.png");
    this.load.image("bird-hit-1", "/assets/bird/got%20hit/frame-1.png");
    this.load.image("bird-hit-2", "/assets/bird/got%20hit/frame-2.png");

    // Background
    this.load.image("background", "/assets/background.png");

    // VFX sprite sheets
    this.load.spritesheet("vfx-explosion", "/assets/vfx-explosion_15.png", {
      frameWidth: 256, frameHeight: 144
    });
    this.load.spritesheet("vfx-explosion-01", "/assets/vfx-explosion_01.png", {
      frameWidth: 256, frameHeight: 144
    });
    this.load.spritesheet("vfx-shape", "/assets/vfx-shape_alt_06.png", {
      frameWidth: 256, frameHeight: 144
    });

    // Cloud 06 — permanent entity
    this.load.spritesheet("cloud-06", "/assets/clouds/vfx-cartoon_smoke_06.png", {
      frameWidth: 256, frameHeight: 144
    });

    // Cloud 08 for hit VFX
    this.load.spritesheet("cloud-08", "/assets/clouds/vfx-cartoon_smoke_08.png", {
      frameWidth: 256, frameHeight: 144
    });

    // Audio sprite
    this.load.audioSprite("sfx", "/assets/sfx.json", [
      "/assets/sfx.webm",
      "/assets/sfx.mp3"
    ]);

    // 3D shape VFX spritesheets
    for (const key of Object.keys(SHAPE_SPRITES)) {
      this.load.spritesheet(`shape-${key}`, `/assets/shape/vfx-cartoon_3d_shape_${key}.png`, {
        frameWidth: 256, frameHeight: 144
      });
    }

    // Reveal smoke clouds for question transitions
    for (const key of Object.keys(REVEAL_CLOUDS)) {
      this.load.spritesheet(`cloud-${key}`, `/assets/clouds/vfx-cartoon_smoke_${key}.png`, {
        frameWidth: 256, frameHeight: 144
      });
    }
  }

  create() {
    // Background image
    const bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "background");
    bg.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // Bird animations
    this.anims.create({
      key: "bird-fly",
      frames: [{ key: "bird-fly-1" }, { key: "bird-fly-2" }],
      frameRate: 4,
      repeat: -1
    });

    this.anims.create({
      key: "bird-hit",
      frames: [{ key: "bird-hit-1" }, { key: "bird-hit-2" }],
      frameRate: 6,
      repeat: -1
    });

    // VFX animations
    this.anims.create({
      key: "explosion",
      frames: this.anims.generateFrameNumbers("vfx-explosion", { start: 0, end: 35 }),
      frameRate: 30,
      repeat: 0
    });

    this.anims.create({
      key: "explosion-01",
      frames: this.anims.generateFrameNumbers("vfx-explosion-01", { start: 0, end: 46 }),
      frameRate: 30,
      repeat: 0
    });

    this.anims.create({
      key: "shape",
      frames: this.anims.generateFrameNumbers("vfx-shape", { start: 0, end: 20 }),
      frameRate: 24,
      repeat: 0
    });

    // Cloud 06 — permanent looping entity in center
    this.anims.create({
      key: "cloud-06-loop",
      frames: this.anims.generateFrameNumbers("cloud-06", { start: 0, end: 12 }),
      frameRate: 12,
      repeat: -1
    });

    // Cloud-06 entities — bottom corners, slightly off-screen
    const cloudRight = this.add.sprite(GAME_WIDTH - 130, GAME_HEIGHT - 20, "cloud-06");
    cloudRight.setScale(3);
    cloudRight.play("cloud-06-loop");

    const cloudLeft = this.add.sprite(130, GAME_HEIGHT - 20, "cloud-06");
    cloudLeft.setScale(3);
    cloudLeft.setFlipX(true);
    cloudLeft.play("cloud-06-loop");

    // Cloud 08 animation for hit effects
    this.anims.create({
      key: "cloud-08",
      frames: this.anims.generateFrameNumbers("cloud-08", { start: 0, end: CLOUD_08_FRAMES - 1 }),
      frameRate: 24,
      repeat: 0
    });

    // Draw the game boundary box
    const border = this.add.graphics();
    border.lineStyle(3, 0xffffff, 1);
    border.strokeRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // 3D shape animations
    for (const [key, frames] of Object.entries(SHAPE_SPRITES)) {
      this.anims.create({
        key: `shape-${key}`,
        frames: this.anims.generateFrameNumbers(`shape-${key}`, { start: 0, end: frames - 1 }),
        frameRate: 24,
        repeat: 0
      });
    }

    // Reveal cloud animations
    for (const [key, frames] of Object.entries(REVEAL_CLOUDS)) {
      this.anims.create({
        key: `cloud-${key}-reveal`,
        frames: this.anims.generateFrameNumbers(`cloud-${key}`, { start: 0, end: frames - 1 }),
        frameRate: 24,
        repeat: 0
      });
    }

    // --- Trivia UI (high depth, renders on top of players) ---
    this.questionText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "", {
      fontSize: "48px",
      fontFamily: "system-ui, sans-serif",
      color: "#ffffff",
      align: "center",
      stroke: "#000000",
      strokeThickness: 6,
      wordWrap: { width: 1200 }
    });
    this.questionText.setOrigin(0.5, 0.5);
    this.questionText.setAlpha(0);
    this.questionText.setDepth(100);

    this.questionCounter = this.add.text(30, 20, "", {
      fontSize: "32px",
      fontFamily: "system-ui, sans-serif",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4
    });
    this.questionCounter.setDepth(100);
    this.questionCounter.setAlpha(0);

    this.timerText = this.add.text(GAME_WIDTH - 30, 20, "", {
      fontSize: "48px",
      fontFamily: "system-ui, sans-serif",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4
    });
    this.timerText.setOrigin(1, 0);
    this.timerText.setDepth(100);
    this.timerText.setAlpha(0);

    // Pre-game countdown display
    this._onTriviaCountdown = ({ timeLeft }) => {
      if (timeLeft <= 0) {
        this.questionText.setAlpha(0);
        return;
      }
      this.questionText.setText(`Starting in ${timeLeft}...`);
      this.questionText.setAlpha(1);
    };

    // Listen for player position updates
    this._onPlayersUpdate = (players) => {
      this.latestPlayers = players;
    };

    // Listen for VFX events
    this._onVfxPlay = ({ type, x, y }) => {
      const animKey = type === "explosion" ? "explosion" : "shape";
      const sprite = this.add.sprite(x, y, type === "explosion" ? "vfx-explosion" : "vfx-shape");
      sprite.setOrigin(0.5, 0.5);
      sprite.setScale(1);
      sprite.play(animKey);
      sprite.once("animationcomplete", () => {
        sprite.destroy();
      });
      this.sound.playAudioSprite("sfx", "vfx-explosion");
    };

    // Listen for hit events — play random cloud + switch bird to hit anim
    this._onPlayerHit = ({ playerId }) => {
      const bird = this.playerSprites[playerId];
      if (!bird || bird.getData("isHit")) return;

      // Play cloud 08 puff on the hit player
      const cloud = this.add.sprite(bird.x, bird.y, "cloud-08");
      cloud.setOrigin(0.5, 0.5);
      cloud.setScale(1);
      cloud.play("cloud-08");
      cloud.once("animationcomplete", () => {
        cloud.destroy();
      });

      // Switch bird to hit animation
      bird.setData("isHit", true);
      bird.play("bird-hit");
      this.sound.playAudioSprite("sfx", "bird-hit");

      this.time.delayedCall(HIT_DURATION, () => {
        if (bird && bird.active) {
          bird.setData("isHit", false);
          bird.play("bird-fly");
        }
      });
    };

    // --- Trivia socket listeners ---
    this._onTriviaQuestion = ({ index, total, question, smokeKey }) => {
      this.sound.playAudioSprite("sfx", "smoke-reveal");

      // Play smoke reveal at center
      const smoke = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, `cloud-${smokeKey}`);
      smoke.setOrigin(0.5, 0.5);
      smoke.setScale(4);
      smoke.setDepth(99);
      smoke.play(`cloud-${smokeKey}-reveal`);
      smoke.once("animationcomplete", () => smoke.destroy());

      // Fade in question text
      this.questionText.setText(question);
      this.questionText.setAlpha(0);
      this.tweens.add({
        targets: this.questionText,
        alpha: 1,
        duration: 800,
        delay: 300,
        ease: "Power2",
        onStart: () => {
          this.sound.playAudioSprite("sfx", "question-appear");
        }
      });

      // Show question counter
      this.questionCounter.setText(`${index + 1} / ${total}`);
      this.questionCounter.setAlpha(1);

      // Clear old checkmarks
      for (const cm of Object.values(this.playerCheckmarks)) cm.destroy();
      this.playerCheckmarks = {};
    };

    this._onTriviaTimer = ({ timeLeft }) => {
      this.timerText.setText(`${timeLeft}`);
      this.timerText.setAlpha(1);
      this.timerText.setColor(timeLeft <= 5 ? "#ff4444" : "#ffffff");

      if (timeLeft <= 5 && timeLeft > 0) {
        this.sound.playAudioSprite("sfx", "timer-warning");
      } else if (timeLeft > 5) {
        this.sound.playAudioSprite("sfx", "timer-tick");
      } else if (timeLeft <= 0) {
        this.sound.playAudioSprite("sfx", "timer-expire");
      }
    };

    this._onTriviaPlayerAnswered = ({ playerId }) => {
      if (this.playerCheckmarks[playerId]) return;
      const label = this.playerLabels[playerId];
      if (!label) return;

      this.sound.playAudioSprite("sfx", "player-answered");

      const check = this.add.text(0, 0, "\u2713", {
        fontSize: "36px",
        fontFamily: "system-ui, sans-serif",
        color: "#4ade80",
        stroke: "#000000",
        strokeThickness: 3
      });
      check.setOrigin(0, 1);
      check.setDepth(101);
      this.playerCheckmarks[playerId] = check;
    };

    this._onTriviaReveal = ({ wrongPlayerIds }) => {
      this.tweens.add({
        targets: this.questionText,
        alpha: 0,
        duration: 500,
        ease: "Power2"
      });
      this.timerText.setAlpha(0);

      for (const cm of Object.values(this.playerCheckmarks)) cm.destroy();
      this.playerCheckmarks = {};

      // Staggered explosions on wrong players
      if (wrongPlayerIds) {
        wrongPlayerIds.forEach((id, i) => {
          this.time.delayedCall(i * 300, () => {
            const bird = this.playerSprites[id];
            if (!bird || !bird.active) return;

            const explosion = this.add.sprite(bird.x, bird.y, "vfx-explosion-01");
            explosion.setOrigin(0.5, 0.5);
            explosion.setScale(1.5);
            explosion.play("explosion-01");
            explosion.once("animationcomplete", () => explosion.destroy());
            this.sound.playAudioSprite("sfx", "vfx-explosion");
          });
        });
      }
    };

    this._onTriviaEnd = ({ scores }) => {
      this.questionCounter.setAlpha(0);
      this.timerText.setAlpha(0);

      this.sound.playAudioSprite("sfx", "game-over");

      const sorted = Object.entries(scores).sort(([, a], [, b]) => b.score - a.score);
      const lines = sorted.map(([, { name, score }], i) => `${i + 1}. ${name}: ${score}`);

      this.questionText.setText("Game Over!\n\n" + lines.join("\n"));
      this.questionText.setAlpha(1);

      // Scale up top 3 players
      const podiumScales = [3, 2, 1.5];
      sorted.slice(0, 3).forEach(([id], i) => {
        const bird = this.playerSprites[id];
        if (bird && bird.active) {
          this.tweens.add({
            targets: bird,
            scaleX: BIRD_SCALE * podiumScales[i],
            scaleY: BIRD_SCALE * podiumScales[i],
            duration: 800,
            ease: "Back.easeOut"
          });
        }
      });

      // Shape particle celebration around 1st place
      if (sorted.length > 0) {
        const winnerId = sorted[0][0];
        const winnerBird = this.playerSprites[winnerId];
        if (winnerBird && winnerBird.active) {
          const shapeKeys = Object.keys(SHAPE_SPRITES);
          let count = 0;
          this.time.addEvent({
            delay: 150,
            repeat: 39,
            callback: () => {
              const key = shapeKeys[count % shapeKeys.length];
              const ox = (Math.random() - 0.5) * 400;
              const oy = (Math.random() - 0.5) * 300;
              const s = this.add.sprite(winnerBird.x + ox, winnerBird.y + oy, `shape-${key}`);
              s.setScale(0.6 + Math.random() * 0.6);
              s.setDepth(50);
              s.play(`shape-${key}`);
              s.once("animationcomplete", () => s.destroy());
              count++;
            }
          });
        }
      }
    };

    socket.on("players:update", this._onPlayersUpdate);
    socket.on("vfx:play", this._onVfxPlay);
    socket.on("player:hit", this._onPlayerHit);
    socket.on("trivia:countdown", this._onTriviaCountdown);
    socket.on("trivia:question", this._onTriviaQuestion);
    socket.on("trivia:timer", this._onTriviaTimer);
    socket.on("trivia:player-answered", this._onTriviaPlayerAnswered);
    socket.on("trivia:reveal", this._onTriviaReveal);
    socket.on("trivia:end", this._onTriviaEnd);

    this.events.on("shutdown", () => {
      socket.off("players:update", this._onPlayersUpdate);
      socket.off("vfx:play", this._onVfxPlay);
      socket.off("player:hit", this._onPlayerHit);
      socket.off("trivia:countdown", this._onTriviaCountdown);
      socket.off("trivia:question", this._onTriviaQuestion);
      socket.off("trivia:timer", this._onTriviaTimer);
      socket.off("trivia:player-answered", this._onTriviaPlayerAnswered);
      socket.off("trivia:reveal", this._onTriviaReveal);
      socket.off("trivia:end", this._onTriviaEnd);
    });
  }

  update() {
    const players = this.latestPlayers;
    if (!players) return;

    const currentIds = new Set(Object.keys(players));

    // Remove players that left
    for (const id of Object.keys(this.playerSprites)) {
      if (!currentIds.has(id)) {
        this.playerSprites[id].destroy();
        this.playerLabels[id].destroy();
        delete this.playerSprites[id];
        delete this.playerLabels[id];
        delete this.playerLastX[id];
      }
    }

    // Update or create players
    for (const [id, player] of Object.entries(players)) {
      if (!this.playerSprites[id]) {
        const bird = this.add.sprite(player.x, player.y, "bird-fly-1");
        bird.setScale(BIRD_SCALE);
        bird.setData("isHit", false);
        bird.setData("bobOffset", 0);
        bird.play("bird-fly");

        // Tint bird to player's assigned color
        const ci = player.colorIndex ?? 0;
        bird.setTint(BIRD_TINTS[ci]);

        this.playerSprites[id] = bird;

        // Gentle bob up and down
        this.tweens.add({
          targets: { val: 0 },
          val: 8,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: (tween, target) => {
            bird.setData("bobOffset", target.val);
          }
        });

        const label = this.add.text(player.x, player.y - 50, player.name, {
          fontSize: "42px",
          fontFamily: "system-ui, sans-serif",
          color: LABEL_COLORS[ci],
          align: "center",
          stroke: "#000000",
          strokeThickness: 4
        });
        label.setOrigin(0.5, 1);
        this.playerLabels[id] = label;
      } else {
        const bob = this.playerSprites[id].getData("bobOffset") || 0;
        this.playerSprites[id].setPosition(player.x, player.y - bob);
        this.playerLabels[id].setPosition(player.x, player.y - 50 - bob);

        // Flip bird based on movement direction
        const lastX = this.playerLastX[id] ?? player.x;
        if (player.x < lastX) {
          this.playerSprites[id].setFlipX(true);
        } else if (player.x > lastX) {
          this.playerSprites[id].setFlipX(false);
        }
        this.playerLastX[id] = player.x;
      }
    }

    // Position checkmarks next to player labels
    for (const [id, check] of Object.entries(this.playerCheckmarks)) {
      const label = this.playerLabels[id];
      if (label) {
        check.setPosition(label.x + label.width / 2 + 8, label.y);
      }
    }
  }
}

export default function GameCanvas() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    if (gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent: containerRef.current,
      transparent: true,
      scene: [GameScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="game-canvas" />;
}
