'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A spring that moves at the speed the market is moving.
 *
 * The problem with a tween is that its duration is a constant you chose, so a $1 tick and a $50
 * crash both take 300ms. Small moves look twitchy, big moves look sluggish, and the motion
 * carries no information. A spring's speed falls out of the physics instead: force is
 * proportional to how far it has to go, so a violent move is violent for free.
 *
 * The property that makes a trend feel like a trend is **velocity inheritance**. When a new
 * target arrives mid-flight we do NOT reset `v`. Momentum carries into the next leg, so ticks
 * pushing the same way compound into visible acceleration, while chop cancels itself out and
 * stays calm. That is the whole effect, and it is one line: never touch `v` when the target
 * changes.
 */
export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** Stop overshooting the target. Required for anything that draws a real price: a spring that
   *  rings past the value is rendering a trade that never happened. */
  clamp?: boolean;
  /** Below this displacement and speed, snap and idle. Keeps a dead market from burning a
   *  rAF frame forever on sub-pixel motion. */
  restDelta?: number;
}

const DEFAULTS: Required<SpringConfig> = {
  stiffness: 210,
  damping: 26,
  mass: 1,
  clamp: true,
  restDelta: 0.001,
};

/** Fixed substep. Integrating with a raw frame delta makes a stiff spring explode when the tab
 *  stutters, so time is consumed in slices small enough to stay stable. */
const STEP_MS = 4;
const MAX_CATCHUP_MS = 64;

export function useSpring(target: number, config: SpringConfig = {}) {
  const c = { ...DEFAULTS, ...config };
  const [value, setValue] = useState(target);
  const [velocity, setVelocity] = useState(0);

  const state = useRef({ x: target, v: 0, target });
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);

  // Retarget WITHOUT clearing velocity. This is the inheritance.
  state.current.target = target;

  useEffect(() => {
    const tick = (now: number) => {
      const s = state.current;
      // A backgrounded tab hands back a huge delta; cap it rather than simulating the gap.
      const dt = Math.min(now - (last.current ?? now), MAX_CATCHUP_MS);
      last.current = now;

      let remaining = dt;
      while (remaining > 0) {
        const h = Math.min(STEP_MS, remaining) / 1000;
        remaining -= STEP_MS;
        const displacement = s.x - s.target;
        const springForce = -c.stiffness * displacement;
        const dampingForce = -c.damping * s.v;
        const a = (springForce + dampingForce) / c.mass;
        s.v += a * h;
        s.x += s.v * h;

        if (c.clamp) {
          // Crossed the target means it would ring past it; land exactly instead.
          const overshot = displacement === 0 ? false : Math.sign(s.x - s.target) !== Math.sign(displacement);
          if (overshot) { s.x = s.target; s.v = 0; }
        }
      }

      const atRest = Math.abs(s.x - s.target) < c.restDelta && Math.abs(s.v) < c.restDelta;
      if (atRest) { s.x = s.target; s.v = 0; }

      setValue(s.x);
      setVelocity(s.v);

      // Idle when nothing is happening; wake on the next retarget.
      raf.current = atRest ? null : requestAnimationFrame(tick);
      if (atRest) last.current = null;
    };

    if (raf.current === null) {
      last.current = null;
      raf.current = requestAnimationFrame(tick);
    }
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // Re-arm whenever the target moves, which is what restarts an idled spring.
  }, [target, c.stiffness, c.damping, c.mass, c.clamp, c.restDelta]);

  return { value, velocity };
}

/**
 * The two-follower pattern, which is what actually sells speed.
 *
 * One stiff spring for the dot, one loose one for the line behind it. During a hard move they
 * visibly separate, and that stretch is what the eye reads as velocity; when the market goes
 * quiet they converge and the chart tightens up. You get speed for free out of the gap between
 * two damping constants rather than by animating anything extra.
 */
export function useLivePrice(target: number) {
  const dot = useSpring(target, { stiffness: 210, damping: 26 });
  const line = useSpring(target, { stiffness: 120, damping: 20 });
  return {
    dot: dot.value,
    line: line.value,
    velocity: dot.velocity,
    /** 0..1 intensity for glow radius, line brightness, trail length. */
    intensity: Math.min(1, Math.abs(dot.velocity) / 40),
    stretch: dot.value - line.value,
  };
}
