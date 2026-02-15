import { useRef, useCallback, useEffect } from "react";

const OUTER_RADIUS = 70;
const INNER_RADIUS = 28;

export default function Joystick({ onMove, onStop }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const activePointerRef = useRef(null);
  const centerRef = useRef({ x: 0, y: 0 });

  const getCenter = useCallback(() => {
    const rect = outerRef.current.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, []);

  const handleMove = useCallback(
    (clientX, clientY) => {
      if (activePointerRef.current === null) return;

      const center = centerRef.current;
      let dx = clientX - center.x;
      let dy = clientY - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = OUTER_RADIUS - INNER_RADIUS;

      if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }

      innerRef.current.style.transform = `translate(${dx}px, ${dy}px)`;

      const angle = Math.atan2(dy, dx);
      const strength = Math.min(dist / maxDist, 1);

      onMove({ angle, strength });
    },
    [onMove]
  );

  const handleEnd = useCallback(() => {
    if (activePointerRef.current === null) return;
    activePointerRef.current = null;

    innerRef.current.style.transform = "translate(0px, 0px)";
    onStop();
  }, [onStop]);

  const handleStart = useCallback(
    (e) => {
      e.preventDefault();
      // Only track this specific pointer
      activePointerRef.current = e.pointerId;
      outerRef.current.setPointerCapture(e.pointerId);
      centerRef.current = getCenter();

      handleMove(e.clientX, e.clientY);
    },
    [getCenter, handleMove]
  );

  const onPointerMove = useCallback(
    (e) => {
      if (e.pointerId !== activePointerRef.current) return;
      handleMove(e.clientX, e.clientY);
    },
    [handleMove]
  );

  const onPointerUp = useCallback(
    (e) => {
      if (e.pointerId !== activePointerRef.current) return;
      handleEnd();
    },
    [handleEnd]
  );

  return (
    <div
      ref={outerRef}
      className="joystick-outer"
      onPointerDown={handleStart}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={innerRef} className="joystick-inner" />
    </div>
  );
}
