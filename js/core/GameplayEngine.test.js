/**
 * Unit tests for GameplayEngine — OBB projection & SAT collision detection.
 *
 * Tests cover:
 *   1. `proj` — OBB projection onto arbitrary axes (standalone replica)
 *   2. `obbIntersect` — full SAT collision between two OBBs (integration)
 *   3. `_shiftedObbCollision` — collision after displacement
 */

// ── MOck render dependencies ─────────────────────────────────────────────────
jest.mock('../render.js', () => ({
  ctx: { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect: jest.fn(), strokeRect: jest.fn(), fillText: jest.fn(), measureText: jest.fn(() => ({ width: 40 })),
    beginPath: jest.fn(), arc: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
    fill: jest.fn(), stroke: jest.fn(), save: jest.fn(), restore: jest.fn(), translate: jest.fn(), rotate: jest.fn(), resetTransform: jest.fn() },
  SCREEN_WIDTH: 375,
  SCREEN_HEIGHT: 667,
}));

jest.mock('../render/PigRenderer.js', () => {
  return function () { this.render = jest.fn(); this.renderGhost = jest.fn(); };
});

const GameplayEngine = require('./GameplayEngine.js');

// ── Replica of the `proj` closure (lines 212–216) ───────────────────────────
// OBB projection for SAT: returns [min, max] interval on axis (ax, ay).
function proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, ax, ay) {
  const cp = cx * ax + cy * ay;
  const r = Math.abs(hw * (cosL * ax + sinL * ay)) + Math.abs(hh * (cosP * ax + sinP * ay));
  return [cp - r, cp + r];
}

// ── Test utility: build a minimal engine with holes and pigs ─────────────────
function makeEngine(rows = 5, cols = 5) {
  const engine = new GameplayEngine();
  engine.rows = rows;
  engine.cols = cols;
  engine.scaledDiameter = 30;
  engine.scaledHalfDiameter = 15;
  engine.hSpacing = engine.scaledDiameter + 10;  // hGap=10
  engine.vSpacing = engine.scaledDiameter + 10;   // vGap=10
  engine.boardScale = 1;
  engine.computeHoles();
  engine.pigs = [];
  return engine;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. `proj` — Standalone projection function
// ═════════════════════════════════════════════════════════════════════════════
describe('proj — OBB projection (SAT)', () => {

  // ── Normal: axis-aligned OBB at origin ────────────────────────────────────
  describe('axis-aligned OBB at origin', () => {
    // OBB: center=(0,0), half-width=3 (along X), half-height=2 (along Y)
    const cx = 0, cy = 0, hw = 3, hh = 2;
    const cosL = 1, sinL = 0;  // local X = world X
    const cosP = 0, sinP = 1;  // local Y = world Y

    test('projection onto world X axis', () => {
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 1, 0);
      expect(min).toBeCloseTo(-3);
      expect(max).toBeCloseTo(3);
    });

    test('projection onto world Y axis', () => {
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 0, 1);
      expect(min).toBeCloseTo(-2);
      expect(max).toBeCloseTo(2);
    });

    test('projection onto diagonal (1,0) / √1', () => {
      // axis unit = (1,0) — same as X,  min = -3
      // But wait, (1,0) IS the X axis.
      // Let's use a real diagonal: (1, 1) → normalize to (√2/2, √2/2).
      const invSqrt2 = Math.SQRT1_2; // ≈ 0.7071
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, invSqrt2, invSqrt2);
      // half-width  contribution: |3 * 1*invSqrt2 + 0| = 3*invSqrt2 ≈ 2.121
      // half-height contribution: |2 * 0*invSqrt2 + 1| = 2*invSqrt2 ≈ 1.414
      // r ≈ 3.5355
      const expectedR = (3 + 2) * invSqrt2;
      expect(min).toBeCloseTo(-expectedR);
      expect(max).toBeCloseTo(expectedR);
    });

    test('projection onto negative Y axis', () => {
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 0, -1);
      // cp = 0; hw term = 0; hh term = |2 * -1| = 2; r = 2
      expect(min).toBeCloseTo(-2);
      expect(max).toBeCloseTo(2);
    });
  });

  // ── Normal: rotated OBB (90°) ─────────────────────────────────────────────
  describe('90° rotated OBB', () => {
    // cosL=(0,1), cosP=(-1,0)  →  length now along Y
    const cx = 0, cy = 0, hw = 5, hh = 2;
    const cosL = 0, sinL = 1;
    const cosP = -1, sinP = 0;

    test('projection onto world X axis', () => {
      // hw contribution: |5 * (0*1+1*0)| = 0
      // hh contribution: |2 * (-1*1+0*0)| = 2
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 1, 0);
      expect(min).toBeCloseTo(-2);
      expect(max).toBeCloseTo(2);
    });

    test('projection onto world Y axis', () => {
      // hw: |5 * (0*0+1*1)| = 5
      // hh: |2 * (-1*0+0*1)| = 0
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 0, 1);
      expect(min).toBeCloseTo(-5);
      expect(max).toBeCloseTo(5);
    });
  });

  // ── Normal: 45° rotated OBB ───────────────────────────────────────────────
  describe('45° rotated OBB', () => {
    const rad = Math.PI / 4;
    const cosL = Math.cos(rad), sinL = -Math.sin(rad);  // matches getPigRect
    const cosP = Math.sin(rad), sinP = Math.cos(rad);
    const cx = 0, cy = 0, hw = 4, hh = 2;

    test('projection onto world X axis', () => {
      const invSqrt2 = Math.SQRT1_2;
      const [min, max] = proj(cx, cy, hw, hh, cosL, sinL, cosP, sinP, 1, 0);
      // hw*cosL*ax = 4*invSqrt2*1 = 4*invSqrt2
      // hh*cosP*ax = 2*invSqrt2*1 = 2*invSqrt2
      // r = 6*invSqrt2 ≈ 4.2426
      const expectedR = (hw + hh) * invSqrt2;
      expect(min).toBeCloseTo(-expectedR);
      expect(max).toBeCloseTo(expectedR);
    });
  });

  // ── Normal: non-origin center ─────────────────────────────────────────────
  describe('offset center', () => {
    test('center (10, -5) should shift interval by dot(center, axis)', () => {
      const [min, max] = proj(10, -5, 3, 2, 1, 0, 0, 1, 1, 0);
      // cp = 10*1 + (-5)*0 = 10; r = 3
      expect(min).toBeCloseTo(7);
      expect(max).toBeCloseTo(13);
    });

    test('center (3, 4), axis = unit of (3,4) → cp = 25 / 5 = 5', () => {
      // axis length = √(9+16) = 5, unit = (0.6, 0.8)
      const ax = 0.6, ay = 0.8;
      const [min, max] = proj(3, 4, 1, 1, 1, 0, 0, 1, ax, ay);
      // cp = 3*0.6 + 4*0.8 = 1.8 + 3.2 = 5.0
      // r = |1*(1*0.6+0*0.8)| + |1*(0*0.6+1*0.8)| = 0.6+0.8 = 1.4
      expect(min).toBeCloseTo(3.6);
      expect(max).toBeCloseTo(6.4);
    });
  });

  // ── Normal: square OBB, various projection directions ─────────────────────
  describe('unit square OBB projection invariance', () => {
    // 1×1 square at origin, axis-aligned
    test.each([
      [1, 0, 'X axis'],
      [0, 1, 'Y axis'],
      [Math.SQRT1_2, Math.SQRT1_2, '45°'],
      [-1, 0, '-X axis'],
      [0, -1, '-Y axis'],
      [0.6, 0.8, '3-4-5 direction'],
    ])('half-extent ≥ 0.5 for %s', (ax, ay) => {
      const [min, max] = proj(0, 0, 0.5, 0.5, 1, 0, 0, 1, ax, ay);
      // For a unit square, projection half-extent should be ≥ 0.5
      // AND max - min = 2*r should be ≥ 1.0 (= square side)
      expect(max - min).toBeGreaterThanOrEqual(1.0);
      expect(min).toBeCloseTo(-max, 5); // symmetric about origin
    });
  });

  // ── Boundary: zero-extent OBB (point) ────────────────────────────────────
  describe('zero extents (point OBB)', () => {
    test('hw=0, hh=0, center=origin → [0, 0]', () => {
      const [min, max] = proj(0, 0, 0, 0, 1, 0, 0, 1, 0.6, 0.8);
      expect(min).toBe(0);
      expect(max).toBe(0);
    });

    test('hw=0, hh=0, center ≠ origin → single point', () => {
      const [min, max] = proj(5, -3, 0, 0, 1, 0, 0, 1, 1, 0);
      expect(min).toBe(5);
      expect(max).toBe(5);
      expect(min).toBe(max);
    });
  });

  // ── Boundary: line OBB (one extent = 0) ──────────────────────────────────
  describe('line OBB (degenerate rectangle)', () => {
    test('hw > 0, hh = 0 projects as interval', () => {
      const [min, max] = proj(0, 0, 3, 0, 1, 0, 0, 1, 1, 0);
      expect(min).toBeCloseTo(-3);
      expect(max).toBeCloseTo(3);
    });

    test('hw = 0, hh > 0 projects as interval', () => {
      const [min, max] = proj(0, 0, 0, 4, 1, 0, 0, 1, 0, 1);
      expect(min).toBeCloseTo(-4);
      expect(max).toBeCloseTo(4);
    });

    test('hh = 0, projection onto perpendicular axis → [cp, cp]', () => {
      // OBB length along X → local-Y projection on Y axis = 0*hh = 0
      const [min, max] = proj(0, 0, 5, 0, 1, 0, 0, 1, 0, 1);
      expect(min).toBe(0);
      expect(max).toBe(0);
    });
  });

  // ── Boundary: large values ────────────────────────────────────────────────
  describe('large values', () => {
    test('very large hw/hh', () => {
      const [min, max] = proj(0, 0, 1e6, 1e6, 1, 0, 0, 1, 1, 0);
      expect(min).toBeCloseTo(-1e6);
      expect(max).toBeCloseTo(1e6);
    });

    test('negative center coordinates', () => {
      const [min, max] = proj(-100, -200, 10, 5, 1, 0, 0, 1, 1, 0);
      expect(min).toBeCloseTo(-110);
      expect(max).toBeCloseTo(-90);
    });
  });

  // ── Boundary: zero projection axis ───────────────────────────────────────
  describe('zero projection axis', () => {
    test('(0, 0) axis → cp=0, r=0', () => {
      const [min, max] = proj(10, 20, 3, 2, 1, 0, 0, 1, 0, 0);
      // cp = 10*0+20*0 = 0
      // r = |3*(1*0+0*0)| + |2*(0*0+1*0)| = 0+0 = 0
      expect(min).toBe(0);
      expect(max).toBe(0);
    });
  });

  // ── Invariant: interval width = 2r, independent of center ─────────────────
  describe('invariant: interval width independent of center', () => {
    test('same OBB at two different centers → same width', () => {
      const o = { hw: 3, hh: 2, cosL: 1, sinL: 0, cosP: 0, sinP: 1 };
      const [min1, max1] = proj(0, 0, o.hw, o.hh, o.cosL, o.sinL, o.cosP, o.sinP, 1, 0);
      const [min2, max2] = proj(100, 200, o.hw, o.hh, o.cosL, o.sinL, o.cosP, o.sinP, 1, 0);
      const w1 = max1 - min1;
      const w2 = max2 - min2;
      expect(w1).toBeCloseTo(w2);
      expect(w1).toBeCloseTo(6); // 2 * hw
    });
  });

  // ── Invariant: min ≤ max always ──────────────────────────────────────────
  describe('invariant: min ≤ max', () => {
    const axes = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
      [Math.SQRT1_2, Math.SQRT1_2],
      [Math.SQRT1_2, -Math.SQRT1_2],
      [0.6, 0.8],
    ];
    const obbs = [
      [3, 2, 1, 0, 0, 1],
      [5, 1, 0.707, -0.707, 0.707, 0.707],
      [0, 0, 1, 0, 0, 1],
      [7, 3, 0.6, -0.8, 0.8, 0.6],
    ];
    test.each(
      axes.flatMap(([ax, ay]) =>
        obbs.map(([hw, hh, cl, sl, cp, sp]) => ({ ax, ay, hw, hh, cl, sl, cp, sp }))
      ).slice(0, 12)
    )('min≤max for hw=$hw hh=$hh on axis ($ax, $ay)', ({ ax, ay, hw, hh, cl, sl, cp, sp }) => {
      const [min, max] = proj(3, -4, hw, hh, cl, sl, cp, sp, ax, ay);
      expect(min).toBeLessThanOrEqual(max);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. `obbIntersect` — integration tests using the real proj closure
// ═════════════════════════════════════════════════════════════════════════════
describe('obbIntersect — SAT collision detection', () => {
  let engine;

  beforeEach(() => {
    engine = new GameplayEngine();
  });

  // ── Builder helper: create an OBB descriptor ──────────────────────────────
  function obb(cx, cy, collisionHw, collisionHh, cosL, sinL, cosP, sinP) {
    return { cx, cy, collisionHw, collisionHh, cosL, sinL, cosP, sinP };
  }

  test('two identical axis-aligned OBBs at same position intersect', () => {
    const a = obb(0, 0, 3, 2, 1, 0, 0, 1);
    const b = obb(0, 0, 3, 2, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(true);
  });

  test('far apart axis-aligned OBBs do not intersect', () => {
    const a = obb(0, 0, 3, 2, 1, 0, 0, 1);
    const b = obb(100, 0, 3, 2, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(false);
  });

  test('touching OBBs (edge contact) detected on X axis', () => {
    // a: [-3, 3], b: [3, 9] → edges meet at 3
    const a = obb(0, 0, 3, 2, 1, 0, 0, 1);
    const b = obb(6, 0, 3, 2, 1, 0, 0, 1);
    // a min= -3 max=3, b min= 3 max=9 → maxA(3) ≥ minB(3) ✓
    expect(engine.obbIntersect(a, b)).toBe(true);
  });

  test('barely separated OBBs do not intersect', () => {
    // a: [-3, 3], b: [3.001, 9.001] → maxA(3) < minB(3.001)
    const a = obb(0, 0, 3, 2, 1, 0, 0, 1);
    const b = obb(6.001, 0, 3, 2, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(false);
  });

  test('overlapping but offset OBBs intersect', () => {
    // a: [-3, 3] on X; b: center (2, 0) → b: [-1, 5] → overlap [ -1, 3 ]
    const a = obb(0, 0, 3, 2, 1, 0, 0, 1);
    const b = obb(2, 0, 3, 2, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(true);
  });

  test('rotated OBBs that overlap via SAT', () => {
    // Two squares, slightly rotated, overlapping
    const a = obb(0, 0, 4, 4, Math.cos(0), Math.sin(0), Math.cos(Math.PI / 2), Math.sin(Math.PI / 2));
    const b = obb(3, 3, 4, 4, Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), Math.cos(Math.PI / 4 * 3), Math.sin(Math.PI / 4 * 3));
    // They should intersect even though rotated (centers only 4.24 apart, width ~5.66)
    expect(engine.obbIntersect(a, b)).toBe(true);
  });

  test('rotated non-overlapping OBBs', () => {
    const a = obb(0, 0, 2, 2, 1, 0, 0, 1);
    const b = obb(10, 10, 2, 2, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(false);
  });

  test('point-like OBB (zero extents) at same point intersect', () => {
    const a = obb(1, 2, 0, 0, 1, 0, 0, 1);
    const b = obb(1, 2, 0, 0, 1, 0, 0, 1);
    expect(engine.obbIntersect(a, b)).toBe(true);
  });

  test('point-like OBBs at different points do not intersect', () => {
    const a = obb(0, 0, 0, 0, 1, 0, 0, 1);
    const b = obb(0.001, 0, 0, 0, 1, 0, 0, 1);
    // Two distinct points should not intersect
    expect(engine.obbIntersect(a, b)).toBe(false);
  });

  test('one OBB fully contains another → intersect', () => {
    const outer = obb(0, 0, 10, 10, 1, 0, 0, 1);
    const inner = obb(2, 3, 2, 1, 1, 0, 0, 1);
    expect(engine.obbIntersect(outer, inner)).toBe(true);
    expect(engine.obbIntersect(inner, outer)).toBe(true); // symmetric
  });

  test('symmetry: intersect(a, b) === intersect(b, a)', () => {
    const a = obb(1, 2, 3, 1.5, Math.cos(0.3), -Math.sin(0.3), Math.sin(0.3), Math.cos(0.3));
    const b = obb(4, -1, 2, 2, Math.cos(-0.5), -Math.sin(-0.5), Math.sin(-0.5), Math.cos(-0.5));
    expect(engine.obbIntersect(a, b)).toBe(engine.obbIntersect(b, a));
  });

  test('same OBB rotated 90° does not self-misdetect (consistent)', () => {
    // Same OBB at same location always intersects itself
    const a = obb(5, 5, 3, 2, 0, 1, -1, 0); // 90° rotated
    expect(engine.obbIntersect(a, a)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. `_shiftedObbCollision` — collision after displacement
// ═════════════════════════════════════════════════════════════════════════════
describe('_shiftedObbCollision', () => {
  test('returns -1 when no pigs exist', () => {
    const engine = makeEngine();
    const rect = { cx: 0, cy: 0, collisionHw: 3, collisionHh: 2, cosL: 1, sinL: 0, cosP: 0, sinP: 1 };
    expect(engine._shiftedObbCollision(rect, 5, 0, -1)).toBe(-1);
  });

  test('returns other pig id when collision detected', () => {
    const engine = makeEngine();
    // Put a pig at hole[0]; get its OBB rect and test shift into it
    engine.pigs = [{ id: 42, tailIndex: 0, length: 3, angle: 0 }];
    // Get the rect for pig 42, then shift another rect into it
    const pigRect = engine.getPigRect(0, 3, 0);
    const otherRect = {
      ...pigRect,
      cx: pigRect.cx + engine.scaledDiameter, // shift so they overlap
      cy: pigRect.cy,
    };
    // moving left by -scaledDiameter should collide
    const result = engine._shiftedObbCollision(otherRect, -6, 0, 99);
    expect(result).toBe(42);
  });

  test('returns -1 when shifted away from pig', () => {
    const engine = makeEngine();
    engine.pigs = [{ id: 10, tailIndex: 4, length: 3, angle: 0 }];
    const pigRect = engine.getPigRect(4, 3, 0);
    const farRect = {
      ...pigRect,
      cx: pigRect.cx + 200,
      cy: pigRect.cy,
    };
    expect(engine._shiftedObbCollision(farRect, 0, 0, 99)).toBe(-1);
  });

  test('excludes self from collision check', () => {
    const engine = makeEngine();
    engine.pigs = [{ id: 1, tailIndex: 0, length: 3, angle: 0 }];
    const rect = engine.getPigRect(0, 3, 0);
    // Shift into itself — but exclude its own id
    expect(engine._shiftedObbCollision(rect, 0, 0, 1)).toBe(-1);
  });
});
