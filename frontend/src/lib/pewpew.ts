/** Pew-pew domain types, colors, and demo generator. */
import type { LatLng } from './geo';

export type PewEvent = {
  id: string;
  attack_id?: string; // Link to game attack
  ts: number; // epoch ms
  from: LatLng;
  to: LatLng;
  severity: 'low' | 'med' | 'high' | 'critical';
  color?: string; // override neon
  state?: 'launched' | 'blocked' | 'hit' | 'miss'; // Attack state
  result?: 'blocked' | 'hit' | 'miss'; // Final result
};

export const COLORS = {
  arc: {
    low: 'rgba(56,189,248,0.85)', // cyan-400
    med: 'rgba(99,102,241,0.90)', // indigo-500
    high: 'rgba(236,72,153,0.95)', // pink-500
    critical: 'rgba(244,63,94,0.95)', // rose-500
  },
  dot: 'rgba(250,250,250,1)',
  tail: 'rgba(148,163,184,0.25)',
};

export function neonForSeverity(s: PewEvent['severity']): string {
  return COLORS.arc[s];
}

/**
 * Lightweight demo stream (only used if WS isn't available).
 */
export function* demoPewStream(): Generator<PewEvent, void, unknown> {
  const cities: LatLng[] = [
    { lat: 37.7749, lng: -122.4194 }, // SF
    { lat: 40.7128, lng: -74.006 }, // NYC
    { lat: 51.5074, lng: -0.1278 }, // London
    { lat: 48.8566, lng: 2.3522 }, // Paris
    { lat: 35.6762, lng: 139.6503 }, // Tokyo
    { lat: 1.3521, lng: 103.8198 }, // Singapore
    { lat: 52.52, lng: 13.405 }, // Berlin
    { lat: -33.8688, lng: 151.2093 }, // Sydney
  ];

  const pick = () => cities[Math.floor(Math.random() * cities.length)];
  const sev: Array<PewEvent['severity']> = ['low', 'med', 'high', 'critical'];

  while (true) {
    let a = pick();
    let b = pick();
    while (b.lat === a.lat && b.lng === a.lng) {
      b = pick();
    }

    const s = sev[Math.floor(Math.random() * sev.length)];
    yield {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      ts: Date.now(),
      from: a,
      to: b,
      severity: s,
    };
  }
}

// Red Team base location (e.g., Moscow)
const RED_BASE: LatLng = { lat: 55.7558, lng: 37.6173 }; // Moscow

// Blue Team base location (e.g., Washington DC)
const BLUE_BASE: LatLng = { lat: 38.9072, lng: -77.0369 }; // Washington DC

/**
 * Convert game events to pew-pew events.
 * Maps attack events: Red team launches from Red base to Blue base.
 * Shows shield animation for blocked, explosion for hit.
 */
export function toPewEvents(events: any[]): PewEvent[] {
  const pewEvents: PewEvent[] = [];
  const attackMap = new Map<string, PewEvent>(); // Track attacks by attack_id

  for (const event of events) {
    const payload = event.payload || {};
    
    if (event.kind === 'attack_launched') {
      // Attack launched: Red team fires toward Blue base
      const attackId = payload.attack_id || event.id;
      
      // Map attack type to severity
      const attackType = payload.attack_type || '';
      let severity: PewEvent['severity'] = 'med';
      if (attackType.toLowerCase().includes('rce') || attackType.toLowerCase().includes('critical')) {
        severity = 'critical';
      } else if (attackType.toLowerCase().includes('sqli') || attackType.toLowerCase().includes('exfil')) {
        severity = 'high';
      } else if (attackType.toLowerCase().includes('phishing')) {
        severity = 'low';
      }

      const pewEvent: PewEvent = {
        id: event.id || String(Math.random()),
        attack_id: attackId,
        ts: new Date(event.ts || Date.now()).getTime(),
        from: RED_BASE, // Red team base
        to: BLUE_BASE, // Blue team base
        severity,
        state: 'launched',
      };

      attackMap.set(attackId, pewEvent);
      pewEvents.push(pewEvent);
    } else if (event.kind === 'attack_resolved') {
      // Attack resolved: Only process final resolutions (not preliminary)
      const attackId = payload.attack_id;
      console.log('[toPewEvents] Processing attack_resolved:', event.id, 'attack_id:', attackId, 'result:', payload.result, 'preliminary:', payload.preliminary);
      if (!attackId) {
        console.log('[toPewEvents] Skipping attack_resolved - no attack_id');
        continue;
      }
      
      // Skip preliminary resolutions - only show final results after Blue responds
      if (payload.preliminary === true) {
        console.log('[toPewEvents] Skipping preliminary attack_resolved');
        continue;
      }
      
      console.log('[toPewEvents] Processing final attack_resolved for attack_id:', attackId, 'result:', payload.result);

      // Find existing attack or create new one
      let pewEvent = attackMap.get(attackId);
      if (!pewEvent) {
        // Create new event if we missed the launch
        pewEvent = {
          id: event.id || String(Math.random()),
          attack_id: attackId,
          ts: new Date(event.ts || Date.now()).getTime(),
          from: RED_BASE,
          to: BLUE_BASE,
          severity: 'med',
          state: 'launched',
        };
        attackMap.set(attackId, pewEvent);
      }

      // Update with result - create a new event for the resolution
      const result = payload.result || 'hit';
      // Map new result types to legacy states for backward compatibility
      let state: 'blocked' | 'hit' | 'miss' = 'hit';
      if (result === 'blocked' || result === 'successful_block' || result === 'successful_mitigation') {
        state = 'blocked';
      } else if (result === 'miss') {
        state = 'miss';
      } else {
        state = 'hit';
      }
      
      const resolvedEvent: PewEvent = {
        ...pewEvent,
        id: `${pewEvent.id}-resolved`, // New ID for resolution event
        result,
        state,
        ts: new Date(event.ts || Date.now()).getTime(),
      };
      
      pewEvents.push(resolvedEvent);
    }
  }

  return pewEvents;
}

