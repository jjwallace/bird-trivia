import { useEffect, useRef } from "react";

const SHAPE_NUMS = [
  "01","02","03","04","05","06","07","08",
  "09","10","11","12","13","14","15","16"
];
const SHAPE_FRAMES = {
  "01": 59, "02": 55, "03": 31, "04": 55, "05": 57, "06": 57,
  "07": 37, "08": 41, "09": 35, "10": 33, "11": 23, "12": 31,
  "13": 51, "14": 33, "15": 43, "16": 31
};
const COLS = 8;
const FW = 256;
const FH = 144;
const PARTICLE_COUNT = 16;
const DURATION = 3500;

export default function CelebrationOverlay({ active }) {
  const canvasRef = useRef(null);
  const imagesRef = useRef({});

  // Preload shape images on mount
  useEffect(() => {
    for (const num of SHAPE_NUMS) {
      const img = new Image();
      img.src = `/assets/shape/vfx-cartoon_3d_shape_${num}.png`;
      imagesRef.current[num] = img;
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const num = SHAPE_NUMS[i % SHAPE_NUMS.length];
      particles.push({
        img: imagesRef.current[num],
        totalFrames: SHAPE_FRAMES[num],
        frame: 0,
        tick: 0,
        x: canvas.width / 2 + (Math.random() - 0.5) * 120,
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 10,
        vy: -Math.random() * 8 - 3,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.12,
        scale: 0.25 + Math.random() * 0.2,
        alpha: 1
      });
    }

    const startTime = Date.now();
    let animId;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > DURATION) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const fadeStart = DURATION * 0.6;

      for (const p of particles) {
        p.x += p.vx;
        p.vy += 0.2;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        // Advance sprite frame
        p.tick++;
        if (p.tick % 2 === 0 && p.frame < p.totalFrames - 1) {
          p.frame++;
        }

        if (elapsed > fadeStart) {
          p.alpha = 1 - (elapsed - fadeStart) / (DURATION - fadeStart);
        }

        if (!p.img.complete || !p.img.naturalWidth) continue;

        const col = p.frame % COLS;
        const row = Math.floor(p.frame / COLS);

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(p.scale, p.scale);
        ctx.drawImage(
          p.img,
          col * FW, row * FH, FW, FH,
          -FW / 2, -FH / 2, FW, FH
        );
        ctx.restore();
      }

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animId);
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        pointerEvents: "none"
      }}
    />
  );
}
