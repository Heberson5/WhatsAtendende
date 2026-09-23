import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

// Same technique as MaintenanceScreen's pointer-tracked tilt, made reusable
// for everyday cards (pure CSS 3D via perspective + rotateX/rotateY, no
// extra dependency). Read once at module scope, not per-render/per-card —
// matchMedia doesn't change mid-session.
const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Tilt3D({
  children,
  maxTilt = 8,
  className,
}: {
  children: ReactNode;
  maxTilt?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (prefersReducedMotion) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -maxTilt, y: px * maxTilt });
  }

  return (
    <div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      className={className}
      style={{
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: "transform 150ms ease-out",
        transformStyle: "preserve-3d",
      }}
    >
      {children}
    </div>
  );
}
