import React, { useEffect, useRef } from 'react';
import { projectEquirect, greatCirclePoints } from '../../lib/geo';
import { neonForSeverity, COLORS, type PewEvent } from '../../lib/pewpew';

type Props = {
  width?: number;
  height?: number;
  events: PewEvent[]; // incoming stream (diffs)
  maxTrails?: number; // retain N trails
  fpsCap?: number; // e.g., 60
  transparentBackground?: boolean; // If true, don't draw background (for use with MapBase)
};

type Trail = {
  id: string;
  attack_id?: string;
  path: { x: number; y: number }[];
  color: string;
  head: number; // 0..path.length
  createdAt: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  state?: 'launched' | 'blocked' | 'hit' | 'miss' | string;
  result?: 'blocked' | 'hit' | 'miss';
  // Animation state
  shieldAnimation?: {
    progress: number; // 0-1
    startTime: number;
  };
  explosionAnimation?: {
    progress: number; // 0-1
    startTime: number;
    particles: Array<{ x: number; y: number; vx: number; vy: number; life: number }>;
  };
  dudAnimation?: {
    progress: number; // 0-1
    startTime: number;
    fizzlePoint: { x: number; y: number }; // Where it stops and fizzles
    sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }>;
    smoke: Array<{ x: number; y: number; vx: number; vy: number; life: number; size: number }>;
  };
};

export default function AudiencePewPewMap({
  width = 1200,
  height = 600,
  events,
  maxTrails = 150,
  fpsCap = 60,
  transparentBackground = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailsRef = useRef<Trail[]>([]);
  const lastFrameRef = useRef(0);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const backgroundImageLoadedRef = useRef(false);

  // Load background image
  useEffect(() => {
    const img = new Image();
    img.src = '/images/background.png';
    img.onload = () => {
      backgroundImageRef.current = img;
      backgroundImageLoadedRef.current = true;
      console.log('[AudiencePewPewMap] Background image loaded:', img.width, 'x', img.height);
    };
    img.onerror = () => {
      console.error('[AudiencePewPewMap] Failed to load background image from /images/background.png');
    };
  }, []);

  // Ingest events -> trails
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn('[AudiencePewPewMap] Canvas ref not available');
      return;
    }

    const W = canvas.width;
    const H = canvas.height;
    
    console.log('[AudiencePewPewMap] Processing events:', events.length, 'canvas size:', W, 'x', H);

    for (const e of events) {
      console.log('[AudiencePewPewMap] Processing event:', e.id, 'attack_id:', e.attack_id, 'result:', e.result, 'state:', e.state);
      
      // Check if this is an update to an existing attack (by attack_id)
      if (e.attack_id) {
        const existingTrail = trailsRef.current.find(t => t.attack_id === e.attack_id);
        console.log('[AudiencePewPewMap] Found existing trail:', existingTrail ? 'yes' : 'no', 'for attack_id:', e.attack_id);
        if (existingTrail) {
          // Update existing trail with new state/result
          if (e.state) existingTrail.state = e.state;
          if (e.result) {
            existingTrail.result = e.result;
            // Only set state if not already set or if result is blocked/hit (don't override miss)
            if (e.result === 'blocked') {
              existingTrail.state = 'blocked';
            } else if (e.result === 'hit') {
              existingTrail.state = 'hit';
            } else if (e.result === 'miss') {
              existingTrail.state = 'miss';
            }
            
            // Start animation when resolved
            if (e.result === 'blocked') {
              existingTrail.shieldAnimation = {
                progress: 0,
                startTime: performance.now(),
              };
            } else if (e.result === 'hit') {
              // Create explosion particles
              const particles = [];
              for (let i = 0; i < 20; i++) {
                const angle = (Math.PI * 2 * i) / 20;
                const speed = 2 + Math.random() * 3;
                particles.push({
                  x: existingTrail.to.x,
                  y: existingTrail.to.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  life: 1.0,
                });
              }
              existingTrail.explosionAnimation = {
                progress: 0,
                startTime: performance.now(),
                particles,
              };
            } else if (e.result === 'miss') {
              // Miss: Attack continues all the way but misses at the last moment
              console.log('[AudiencePewPewMap] Processing miss event for attack:', e.attack_id);
              
              // Set state to miss
              existingTrail.state = 'miss';
              existingTrail.result = 'miss';
              
              // Miss happens at 75% of the path - clearly veers off course before reaching castle
              const missIndex = Math.floor(existingTrail.path.length * 0.75);
              const missPoint = existingTrail.path[missIndex] || existingTrail.to;
              
              // Calculate direction of travel to add perpendicular offset (veer dramatically to the side)
              const dx = existingTrail.to.x - existingTrail.from.x;
              const dy = existingTrail.to.y - existingTrail.from.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const unitX = dist > 0 ? dx / dist : 1;
              const unitY = dist > 0 ? dy / dist : 0;
              // Offset perpendicular to the direction of travel (veer dramatically to the right)
              const perpX = -unitY;
              const perpY = unitX;
              // Fizzle point: where the missile veers off dramatically (much more to the side)
              const fizzlePoint = {
                x: missPoint.x + perpX * 40, // Veer 40 pixels to the side (much more dramatic)
                y: missPoint.y + perpY * 40,
              };
              
              console.log('[AudiencePewPewMap] Miss fizzle point at destination with offset:', fizzlePoint);
              
              // Create dramatic sparks for fizzle effect (more particles, bigger)
              const sparks = [];
              for (let i = 0; i < 30; i++) {
                const angle = (Math.PI * 2 * i) / 30 + (Math.random() - 0.5) * 0.8;
                const speed = 1.5 + Math.random() * 3;
                sparks.push({
                  x: fizzlePoint.x,
                  y: fizzlePoint.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  life: 1.0,
                  size: 1.5 + Math.random() * 3,
                });
              }
              
              // Create dramatic smoke particles (more particles, bigger)
              const smoke = [];
              for (let i = 0; i < 15; i++) {
                const angle = (Math.PI * 2 * i) / 15 + (Math.random() - 0.5) * 0.5;
                const speed = 0.5 + Math.random() * 1.5;
                smoke.push({
                  x: fizzlePoint.x,
                  y: fizzlePoint.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed - 0.8, // Float upward more
                  life: 1.0,
                  size: 4 + Math.random() * 6,
                });
              }
              
              existingTrail.dudAnimation = {
                progress: 0,
                startTime: performance.now(),
                fizzlePoint,
                sparks,
                smoke,
              };
              
              // Don't stop the trail - let it continue all the way to the destination
              // The dud animation will happen at the destination
              console.log('[AudiencePewPewMap] Dud animation created at destination, trail will continue to end');
            }
          }
          continue;
        }
      }
      
      // Skip if we already have this trail (by id)
      if (trailsRef.current.some(t => t.id === e.id && !e.attack_id)) {
        continue;
      }

      // New attack launched (or resolved event creating new trail)
      const ptsLL = greatCirclePoints(e.from, e.to, 64);
      const path = ptsLL.map((p) => projectEquirect(p.lat, p.lng, W, H));
      const color = e.color ?? neonForSeverity(e.severity);

      const trail: Trail = {
        id: e.id,
        attack_id: e.attack_id,
        path,
        color,
        head: 0,
        createdAt: performance.now(),
        from: projectEquirect(e.from.lat, e.from.lng, W, H),
        to: projectEquirect(e.to.lat, e.to.lng, W, H),
        state: e.state || 'launched',
        result: e.result,
      };

      // If this is a miss event creating a new trail, set up dud animation immediately
      if (e.result === 'miss' || e.state === 'miss') {
        console.log('[AudiencePewPewMap] Creating new trail with miss result:', e.attack_id);
        trail.state = 'miss';
        trail.result = 'miss';
        
        // Miss happens at 75% of the path - clearly veers off course before reaching castle
        const missIndex = Math.floor(trail.path.length * 0.75);
        const missPoint = trail.path[missIndex] || trail.to;
        
        // Calculate direction of travel to add perpendicular offset (veer dramatically to the side)
        const dx = trail.to.x - trail.from.x;
        const dy = trail.to.y - trail.from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const unitX = dist > 0 ? dx / dist : 1;
        const unitY = dist > 0 ? dy / dist : 0;
        // Offset perpendicular to the direction of travel (veer dramatically to the right)
        const perpX = -unitY;
        const perpY = unitX;
        // Fizzle point: where the missile veers off dramatically (much more to the side)
        const fizzlePoint = {
          x: missPoint.x + perpX * 40, // Veer 40 pixels to the side (much more dramatic)
          y: missPoint.y + perpY * 40,
        };
        
        // Create sparks for fizzle effect
        const sparks = [];
        for (let i = 0; i < 15; i++) {
          const angle = (Math.PI * 2 * i) / 15 + (Math.random() - 0.5) * 0.5;
          const speed = 1 + Math.random() * 2;
          sparks.push({
            x: fizzlePoint.x,
            y: fizzlePoint.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            size: 1 + Math.random() * 2,
          });
        }
        
        // Create smoke particles
        const smoke = [];
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.3;
          const speed = 0.5 + Math.random() * 1;
          smoke.push({
            x: fizzlePoint.x,
            y: fizzlePoint.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.5, // Float upward
            life: 1.0,
            size: 3 + Math.random() * 4,
          });
        }
        
        trail.dudAnimation = {
          progress: 0,
          startTime: performance.now(),
          fizzlePoint,
          sparks,
          smoke,
        };
        
        // Don't stop the trail - let it continue all the way to the destination
        // The dud animation will happen at the destination
        console.log('[AudiencePewPewMap] Created new trail with dud animation at destination');
      }

      trailsRef.current.push(trail);
      if (trailsRef.current.length > maxTrails) {
        trailsRef.current.splice(0, trailsRef.current.length - maxTrails);
      }
    }
    
    console.log('[AudiencePewPewMap] Total trails:', trailsRef.current.length);
  }, [events, maxTrails]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const frameTime = 1000 / fpsCap;

    const drawBackground = () => {
      // Skip background if transparent mode (for use with MapBase)
      if (transparentBackground) {
        return;
      }

      // Draw custom background image if loaded
      if (backgroundImageLoadedRef.current && backgroundImageRef.current) {
        ctx.drawImage(
          backgroundImageRef.current,
          0, 0,                    // Source x, y
          canvas.width,            // Destination width
          canvas.height            // Destination height
        );
      } else {
        // Fallback: original grid background if image not loaded
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(148,163,184,0.08)';
        ctx.lineWidth = 1;
        const grid = 40;

        for (let x = 0; x < canvas.width; x += grid) {
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, canvas.height);
          ctx.stroke();
        }

        for (let y = 0; y < canvas.height; y += grid) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(canvas.width, y + 0.5);
          ctx.stroke();
        }
      }

      // Optional: Scanlines overlay (can be removed if you don't want it)
      const slH = 2;
      for (let y = 0; y < canvas.height; y += slH) {
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
        ctx.fillRect(0, y, canvas.width, 1);
      }
    };

    const render = (now: number) => {
      if (now - lastFrameRef.current < frameTime) {
        raf = requestAnimationFrame(render);
        return;
      }
      lastFrameRef.current = now;

      drawBackground();

      // Animate trails
      for (const t of trailsRef.current) {
        // Only animate if launched (not yet resolved)
        // If blocked or hit - continue until destination then show effect
        // If miss - veer off course before reaching destination (at 75% of the way)
        if (t.state === 'launched') {
          t.head = Math.min(t.path.length - 1, t.head + 1);
        } else if (t.state === 'miss') {
          // For misses, veer off course at 75% of the way - clearly miss the castle
          const missPoint = Math.floor(t.path.length * 0.75);
          t.head = Math.min(missPoint, t.head + 1);
        } else if ((t.state === 'blocked' || t.state === 'hit') && t.head < t.path.length - 1) {
          // Continue animation until it reaches destination, then show shield/explosion
          t.head = Math.min(t.path.length - 1, t.head + 1);
        }

        const headP = t.path[t.head];
        const isAtDestination = t.head >= t.path.length - 1;

        // Trail tail
        ctx.strokeStyle = COLORS.tail;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < t.head; i++) {
          const p = t.path[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        // Neon arc (brighter) - draw for launched, miss, or if blocked/hit but not reached destination
        // For miss, draw the arc but it veers off course before reaching the castle
        if (t.state === 'miss') {
          // Miss: Draw the arc but it veers off course (stops at 85%)
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = t.color;
          ctx.beginPath();

          const tailStart = Math.max(0, t.head - 12);
          ctx.moveTo(t.path[tailStart].x, t.path[tailStart].y);
          for (let i = tailStart + 1; i <= t.head; i++) {
            ctx.lineTo(t.path[i].x, t.path[i].y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Glowing head dot (at the veer point)
          ctx.fillStyle = COLORS.dot;
          ctx.beginPath();
          ctx.arc(headP.x, headP.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (t.state !== 'blocked' || !isAtDestination) {
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = t.color;
          ctx.beginPath();

          const tailStart = Math.max(0, t.head - 12);
          ctx.moveTo(t.path[tailStart].x, t.path[tailStart].y);
          for (let i = tailStart + 1; i <= t.head; i++) {
            ctx.lineTo(t.path[i].x, t.path[i].y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Glowing head dot (only if not miss or if miss but not at destination)
          // For miss, we draw the dot until it reaches destination, then it "misses"
          if (t.state !== 'miss' || !isAtDestination) {
            ctx.fillStyle = COLORS.dot;
            ctx.beginPath();
            ctx.arc(headP.x, headP.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Shield animation for blocked attacks
        if (t.state === 'blocked' && t.shieldAnimation && isAtDestination) {
          const shieldTime = (now - t.shieldAnimation.startTime) / 1000; // seconds
          const shieldDuration = 1.0; // 1 second animation
          const shieldProgress = Math.min(1, shieldTime / shieldDuration);
          
          if (shieldProgress < 1) {
            // Draw shield at Blue base
            const shieldRadius = 30 + shieldProgress * 20; // Expand from 30 to 50
            const shieldAlpha = 0.8 * (1 - shieldProgress); // Fade out
            
            // Shield circle
            ctx.strokeStyle = `rgba(59,130,246,${shieldAlpha})`; // Blue shield
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(t.to.x, t.to.y, shieldRadius, 0, Math.PI * 2);
            ctx.stroke();
            
            // Shield glow
            const grd = ctx.createRadialGradient(t.to.x, t.to.y, shieldRadius - 5, t.to.x, t.to.y, shieldRadius + 10);
            grd.addColorStop(0, `rgba(59,130,246,${shieldAlpha * 0.5})`);
            grd.addColorStop(1, `rgba(59,130,246,0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(t.to.x, t.to.y, shieldRadius + 10, 0, Math.PI * 2);
            ctx.fill();
            
            // Shield icon (simple hexagon)
            ctx.strokeStyle = `rgba(59,130,246,${shieldAlpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 3) * i;
              const x = t.to.x + Math.cos(angle) * (shieldRadius * 0.6);
              const y = t.to.y + Math.sin(angle) * (shieldRadius * 0.6);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }

        // Explosion animation for hit attacks
        if (t.state === 'hit' && t.explosionAnimation && isAtDestination) {
          const explosionTime = (now - t.explosionAnimation.startTime) / 1000;
          const explosionDuration = 1.5; // 1.5 second animation
          const explosionProgress = Math.min(1, explosionTime / explosionDuration);
          
          if (explosionProgress < 1) {
            // Update particles
            for (const particle of t.explosionAnimation.particles) {
              particle.x += particle.vx;
              particle.y += particle.vy;
              particle.vx *= 0.98; // Slow down
              particle.vy *= 0.98;
              particle.life -= 0.02;
            }
            
            // Draw explosion
            const explosionRadius = 20 + explosionProgress * 40;
            const explosionAlpha = 0.9 * (1 - explosionProgress);
            
            // Main explosion circle
            const grd = ctx.createRadialGradient(t.to.x, t.to.y, 0, t.to.x, t.to.y, explosionRadius);
            grd.addColorStop(0, `rgba(244,63,94,${explosionAlpha})`); // Red
            grd.addColorStop(0.5, `rgba(236,72,153,${explosionAlpha * 0.7})`); // Pink
            grd.addColorStop(1, `rgba(244,63,94,0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(t.to.x, t.to.y, explosionRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Particles
            for (const particle of t.explosionAnimation.particles) {
              if (particle.life > 0) {
                ctx.fillStyle = `rgba(244,63,94,${particle.life})`;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            
            // Shockwave
            ctx.strokeStyle = `rgba(244,63,94,${explosionAlpha * 0.5})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(t.to.x, t.to.y, explosionRadius * 1.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Dud animation for missed attacks (veers off course before reaching the castle)
        if (t.state === 'miss') {
          // Miss happens at 75% of the way - where the arc veers off (clearly before castle)
          const missIndex = Math.floor(t.path.length * 0.75);
          const isAtMissPoint = t.head >= missIndex;
          
          // Create dud animation when we reach the miss point (75% of the way)
          if (!t.dudAnimation && isAtMissPoint) {
            // Miss happens at 75% of the path - clearly veers off course before reaching castle
            const missPoint = t.path[missIndex] || t.path[t.head];
            
            // Calculate direction of travel to add perpendicular offset (veer dramatically to the side)
            const dx = t.to.x - t.from.x;
            const dy = t.to.y - t.from.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const unitX = dist > 0 ? dx / dist : 1;
            const unitY = dist > 0 ? dy / dist : 0;
            // Offset perpendicular to the direction of travel (veer dramatically to the right)
            const perpX = -unitY;
            const perpY = unitX;
            // Fizzle point: where the missile veers off dramatically (much more to the side)
            const fizzlePoint = {
              x: missPoint.x + perpX * 40, // Veer 40 pixels to the side (much more dramatic)
              y: missPoint.y + perpY * 40,
            };
            
            // Create more dramatic sparks (more particles, bigger)
            const sparks = [];
            for (let i = 0; i < 30; i++) {
              const angle = (Math.PI * 2 * i) / 30 + (Math.random() - 0.5) * 0.8;
              const speed = 1.5 + Math.random() * 3;
              sparks.push({
                x: fizzlePoint.x,
                y: fizzlePoint.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                size: 1.5 + Math.random() * 3,
              });
            }
            
            // Create more dramatic smoke (more particles, bigger)
            const smoke = [];
            for (let i = 0; i < 15; i++) {
              const angle = (Math.PI * 2 * i) / 15 + (Math.random() - 0.5) * 0.5;
              const speed = 0.5 + Math.random() * 1.5;
              smoke.push({
                x: fizzlePoint.x,
                y: fizzlePoint.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 0.8, // Float upward more
                life: 1.0,
                size: 4 + Math.random() * 6,
              });
            }
            
            t.dudAnimation = {
              progress: 0,
              startTime: performance.now(),
              fizzlePoint,
              sparks,
              smoke,
            };
          }
          
          // Draw dud animation when we reach the miss point (where it veers off)
          if (t.dudAnimation && isAtMissPoint) {
            const dudTime = (now - t.dudAnimation.startTime) / 1000;
            const dudDuration = 3.0; // 3 second animation (longer for dramatic effect)
            const dudProgress = Math.min(1, dudTime / dudDuration);
            
            // Always draw dud animation if it exists (even if progress >= 1, just fade it out)
            if (dudProgress < 1.5) {  // Extend slightly to show fade out
            const fp = t.dudAnimation.fizzlePoint;
            
            // Update sparks
            for (const spark of t.dudAnimation.sparks) {
              spark.x += spark.vx;
              spark.y += spark.vy;
              spark.vx *= 0.92; // Slow down quickly
              spark.vy *= 0.92;
              spark.life -= 0.025;
            }
            
            // Update smoke
            for (const s of t.dudAnimation.smoke) {
              s.x += s.vx;
              s.y += s.vy;
              s.vx *= 0.97;
              s.vy *= 0.97;
              s.life -= 0.012;
              s.size += 0.3; // Smoke expands more
            }
            
            // Draw dramatic sparks (yellow/orange/red for fizzle)
            for (const spark of t.dudAnimation.sparks) {
              if (spark.life > 0) {
                const alpha = spark.life * (1 - dudProgress * 0.7);
                // Vibrant orange to yellow gradient
                const intensity = spark.life;
                const r = 255;
                const g = Math.floor(100 + intensity * 155);
                const b = 0;
                ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
                ctx.shadowBlur = 8;
                ctx.shadowColor = `rgba(${r},${g},${b},${alpha})`;
                ctx.beginPath();
                ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
              }
            }
            
            // Draw dramatic smoke (gray/white puffs with more opacity)
            for (const s of t.dudAnimation.smoke) {
              if (s.life > 0) {
                const alpha = s.life * (1 - dudProgress * 0.5) * 0.8;
                const gray = Math.floor(180 + s.life * 75);
                ctx.fillStyle = `rgba(${gray},${gray},${gray},${alpha})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            
            // Draw dramatic fizzle point (bigger, more visible)
            const fizzleAlpha = (1 - dudProgress) * 0.8;
            const fizzleRadius = 8 + dudProgress * 5;
            
            // Outer glow
            const grd = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fizzleRadius * 2);
            grd.addColorStop(0, `rgba(255,165,0,${fizzleAlpha * 0.6})`);
            grd.addColorStop(0.5, `rgba(255,200,0,${fizzleAlpha * 0.3})`);
            grd.addColorStop(1, `rgba(255,165,0,0)`);
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(fp.x, fp.y, fizzleRadius * 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Inner circle
            ctx.fillStyle = `rgba(255,165,0,${fizzleAlpha})`;
            ctx.beginPath();
            ctx.arc(fp.x, fp.y, fizzleRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw "MISS!" text effect (big, bold, dramatic)
            if (dudProgress < 0.6) {
              const textAlpha = (1 - dudProgress * 1.67) * 1.0; // Fade out over first 60%
              const fontSize = 24 + (1 - dudProgress * 1.67) * 12; // Shrink from 36 to 24
              
              // Text shadow/glow
              ctx.shadowBlur = 15;
              ctx.shadowColor = `rgba(255,0,0,${textAlpha * 0.8})`;
              
              // Main "MISS!" text
              ctx.fillStyle = `rgba(255,0,0,${textAlpha})`;
              ctx.font = `bold ${fontSize}px monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('MISS!', fp.x, fp.y - 25);
              
              // Outline for visibility
              ctx.strokeStyle = `rgba(255,255,255,${textAlpha * 0.8})`;
              ctx.lineWidth = 2;
              ctx.strokeText('MISS!', fp.x, fp.y - 25);
              
              ctx.shadowBlur = 0;
            }
            
            // Draw "pfft" text below (smaller, secondary)
            if (dudProgress < 0.4) {
              ctx.fillStyle = `rgba(255,165,0,${(1 - dudProgress * 2.5) * 0.9})`;
              ctx.font = 'bold 14px monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('pfft...', fp.x, fp.y + 10);
            }
            }
          }
        }
      }


      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);

    return () => cancelAnimationFrame(raf);
  }, [fpsCap, transparentBackground]);

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded-2xl border border-slate-700/60 shadow-lg"
        style={{ minHeight: `${height}px` }}
      />
    </div>
  );
}

