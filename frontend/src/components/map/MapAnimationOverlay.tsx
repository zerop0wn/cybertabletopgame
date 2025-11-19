import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { projectEquirect, greatCirclePoints, type LatLng } from '../../lib/geo';

// Normalized anchor coordinates (0..1)
export type Anchor = { x: number; y: number }; // normalized 0..1

// Animation types
export type PulseAnimation = {
  id: string;
  type: 'pulse';
  anchor: Anchor;
  color: string;
  startTime: number;
  duration: number;
  radius: number;
};

export type RadarAnimation = {
  id: string;
  type: 'radar';
  anchor: Anchor;
  color: string;
  startTime: number;
  duration: number;
  radius: number;
  sweepAngle: number; // current sweep angle in radians
};

export type ArcAnimation = {
  id: string;
  type: 'arc';
  fromAnchor: Anchor;
  toAnchor: Anchor;
  color: string;
  startTime: number;
  duration: number;
  progress: number; // 0..1
  path: { x: number; y: number }[]; // screen coordinates
};

export type Animation = PulseAnimation | RadarAnimation | ArcAnimation;

type Props = {
  width: number;
  height: number;
  fps?: number;
};

export type MapAnimationAPI = {
  pulse: (anchor: Anchor, color: string, duration?: number) => string;
  radar: (anchor: Anchor, color: string, duration?: number) => string;
  arc: (fromAnchor: Anchor, toAnchor: Anchor, color: string, duration?: number) => string;
  clear: (id: string) => void;
  clearAll: () => void;
};

// Anchor locations (normalized 0..1)
const BLUE_CASTLE: Anchor = { x: 0.233, y: 0.613 }; // Atlanta (33.7490, -84.3880)
const RED_SKULL: Anchor = { x: 0.655, y: 0.313 };   // Moscow (55.7558, 37.6173)

// Convert lat/lng to normalized coordinates (0..1)
function latLngToNormalized(lat: number, lng: number): Anchor {
  const x = (lng + 180) / 360;
  const y = (90 - lat) / 180;
  return { x, y };
}

// Convert normalized coordinates to screen coordinates
function normalizedToScreen(anchor: Anchor, width: number, height: number): { x: number; y: number } {
  return {
    x: anchor.x * width,
    y: anchor.y * height,
  };
}

// Helper to convert color string to rgba
function toRgba(color: string, alpha: number): string {
  if (color.startsWith('rgba')) {
    return color.replace(/,\s*[\d.]+\)$/, `,${alpha})`);
  }
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `,${alpha})`);
  }
  // Assume hex or named color - convert to rgba
  return `rgba(${color},${alpha})`;
}

const MapAnimationOverlay = forwardRef<MapAnimationAPI, Props>(
  ({ width, height, fps = 60 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationsRef = useRef<Map<string, Animation>>(new Map());
    const lastFrameRef = useRef(0);
    const animationIdRef = useRef(0);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Resize canvas to device pixel ratio
    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }, [width, height, dpr]);

    // Animation API
    useImperativeHandle(ref, () => ({
      pulse: (anchor: Anchor, color: string, duration = 2000): string => {
        const id = `pulse-${++animationIdRef.current}`;
        animationsRef.current.set(id, {
          id,
          type: 'pulse',
          anchor,
          color,
          startTime: performance.now(),
          duration,
          radius: 0,
        });
        return id;
      },
      radar: (anchor: Anchor, color: string, duration = 3000): string => {
        const id = `radar-${++animationIdRef.current}`;
        animationsRef.current.set(id, {
          id,
          type: 'radar',
          anchor,
          color,
          startTime: performance.now(),
          duration,
          radius: 0,
          sweepAngle: 0,
        });
        return id;
      },
      arc: (fromAnchor: Anchor, toAnchor: Anchor, color: string, duration = 2000): string => {
        const id = `arc-${++animationIdRef.current}`;
        
        // Convert normalized anchors to lat/lng for great circle
        const fromLat = 90 - fromAnchor.y * 180;
        const fromLng = fromAnchor.x * 360 - 180;
        const toLat = 90 - toAnchor.y * 180;
        const toLng = toAnchor.x * 360 - 180;
        
        // Generate great circle path
        const ptsLL = greatCirclePoints(
          { lat: fromLat, lng: fromLng },
          { lat: toLat, lng: toLng },
          64
        );
        
        // Convert to screen coordinates
        const path = ptsLL.map((p) => {
          const normalized = latLngToNormalized(p.lat, p.lng);
          return normalizedToScreen(normalized, width, height);
        });
        
        animationsRef.current.set(id, {
          id,
          type: 'arc',
          fromAnchor,
          toAnchor,
          color,
          startTime: performance.now(),
          duration,
          progress: 0,
          path,
        });
        return id;
      },
      clear: (id: string) => {
        animationsRef.current.delete(id);
      },
      clearAll: () => {
        animationsRef.current.clear();
      },
    }));

    // Render loop
    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      let raf = 0;
      const frameTime = 1000 / fps;

      const render = (now: number) => {
        if (now - lastFrameRef.current < frameTime) {
          raf = requestAnimationFrame(render);
          return;
        }
        lastFrameRef.current = now;

        ctx.clearRect(0, 0, c.width, c.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        // Update and draw animations
        const toRemove: string[] = [];
        
        for (const anim of animationsRef.current.values()) {
          const elapsed = now - anim.startTime;
          const progress = Math.min(1, elapsed / anim.duration);

          if (anim.type === 'pulse') {
            const pulse = anim as PulseAnimation;
            const alpha = 0.7 * (1 - progress);
            const radius = 20 + progress * 30; // 20 to 50 pixels
            
            const screenPos = normalizedToScreen(pulse.anchor, width, height);
            
            // Soft neon pulse
            const grd = ctx.createRadialGradient(
              screenPos.x, screenPos.y, 0,
              screenPos.x, screenPos.y, radius
            );
            grd.addColorStop(0, toRgba(pulse.color, alpha));
            grd.addColorStop(0.5, toRgba(pulse.color, alpha * 0.5));
            grd.addColorStop(1, toRgba(pulse.color, 0));
            
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            if (progress >= 1) toRemove.push(pulse.id);
          } else if (anim.type === 'radar') {
            const radar = anim as RadarAnimation;
            const sweepProgress = (elapsed % (radar.duration / 4)) / (radar.duration / 4); // 4 sweeps
            const sweepAngle = sweepProgress * Math.PI * 2;
            const radius = 40 + progress * 20;
            
            const screenPos = normalizedToScreen(radar.anchor, width, height);
            const alpha = 0.6 * (1 - progress);
            
            // Sweeping ring
            ctx.strokeStyle = toRgba(radar.color, alpha);
            ctx.lineWidth = 2;
            ctx.shadowBlur = 8;
            ctx.shadowColor = toRgba(radar.color, alpha);
            
            // Draw arc from current angle
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, radius, sweepAngle - 0.3, sweepAngle + 0.3);
            ctx.stroke();
            
            ctx.shadowBlur = 0;
            
            if (progress >= 1) toRemove.push(radar.id);
          } else if (anim.type === 'arc') {
            const arc = anim as ArcAnimation;
            const headIndex = Math.floor(arc.progress * (arc.path.length - 1));
            const headPos = arc.path[headIndex] || arc.path[arc.path.length - 1];
            
            // Draw trail
            ctx.strokeStyle = arc.color;
            ctx.lineWidth = 2;
            ctx.shadowBlur = 12;
            ctx.shadowColor = arc.color;
            ctx.beginPath();
            
            for (let i = 0; i <= headIndex; i++) {
              const p = arc.path[i];
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            
            // Draw head dot
            ctx.fillStyle = arc.color;
            ctx.beginPath();
            ctx.arc(headPos.x, headPos.y, 3, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.shadowBlur = 0;
            
            // Update progress
            arc.progress = progress;
            
            if (progress >= 1) toRemove.push(arc.id);
          }
        }

        // Remove finished animations
        toRemove.forEach((id) => animationsRef.current.delete(id));

        ctx.restore();
        raf = requestAnimationFrame(render);
      };

      raf = requestAnimationFrame(render);
      return () => cancelAnimationFrame(raf);
    }, [width, height, dpr, fps]);

    return (
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
      />
    );
  }
);

MapAnimationOverlay.displayName = 'MapAnimationOverlay';

// Default export
export default MapAnimationOverlay;

// Named exports
export { BLUE_CASTLE, RED_SKULL };
export type { MapAnimationAPI, Anchor };

