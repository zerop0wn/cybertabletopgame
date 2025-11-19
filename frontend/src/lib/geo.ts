/** Geographic projection and great-circle utilities. */

export type LatLng = { lat: number; lng: number };
export type XY = { x: number; y: number };

/**
 * Simple equirectangular projection to canvas (fits 0..W, 0..H).
 */
export function projectEquirect(lat: number, lng: number, W: number, H: number): XY {
  const x = ((lng + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return { x, y };
}

/**
 * Great-circle interpolation using spherical linear interpolation (slerp).
 */
export function greatCirclePoints(a: LatLng, b: LatLng, samples: number): LatLng[] {
  // Convert to radians and unit vectors
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const [φ1, λ1, φ2, λ2] = [toRad(a.lat), toRad(a.lng), toRad(b.lat), toRad(b.lng)];
  
  const v1 = [
    Math.cos(φ1) * Math.cos(λ1),
    Math.cos(φ1) * Math.sin(λ1),
    Math.sin(φ1),
  ];
  
  const v2 = [
    Math.cos(φ2) * Math.cos(λ2),
    Math.cos(φ2) * Math.sin(λ2),
    Math.sin(φ2),
  ];

  // Angle between vectors
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const ω = Math.acos(Math.min(1, Math.max(-1, dot)));

  if (ω === 0) return Array(samples).fill(a);

  const sinω = Math.sin(ω);
  const pts: LatLng[] = [];

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const s1 = Math.sin((1 - t) * ω) / sinω;
    const s2 = Math.sin(t * ω) / sinω;

    const x = s1 * v1[0] + s2 * v2[0];
    const y = s1 * v1[1] + s2 * v2[1];
    const z = s1 * v1[2] + s2 * v2[2];

    const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
    const λ = Math.atan2(y, x);

    pts.push({ lat: toDeg(φ), lng: toDeg(λ) });
  }

  return pts;
}

/** Clamp helper */
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

