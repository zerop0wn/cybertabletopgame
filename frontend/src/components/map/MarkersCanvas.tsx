import React, { useEffect, useRef } from "react";
import { projectEquirect } from "../../lib/geo";

type Anchor = "center" | "bottom-center" | "top-left";
export type Marker = {
  id: string;
  team: "blue" | "red" | "neutral";
  lat: number;
  lng: number;
  sprite: HTMLImageElement | null; // preloaded image
  size?: number;      // logical px width; height auto by sprite ratio
  anchor?: Anchor;
  halo?: boolean;
};

type Props = {
  width: number;
  height: number;
  markers: Marker[];
  fps?: number;
};

const TEAM_COLOR: Record<Marker["team"], string> = {
  blue: "rgba(56,189,248,0.7)",   // cyan-400
  red: "rgba(244,63,94,0.75)",    // rose-500
  neutral: "rgba(148,163,184,0.6)",
};

export default function MarkersCanvas({ width, height, markers, fps = 60 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastRef = useRef(0);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  // resize canvas to device pixel ratio
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
  }, [width, height, dpr]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const frameTime = 1000 / fps;

    const render = (now: number) => {
      if (now - lastRef.current < frameTime) { raf = requestAnimationFrame(render); return; }
      lastRef.current = now;

      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      for (const m of markers) {
        const { x, y } = projectEquirect(m.lat, m.lng, width, height);

        // Halo
        if (m.halo) {
          const t = (now / 1000) % 1;
          const pulse = 10 + Math.sin(t * Math.PI * 2) * 2; // 8..12
          const grd = ctx.createRadialGradient(x, y, 0, x, y, 22 + pulse);
          const col = TEAM_COLOR[m.team];
          grd.addColorStop(0, col);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(x, y, 22 + pulse, 0, Math.PI * 2); ctx.fill();
        }

        // Sprite
        const w = m.size ?? 60;
        const ratio = m.sprite?.naturalHeight && m.sprite?.naturalWidth
          ? (m.sprite.naturalHeight / m.sprite.naturalWidth) : 1;
        const h = w * ratio;

        let dx = x, dy = y;
        const anchor = m.anchor ?? "bottom-center";
        if (anchor === "bottom-center") { dx = x - w / 2; dy = y - h; }
        else if (anchor === "center")   { dx = x - w / 2; dy = y - h / 2; }
        // top-left uses x,y as-is

        if (m.sprite) {
          ctx.drawImage(m.sprite, dx, dy, w, h);
        } else {
          // Fallback glyph
          ctx.fillStyle = m.team === "blue" ? "#38bdf8" : m.team === "red" ? "#f43f5e" : "#a3a3a3";
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        }
      }

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [markers, width, height, dpr, fps]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

