/**
 * Unit tests for GameplayEngine — OBB projection, SAT collision detection & hole computation.
 *
 * Tests cover:
 *   1. `proj` — OBB projection onto arbitrary axes (standalone replica)
 *   2. `obbIntersect` — full SAT collision between two OBBs (integration)
 *   3. `_shiftedObbCollision` — collision after displacement
 *   4. `computeHoles` — hole array generation (grid + diagonal)
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

// ═════════════════════════════════════════════════════════════════════════════
// 4. `computeHoles` — hole array generation & index ordering
// ═════════════════════════════════════════════════════════════════════════════
describe('computeHoles — hole generation', () => {
  let engine;

  beforeEach(() => {
    engine = new GameplayEngine();
    engine.hSpacing = 40;   // diameter(30) + hGap(10) at boardScale=1
    engine.vSpacing = 40;
    engine.scaledDiameter = 30;
    engine.scaledHalfDiameter = 15;
    engine.boardScale = 1;
  });

  // ── Hole meta description check ───────────────────────────────
  test('default 5x5 board creates 25 grid + 16 diag = 41 holes', () => {
    engine.rows = 5;
    engine.cols = 5;
    engine.computeHoles();

    expect(engine.holes.length).toBe(41);
    // First 25 must be grid type
    const gridHoles = engine.holes.slice(0, 25);
    const diagHoles = engine.holes.slice(25);
    expect(gridHoles.every(h => h.type === 'grid')).toBe(true);
    expect(diagHoles.every(h => h.type === 'diag')).toBe(true);
    expect(diagHoles.length).toBe(16);
  });

  test('each hole contains x, y, type, row, col', () => {
    engine.rows = 5;
    engine.cols = 5;
    engine.computeHoles();
    const h = engine.holes[0];
    expect(h).toHaveProperty('x');
    expect(h).toHaveProperty('y');
    expect(h).toHaveProperty('type');
    expect(h).toHaveProperty('row');
    expect(h).toHaveProperty('col');
    expect(typeof h.x).toBe('number');
    expect(typeof h.y).toBe('number');
    expect(typeof h.type).toBe('string');
  });

  // ── Grid hole positions ───────────────────────────────────────
  describe('grid hole positions', () => {
    test('first grid hole at (hStep/2, vStep/2)', () => {
      engine.rows = 3;
      engine.cols = 3;
      engine.computeHoles();
      const first = engine.holes[0];
      expect(first.x).toBeCloseTo(engine.hSpacing / 2);
      expect(first.y).toBeCloseTo(engine.vSpacing / 2);
      expect(first.type).toBe('grid');
      expect(first.row).toBe(0);
      expect(first.col).toBe(0);
    });

    test('last grid hole position', () => {
      engine.rows = 3;
      engine.cols = 3;
      engine.computeHoles();
      const lastGridIdx = engine.rows * engine.cols - 1; // index 8
      const lastGrid = engine.holes[lastGridIdx];
      // col=2, row=2
      expect(lastGrid.x).toBeCloseTo(engine.hSpacing / 2 + 2 * engine.hSpacing);
      expect(lastGrid.y).toBeCloseTo(engine.vSpacing / 2 + 2 * engine.vSpacing);
      expect(lastGrid.row).toBe(2);
      expect(lastGrid.col).toBe(2);
    });

    test('grid hole row/col match loop variables', () => {
      engine.rows = 4;
      engine.cols = 3;
      engine.computeHoles();
      // Check a few representative grid holes
      const gridCount = engine.rows * engine.cols;
      for (let i = 0; i < gridCount; i++) {
        const h = engine.holes[i];
        expect(h.row).toBe(Math.floor(i / engine.cols));
        expect(h.col).toBe(i % engine.cols);
      }
    });
  });

  // ── Diagonal hole positions ───────────────────────────────────
  describe('diagonal hole positions', () => {
    test('first diag hole at (hStep/2 + hStep/2, vStep/2 + vStep/2)', () => {
      engine.rows = 5;
      engine.cols = 5;
      engine.computeHoles();
      const gridCount = engine.rows * engine.cols;
      const firstDiag = engine.holes[gridCount];
      expect(firstDiag.x).toBeCloseTo(engine.hSpacing);
      expect(firstDiag.y).toBeCloseTo(engine.vSpacing);
      expect(firstDiag.type).toBe('diag');
      expect(firstDiag.row).toBe(0);
      expect(firstDiag.col).toBe(0);
    });

    test('diag holes are offset by half spacing from grid', () => {
      engine.rows = 3;
      engine.cols = 3;
      engine.computeHoles();
      const gridCount = engine.rows * engine.cols; // 9
      const diagCount = (engine.rows - 1) * (engine.cols - 1); // 4

      // Each diag hole sits at the center of a 2x2 grid cell block
      for (let r = 0; r < engine.rows - 1; r++) {
        for (let c = 0; c < engine.cols - 1; c++) {
          const diagIdx = gridCount + r * (engine.cols - 1) + c;
          const diag = engine.holes[diagIdx];

          // Center of the four surrounding grid holes
          const topLeft = engine.holes[r * engine.cols + c];
          const topRight = engine.holes[r * engine.cols + c + 1];
          const bottomLeft = engine.holes[(r + 1) * engine.cols + c];
          const bottomRight = engine.holes[(r + 1) * engine.cols + c + 1];

          const centerX = (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4;
          const centerY = (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4;

          expect(diag.x).toBeCloseTo(centerX, 10);
          expect(diag.y).toBeCloseTo(centerY, 10);
        }
      }
    });
  });

  // ── Index ordering contract ────────────────────────────────────
  describe('index ordering', () => {
    test('grid holes are indices 0 to rows*cols-1', () => {
      engine.rows = 4;
      engine.cols = 6;
      engine.computeHoles();
      const gridCount = engine.rows * engine.cols;
      for (let i = 0; i < gridCount; i++) {
        expect(engine.holes[i].type).toBe('grid');
      }
      for (let i = gridCount; i < engine.holes.length; i++) {
        expect(engine.holes[i].type).toBe('diag');
      }
    });

    test('no gap between grid and diag sections', () => {
      engine.rows = 3;
      engine.cols = 4;
      engine.computeHoles();
      expect(engine.holes.length).toBe(3 * 4 + 2 * 3); // 18
      expect(engine.holes[12].type).toBe('diag');
      expect(engine.holes[11].type).toBe('grid');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────
  describe('edge cases', () => {
    test('1x1 board: 1 grid hole, 0 diag holes', () => {
      engine.rows = 1;
      engine.cols = 1;
      engine.computeHoles();
      expect(engine.holes.length).toBe(1);
      expect(engine.holes[0].type).toBe('grid');
      expect(engine.holes[0].row).toBe(0);
      expect(engine.holes[0].col).toBe(0);
    });

    test('1xN board: no diag holes', () => {
      engine.rows = 1;
      engine.cols = 5;
      engine.computeHoles();
      expect(engine.holes.length).toBe(5);
      expect(engine.holes.every(h => h.type === 'grid')).toBe(true);
    });

    test('Nx1 board: no diag holes', () => {
      engine.rows = 5;
      engine.cols = 1;
      engine.computeHoles();
      expect(engine.holes.length).toBe(5);
      expect(engine.holes.every(h => h.type === 'grid')).toBe(true);
    });

    test('2x2 board: 4 grid + 1 diag', () => {
      engine.rows = 2;
      engine.cols = 2;
      engine.computeHoles();
      expect(engine.holes.length).toBe(5);
      expect(engine.holes.filter(h => h.type === 'grid').length).toBe(4);
      expect(engine.holes.filter(h => h.type === 'diag').length).toBe(1);
    });

    test('2x3 board: 6 grid + 2 diag', () => {
      engine.rows = 2;
      engine.cols = 3;
      engine.computeHoles();
      expect(engine.holes.length).toBe(8);
      expect(engine.holes.filter(h => h.type === 'grid').length).toBe(6);
      expect(engine.holes.filter(h => h.type === 'diag').length).toBe(2);
    });

    test('3x2 board: 6 grid + 2 diag', () => {
      engine.rows = 3;
      engine.cols = 2;
      engine.computeHoles();
      expect(engine.holes.length).toBe(8);
      expect(engine.holes.filter(h => h.type === 'grid').length).toBe(6);
      expect(engine.holes.filter(h => h.type === 'diag').length).toBe(2);
    });

    test('asymmetric spacing (hSpacing ≠ vSpacing)', () => {
      engine.rows = 3;
      engine.cols = 3;
      engine.hSpacing = 50;
      engine.vSpacing = 30;
      engine.computeHoles();

      // Grid (0,0) vs (0,1): x differs by hSpacing
      expect(engine.holes[1].x - engine.holes[0].x).toBeCloseTo(50);
      // Grid (0,0) vs (1,0): y differs by vSpacing
      expect(engine.holes[3].y - engine.holes[0].y).toBeCloseTo(30);
      // Diag hole at correct offset
      const diag = engine.holes[9];
      expect(diag.x).toBeCloseTo(25 + 25); // hStep/2 + hStep/2 = 50
      expect(diag.y).toBeCloseTo(15 + 15); // vStep/2 + vStep/2 = 30
    });
  });

  // ── Idempotency ────────────────────────────────────────────────
  describe('idempotency and re-computation', () => {
    test('calling computeHoles twice produces same hole count', () => {
      engine.rows = 5;
      engine.cols = 5;
      engine.computeHoles();
      const count1 = engine.holes.length;
      engine.computeHoles();
      expect(engine.holes.length).toBe(count1);
    });

    test('recomputing after changing spacing updates positions', () => {
      engine.rows = 3;
      engine.cols = 3;
      engine.hSpacing = 40;
      engine.vSpacing = 40;
      engine.computeHoles();
      const oldY = engine.holes[4].y;

      engine.vSpacing = 60;
      engine.computeHoles();
      // Positions should reflect new spacing
      expect(engine.holes[4].y).not.toBeCloseTo(oldY, 0);
      expect(engine.holes[4].y).toBeCloseTo(60 / 2 + 1 * 60, 10); // my + row*vStep
    });
  });

  // ── General formula validation ─────────────────────────────────
  describe('formula correctness', () => {
    test.each([
      [1, 1, 1, 0],
      [1, 5, 5, 0],
      [2, 2, 4, 1],
      [3, 3, 9, 4],
      [4, 5, 20, 12],
      [5, 5, 25, 16],
      [6, 6, 36, 25],
      [7, 3, 21, 12],
      [11, 5, 55, 40], // simulating 0007.json: rows=11, cols=5
    ])('rows=%i cols=%i → %i grid + %i diag = %i total', (rows, cols, expGrid, expDiag) => {
      engine.rows = rows;
      engine.cols = cols;
      engine.computeHoles();
      const gridCount = engine.holes.filter(h => h.type === 'grid').length;
      const diagCount = engine.holes.filter(h => h.type === 'diag').length;
      expect(gridCount).toBe(expGrid);
      expect(diagCount).toBe(expDiag);
      expect(engine.holes.length).toBe(expGrid + expDiag);
    });
  });

  // ── Hole uniqueness ────────────────────────────────────────────
  describe('hole uniqueness', () => {
    test('no two holes share the same (x, y) coordinates', () => {
      engine.rows = 5;
      engine.cols = 5;
      engine.computeHoles();
      const seen = new Set();
      for (const h of engine.holes) {
        const key = `${h.x.toFixed(10)},${h.y.toFixed(10)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    test('grid and diag holes are spatially interleaved, not overlapping', () => {
      engine.rows = 4;
      engine.cols = 4;
      engine.computeHoles();
      const gridHoles = engine.holes.filter(h => h.type === 'grid');
      const diagHoles = engine.holes.filter(h => h.type === 'diag');

      // Every diag hole x is not equal to any grid hole x or y
      for (const diag of diagHoles) {
        for (const grid of gridHoles) {
          // Either x or y must differ (or both)
          const sameX = Math.abs(diag.x - grid.x) < 0.001;
          const sameY = Math.abs(diag.y - grid.y) < 0.001;
          expect(sameX && sameY).toBe(false);
        }
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. `computeHoles` — hole array generation (grid + diagonal)
// ═════════════════════════════════════════════════════════════════════════════
describe('computeHoles — hole array generation', () => {

  // ── helper: create engine with custom board params ─────────────────────────
  function makeHoleEngine(rows, cols, spacing = 40) {
    const engine = new GameplayEngine();
    engine.rows = rows;
    engine.cols = cols;
    engine.hSpacing = spacing;
    engine.vSpacing = spacing;
    return engine;
  }

  // ── Normal: 5×5 board ─────────────────────────────────────────────────────
  describe('5×5 board (default)', () => {
    let engine;

    beforeEach(() => {
      engine = makeEngine();
    });

    test('total hole count = rows*cols + (rows-1)*(cols-1)', () => {
      // 5×5 → 25 grid + 16 diag = 41
      expect(engine.holes.length).toBe(25 + 16);
    });

    test('first hole is grid hole at (mx, my)', () => {
      const h = engine.holes[0];
      const mx = engine.hSpacing / 2;
      const my = engine.vSpacing / 2;
      expect(h.x).toBeCloseTo(mx);
      expect(h.y).toBeCloseTo(my);
      expect(h.type).toBe('grid');
      expect(h.row).toBe(0);
      expect(h.col).toBe(0);
    });

    test('last grid hole is at (row=4, col=4)', () => {
      const gridCount = engine.rows * engine.cols; // 25
      const lastGrid = engine.holes[gridCount - 1];
      expect(lastGrid.type).toBe('grid');
      expect(lastGrid.row).toBe(engine.rows - 1);
      expect(lastGrid.col).toBe(engine.cols - 1);
    });

    test('first diagonal hole sits at center of first 2×2 quad', () => {
      const gridCount = engine.rows * engine.cols; // 25
      const firstDiag = engine.holes[gridCount];   // index 25
      expect(firstDiag.type).toBe('diag');
      expect(firstDiag.row).toBe(0);
      expect(firstDiag.col).toBe(0);
      // x = mx + hStep/2 + 0*hStep
      // y = my + vStep/2 + 0*vStep
      const mx = engine.hSpacing / 2;
      const my = engine.vSpacing / 2;
      expect(firstDiag.x).toBeCloseTo(mx + engine.hSpacing / 2);
      expect(firstDiag.y).toBeCloseTo(my + engine.vSpacing / 2);
    });

    test('last diagonal hole is at (row=rows-2, col=cols-2)', () => {
      const lastDiag = engine.holes[engine.holes.length - 1];
      expect(lastDiag.type).toBe('diag');
      expect(lastDiag.row).toBe(engine.rows - 2);
      expect(lastDiag.col).toBe(engine.cols - 2);
    });

    test('grid holes increase x left-to-right within same row', () => {
      for (let r = 0; r < engine.rows; r++) {
        const start = r * engine.cols;
        for (let c = 1; c < engine.cols; c++) {
          expect(engine.holes[start + c].x).toBeGreaterThan(engine.holes[start + c - 1].x);
        }
      }
    });

    test('grid holes increase y top-to-bottom', () => {
      for (let r = 1; r < engine.rows; r++) {
        expect(engine.holes[r * engine.cols].y).toBeGreaterThan(engine.holes[(r - 1) * engine.cols].y);
      }
    });

    test('every hole has valid x and y numbers', () => {
      for (const h of engine.holes) {
        expect(typeof h.x).toBe('number');
        expect(typeof h.y).toBe('number');
        expect(Number.isFinite(h.x)).toBe(true);
        expect(Number.isFinite(h.y)).toBe(true);
      }
    });

    test('all grid holes have type grid and valid row/col', () => {
      for (let i = 0; i < engine.rows * engine.cols; i++) {
        expect(engine.holes[i].type).toBe('grid');
        expect(engine.holes[i].row).toBe(Math.floor(i / engine.cols));
        expect(engine.holes[i].col).toBe(i % engine.cols);
      }
    });
  });

  // ── Normal: 3×4 asymmetric board ──────────────────────────────────────────
  describe('3×4 asymmetric board', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(3, 4, 40);
      engine.computeHoles();
    });

    test('grid holes = 12, diag holes = 6, total = 18', () => {
      expect(engine.holes.length).toBe(18);
      const gridCount = engine.rows * engine.cols;
      const diagCount = (engine.rows - 1) * (engine.cols - 1);
      expect(gridCount).toBe(12);
      expect(diagCount).toBe(6);
    });

    test('grid hole at (row=2, col=3) is correct', () => {
      const h = engine.holes[11]; // last grid: r=2, c=3
      expect(h.type).toBe('grid');
      expect(h.row).toBe(2);
      expect(h.col).toBe(3);
    });

    test('diag holes use correct (row, col) mapping', () => {
      // r=0,c=0 → diag at (0,0) top-left quad
      const firstDiag = engine.holes[12];
      expect(firstDiag.type).toBe('diag');
      expect(firstDiag.row).toBe(0);
      expect(firstDiag.col).toBe(0);

      // r=1,c=2 → diag at (1,2) top-left quad (last diag)
      const lastDiag = engine.holes[17];
      expect(lastDiag.type).toBe('diag');
      expect(lastDiag.row).toBe(1);
      expect(lastDiag.col).toBe(2);
    });
  });

  // ── Boundary: minimum board 1×1 ───────────────────────────────────────────
  describe('1×1 board (minimum)', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(1, 1, 40);
      engine.computeHoles();
    });

    test('only one grid hole, zero diag holes', () => {
      expect(engine.holes.length).toBe(1);
    });

    test('single hole is grid type at (mx, my)', () => {
      expect(engine.holes[0].type).toBe('grid');
      expect(engine.holes[0].row).toBe(0);
      expect(engine.holes[0].col).toBe(0);
      expect(engine.holes[0].x).toBeCloseTo(20); // hSpacing/2 = 40/2
      expect(engine.holes[0].y).toBeCloseTo(20);
    });
  });

  // ── Boundary: single row 1×N ──────────────────────────────────────────────
  describe('1×5 board (single row)', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(1, 5, 50);
      engine.computeHoles();
    });

    test('grid holes = 5, diag holes = 0, total = 5', () => {
      expect(engine.holes.length).toBe(5);
    });

    test('all holes are grid type', () => {
      for (const h of engine.holes) {
        expect(h.type).toBe('grid');
      }
    });

    test('all holes share same y coordinate', () => {
      const y = engine.holes[0].y;
      for (const h of engine.holes) {
        expect(h.y).toBeCloseTo(y);
      }
    });

    test('x increases by hSpacing each step', () => {
      for (let i = 1; i < engine.holes.length; i++) {
        const dx = engine.holes[i].x - engine.holes[i - 1].x;
        expect(dx).toBeCloseTo(engine.hSpacing);
      }
    });
  });

  // ── Boundary: single column N×1 ───────────────────────────────────────────
  describe('5×1 board (single column)', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(5, 1, 35);
      engine.computeHoles();
    });

    test('grid holes = 5, diag holes = 0, total = 5', () => {
      expect(engine.holes.length).toBe(5);
    });

    test('all holes are grid type', () => {
      for (const h of engine.holes) {
        expect(h.type).toBe('grid');
      }
    });

    test('all holes share same x coordinate', () => {
      const x = engine.holes[0].x;
      for (const h of engine.holes) {
        expect(h.x).toBeCloseTo(x);
      }
    });

    test('y increases by vSpacing each step', () => {
      for (let i = 1; i < engine.holes.length; i++) {
        const dy = engine.holes[i].y - engine.holes[i - 1].y;
        expect(dy).toBeCloseTo(engine.vSpacing);
      }
    });
  });

  // ── Boundary: 2×2 board (smallest with diag holes) ────────────────────────
  describe('2×2 board (smallest with diag holes)', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(2, 2, 40);
      engine.computeHoles();
    });

    test('grid holes = 4, diag holes = 1, total = 5', () => {
      expect(engine.holes.length).toBe(5);
    });

    test('diag hole sits at exact center of all four grid holes', () => {
      const grid0 = engine.holes[0]; // (0,0)
      const grid3 = engine.holes[3]; // (1,1)
      const diag = engine.holes[4];
      // diag should be at midpoint of the bounding box
      expect(diag.x).toBeCloseTo((grid0.x + grid3.x) / 2);
      expect(diag.y).toBeCloseTo((grid0.y + grid3.y) / 2);
    });
  });

  // ── Boundary: zero dimensions ─────────────────────────────────────────────
  describe('0×0 board (degenerate)', () => {
    test('produces empty holes array', () => {
      const engine = makeHoleEngine(0, 0, 40);
      engine.computeHoles();
      expect(engine.holes).toEqual([]);
    });
  });

  // ── Edge: non-uniform spacing hSpacing ≠ vSpacing ─────────────────────────
  describe('non-uniform hSpacing ≠ vSpacing', () => {
    let engine;

    beforeEach(() => {
      engine = makeHoleEngine(3, 3, 40);
      engine.hSpacing = 60;
      engine.vSpacing = 40;
      engine.computeHoles();
    });

    test('x step equals hSpacing, y step equals vSpacing', () => {
      // grid hole (0,0) → (0,1): x diff = hSpacing
      expect(engine.holes[1].x - engine.holes[0].x).toBeCloseTo(60);
      // grid hole (0,0) → (1,0): y diff = vSpacing
      expect(engine.holes[3].y - engine.holes[0].y).toBeCloseTo(40);
    });

    test('diag hole correctly offset by half of respective spacing', () => {
      const firstDiag = engine.holes[9]; // after 9 grid holes
      const mx = engine.hSpacing / 2; // 30
      const my = engine.vSpacing / 2; // 20
      expect(firstDiag.x).toBeCloseTo(mx + engine.hSpacing / 2);
      expect(firstDiag.y).toBeCloseTo(my + engine.vSpacing / 2);
    });
  });

  // ── Edge: recomputeHoles replaces old array ───────────────────────────────
  describe('idempotency and re-computation', () => {
    test('calling computeHoles twice produces same result', () => {
      const engine = makeEngine(3, 3);
      const first = engine.holes.map(h => ({ x: h.x, y: h.y }));
      engine.computeHoles();
      const second = engine.holes.map(h => ({ x: h.x, y: h.y }));
      expect(first).toEqual(second);
    });

    test('recomputing with different rows/cols updates holes correctly', () => {
      const engine = makeEngine(3, 3);
      engine.rows = 4;
      engine.cols = 4;
      engine.computeHoles();
      const expected = engine.rows * engine.cols + (engine.rows - 1) * (engine.cols - 1);
      expect(engine.holes.length).toBe(expected); // 16 + 9 = 25
    });
  });

  // ── Invariant: diagonal holes are strictly inside the grid bounding box ────
  describe('diagonal holes position invariants', () => {
    test.each([
      [2, 2, 40],
      [3, 4, 50],
      [5, 5, 30],
    ])('rows=%i cols=%i spacing=%i: diag holes inside grid hull', (rows, cols, sp) => {
      const engine = makeHoleEngine(rows, cols, sp);
      engine.computeHoles();

      const gridStart = 0;
      const gridEnd = rows * cols - 1;

      // Grid bounding box
      const minX = engine.holes[gridStart].x;
      const minY = engine.holes[gridStart].y;
      const maxX = engine.holes[gridEnd].x;
      const maxY = engine.holes[gridEnd].y;

      for (let i = rows * cols; i < engine.holes.length; i++) {
        const h = engine.holes[i];
        expect(h.x).toBeGreaterThan(minX);
        expect(h.x).toBeLessThan(maxX);
        expect(h.y).toBeGreaterThan(minY);
        expect(h.y).toBeLessThan(maxY);
      }
    });
  });
});
