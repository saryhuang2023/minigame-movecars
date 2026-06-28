/**
 * Unit tests for CrownPigWidget — 奖杯组件渲染和数据处理
 *
 * Tests cover:
 *   1. Constructor — 默认值、图片加载、zIndex
 *   2. setData — 正常值、边界值、布尔强制
 *   3. setHidden — 显隐控制
 *   4. render — 各种组合：隐藏/显示、获得/未获得奖杯、有/无阈值、步数计算
 *   5. 生命周期方法 — setAnimPhase、setCenter（noop）
 */

// ── Mock wx.createImage ──────────────────────────────────────────────────────
const mockImages = [];
const mockWx = {
  createImage: jest.fn(() => {
    const img = {
      src: '',
      onload: null,
      onerror: null,
      width: 0,
      height: 0,
    };
    mockImages.push(img);
    return img;
  }),
};

global.wx = mockWx;

// ── Mock render.js ───────────────────────────────────────────────────────────
jest.mock('../../render.js', () => ({
  SCREEN_WIDTH: 375,
  SCREEN_HEIGHT: 667,
}));

// ── Mock Theme ───────────────────────────────────────────────────────────────
jest.mock('../Theme.js', () => ({
  font: {
    family: 'sans-serif',
    size: { xs: 10, sm: 12, md: 14, lg: 18, xl: 20, xxl: 24 },
    weight: { normal: 'normal', bold: 'bold' },
  },
}));

// ── Mock UIComponent ─────────────────────────────────────────────────────────
const mockUIConstructor = jest.fn();
let uiIdCounter = 0;
jest.mock('../base/UIComponent.js', () => {
  function MockUIComponent(opts) {
    mockUIConstructor(opts);
    this.id = 'ui_' + (++uiIdCounter);
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.w = opts.w || 0;
    this.h = opts.h || 0;
    this.zIndex = opts.zIndex || 0;
    this.visible = opts.visible !== false;
    this.children = [];
    this.parent = null;
    this._mounted = false;
    this._animState = {};
    this.onClick = null;
    this.onPressStart = null;
    this.onPressEnd = null;
    this.onLongPress = null;
  }
  MockUIComponent.prototype.setBounds = function (x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
  };
  MockUIComponent.prototype.render = function () {};
  MockUIComponent.prototype.renderTree = function (ctx) {
    if (!this.visible) return;
    this.render(ctx);
    this.children.forEach(function (c) { c.renderTree(ctx); });
  };
  MockUIComponent.prototype.hitTest = function (px, py) {
    return this.visible && px >= this.x && px <= this.x + this.w &&
           py >= this.y && py <= this.y + this.h;
  };
  MockUIComponent.prototype.mount = function () { this._mounted = true; };
  return MockUIComponent;
});

const CrownPigWidget = require('./CrownPigWidget.js');

// ── Helper: create mock canvas context ───────────────────────────────────────
function makeCtx() {
  return {
    drawImage: jest.fn(),
    fillText: jest.fn(),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    save: jest.fn(),
    restore: jest.fn(),
  };
}

// ── Helper: trigger all image onload callbacks ───────────────────────────────
function triggerAllOnload() {
  mockImages.forEach(function (img) {
    if (img.onload) img.onload();
  });
}

beforeEach(() => {
  mockImages.length = 0;
  mockWx.createImage.mockClear();
  mockUIConstructor.mockClear();
  uiIdCounter = 0;
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Constructor
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget constructor', () => {

  test('creates instance extending UIComponent', () => {
    const widget = new CrownPigWidget({ zIndex: 3 });
    expect(widget instanceof CrownPigWidget).toBe(true);
    expect(mockUIConstructor).toHaveBeenCalledTimes(1);
  });

  test('passes zIndex to UIComponent', () => {
    const widget = new CrownPigWidget({ zIndex: 5 });
    expect(widget.zIndex).toBe(5);
  });

  test('default zIndex is 1 when not provided', () => {
    const widget = new CrownPigWidget({});
    expect(widget.zIndex).toBe(1);
  });

  test('default zIndex is 1 when opts is empty object', () => {
    const widget = new CrownPigWidget();
    expect(widget.zIndex).toBe(1);
  });

  test('passes TROPHY_SIZE as w and h to UIComponent', () => {
    new CrownPigWidget({});
    const callArgs = mockUIConstructor.mock.calls[0][0];
    expect(callArgs.w).toBe(36);  // TROPHY_SIZE
    expect(callArgs.h).toBe(36);
    expect(callArgs.x).toBe(0);
    expect(callArgs.y).toBe(0);
  });

  test('initializes data fields to default values', () => {
    const widget = new CrownPigWidget({});
    expect(widget._crownSteps).toBe(0);
    expect(widget._steps).toBe(0);
    expect(widget._gotCrown).toBe(false);
    expect(widget._hidden).toBe(false);
  });

  test('creates three wx images', () => {
    new CrownPigWidget({});
    expect(mockWx.createImage).toHaveBeenCalledTimes(3);
  });

  test('sets active image src to leftStep_1', () => {
    new CrownPigWidget({});
    const activeCall = mockWx.createImage.mock.results[0].value;
    expect(activeCall.src).toBe('assets/images/levels/leftStep_1');
  });

  test('sets inactive image src to leftStep_2', () => {
    new CrownPigWidget({});
    const inactiveCall = mockWx.createImage.mock.results[1].value;
    expect(inactiveCall.src).toBe('assets/images/levels/leftStep_2');
  });

  test('sets step bg image src to leftStep_num', () => {
    new CrownPigWidget({});
    const bgCall = mockWx.createImage.mock.results[2].value;
    expect(bgCall.src).toBe('assets/images/levels/leftStep_num');
  });

  test('initializes all loaded flags to false', () => {
    const widget = new CrownPigWidget({});
    expect(widget._activeLoaded).toBe(false);
    expect(widget._inactiveLoaded).toBe(false);
    expect(widget._bgLoaded).toBe(false);
  });

  test('onload callback sets _activeLoaded to true', () => {
    const widget = new CrownPigWidget({});
    expect(widget._activeLoaded).toBe(false);
    mockImages[0].onload();
    expect(widget._activeLoaded).toBe(true);
  });

  test('onload callback sets _inactiveLoaded to true', () => {
    const widget = new CrownPigWidget({});
    expect(widget._inactiveLoaded).toBe(false);
    mockImages[1].onload();
    expect(widget._inactiveLoaded).toBe(true);
  });

  test('onload callback sets _bgLoaded to true', () => {
    const widget = new CrownPigWidget({});
    expect(widget._bgLoaded).toBe(false);
    mockImages[2].onload();
    expect(widget._bgLoaded).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. setData
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.setData', () => {

  test('sets crownSteps, steps, and gotCrown', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    expect(widget._crownSteps).toBe(10);
    expect(widget._steps).toBe(5);
    expect(widget._gotCrown).toBe(true);
  });

  test('gotCrown defaults to false for falsy values', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, undefined);
    expect(widget._gotCrown).toBe(false);
  });

  test('gotCrown defaults to false for null', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, null);
    expect(widget._gotCrown).toBe(false);
  });

  test('gotCrown coercion: non-zero number is truthy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, 1);
    expect(widget._gotCrown).toBe(true);
  });

  test('gotCrown coercion: zero is falsy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, 0);
    expect(widget._gotCrown).toBe(false);
  });

  test('gotCrown coercion: empty string is falsy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, '');
    expect(widget._gotCrown).toBe(false);
  });

  test('gotCrown coercion: non-empty string is truthy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, 'yes');
    expect(widget._gotCrown).toBe(true);
  });

  test('crownSteps defaults to 0 when falsy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(undefined, 5, false);
    expect(widget._crownSteps).toBe(0);
  });

  test('crownSteps defaults to 0 when 0', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);
    expect(widget._crownSteps).toBe(0);
  });

  test('steps defaults to 0 when falsy', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, undefined, false);
    expect(widget._steps).toBe(0);
  });

  test('steps defaults to 0 when 0', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 0, false);
    expect(widget._steps).toBe(0);
  });

  test('handles large numbers', () => {
    const widget = new CrownPigWidget({});
    widget.setData(999999, 500000, true);
    expect(widget._crownSteps).toBe(999999);
    expect(widget._steps).toBe(500000);
    expect(widget._gotCrown).toBe(true);
  });

  test('handles negative crownSteps gracefully (stored as-is)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(-5, 3, false);
    expect(widget._crownSteps).toBe(-5);
  });

  test('handles negative steps gracefully (stored as-is)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, -3, false);
    expect(widget._steps).toBe(-3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. setHidden
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.setHidden', () => {

  test('sets hidden to true', () => {
    const widget = new CrownPigWidget({});
    widget.setHidden(true);
    expect(widget._hidden).toBe(true);
  });

  test('sets hidden to false', () => {
    const widget = new CrownPigWidget({});
    widget._hidden = true;
    widget.setHidden(false);
    expect(widget._hidden).toBe(false);
  });

  test('coerces truthy value to true', () => {
    const widget = new CrownPigWidget({});
    widget.setHidden(1);
    expect(widget._hidden).toBe(true);
  });

  test('coerces falsy string to false', () => {
    const widget = new CrownPigWidget({});
    widget._hidden = true;
    widget.setHidden('');
    expect(widget._hidden).toBe(false);
  });

  test('coerces null to false', () => {
    const widget = new CrownPigWidget({});
    widget._hidden = true;
    widget.setHidden(null);
    expect(widget._hidden).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. render — hidden state
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.render — hidden', () => {

  test('returns early when hidden', () => {
    const widget = new CrownPigWidget({});
    widget.setHidden(true);
    const ctx = makeCtx();
    widget.render(ctx);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('renders when not hidden', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);
    // Should draw at least inactive image
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  test('renders when hidden is false explicitly', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    widget.setHidden(false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);
    expect(ctx.drawImage).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. render — got crown (active state)
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.render — got crown', () => {

  test('draws active image when gotCrown is true and loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // Active image drawn at fixed position
    const activeImg = mockImages[0];
    expect(ctx.drawImage).toHaveBeenCalledWith(
      activeImg, 319, 84, 36, 36  // SCREEN_WIDTH(375) - 36(TROPHY_SIZE) - 20(TROPHY_RIGHT) = 319
    );
  });

  test('does not draw inactive image when gotCrown is true', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // Only active image should be drawn
    const activeCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[0]; }
    );
    const inactiveCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[1]; }
    );
    expect(activeCalls.length).toBe(1);
    expect(inactiveCalls.length).toBe(0);
  });

  test('does not draw step bg when gotCrown is true', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const bgCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[2]; }
    );
    expect(bgCalls.length).toBe(0);
  });

  test('does not render step text when gotCrown is true', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('does not draw anything if gotCrown but image not loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, true);
    // Don't trigger onload
    const ctx = makeCtx();
    widget.render(ctx);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. render — no crown, no threshold
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.render — no crown, no threshold', () => {

  test('draws inactive image when gotCrown is false and loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);  // crownSteps = 0 → no threshold
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const inactiveImg = mockImages[1];
    expect(ctx.drawImage).toHaveBeenCalledWith(
      inactiveImg, 319, 84, 36, 36  // same fixed position
    );
  });

  test('does not draw active image', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const activeCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[0]; }
    );
    expect(activeCalls.length).toBe(0);
  });

  test('does not draw step bg when crownSteps is 0', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const bgCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[2]; }
    );
    expect(bgCalls.length).toBe(0);
  });

  test('does not render step text when crownSteps is 0', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test('does not draw if inactive image not loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 5, false);
    // Don't trigger onload
    const ctx = makeCtx();
    widget.render(ctx);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. render — no crown, with threshold (step count display)
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.render — no crown, with threshold', () => {

  test('draws inactive image', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const inactiveImg = mockImages[1];
    expect(ctx.drawImage).toHaveBeenCalledWith(inactiveImg, 319, 84, 36, 36);
  });

  test('draws step bg image at correct position', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    const bgImg = mockImages[2];
    // bgX = 375 - 54 - 11 = 310, bgY = 120
    expect(ctx.drawImage).toHaveBeenCalledWith(bgImg, 310, 120, 54, 24);
  });

  test('renders remaining steps text', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.font).toBe('12px ' + Theme.font.family + '');
    expect(ctx.fillStyle).toBe('#733C29');
    expect(ctx.textAlign).toBe('center');
    expect(ctx.textBaseline).toBe('middle');
    expect(ctx.fillText).toHaveBeenCalledWith('剩5步', 337, 132);
  });

  test('remaining = crownSteps - steps: 10 - 5 = 5', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.fillText).toHaveBeenCalledWith('剩5步', expect.any(Number), expect.any(Number));
  });

  test('remaining = crownSteps - steps: 10 - 0 = 10', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 0, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.fillText).toHaveBeenCalledWith('剩10步', expect.any(Number), expect.any(Number));
  });

  test('remaining capped at 0 when steps exceed crownSteps', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 15, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    expect(ctx.fillText).toHaveBeenCalledWith('剩0步', expect.any(Number), expect.any(Number));
  });

  test('remaining is 0 when steps exactly equal crownSteps', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 10, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // remaining = 10 - 10 = 0
    expect(ctx.fillText).toHaveBeenCalledWith('剩0步', expect.any(Number), expect.any(Number));
  });

  test('does not draw step bg when bg image not loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    // Only load active and inactive, not bg
    mockImages[0].onload();
    mockImages[1].onload();
    const ctx = makeCtx();
    widget.render(ctx);

    // Inactive image should still be drawn
    const inactiveCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[1]; }
    );
    expect(inactiveCalls.length).toBe(1);

    // But bg should not
    const bgCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[2]; }
    );
    expect(bgCalls.length).toBe(0);
  });

  test('text is still rendered even if bg image not loaded', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    mockImages[0].onload();  // Only active loaded
    // inactive and bg NOT loaded
    const ctx = makeCtx();
    widget.render(ctx);

    // Text should still appear (text rendering is NOT gated by _bgLoaded)
    expect(ctx.fillText).toHaveBeenCalledWith('剩5步', expect.any(Number), expect.any(Number));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. render — position calculations
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget.render — position calculations', () => {

  test('trophy position depends on SCREEN_WIDTH (375)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 0, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // trophyX = 375 - 36 - 20 = 319, trophyY = 84
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(), 319, 84, 36, 36
    );
  });

  test('step bg position depends on SCREEN_WIDTH (375)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // bgX = 375 - 54 - 11 = 310, bgY = 120
    const bgImg = mockImages[2];
    expect(ctx.drawImage).toHaveBeenCalledWith(bgImg, 310, 120, 54, 24);
  });

  test('text centered on step bg', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // Center X = 310 + 27 = 337, Center Y = 120 + 12 = 132
    expect(ctx.fillText).toHaveBeenCalledWith('剩5步', 337, 132);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Lifecycle methods — setAnimPhase / setCenter (no-ops)
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget lifecycle no-ops', () => {

  test('setAnimPhase is a no-op and does not throw', () => {
    const widget = new CrownPigWidget({});
    expect(function () { widget.setAnimPhase(); }).not.toThrow();
    expect(function () { widget.setAnimPhase('some_phase'); }).not.toThrow();
  });

  test('setCenter is a no-op and does not throw', () => {
    const widget = new CrownPigWidget({});
    expect(function () { widget.setCenter(); }).not.toThrow();
    expect(function () { widget.setCenter(100, 200); }).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Integration — multiple setData → render sequences
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget integration', () => {

  test('state transitions: no crown → got crown', () => {
    const widget = new CrownPigWidget({});
    triggerAllOnload();

    // Phase 1: no crown, with threshold
    const ctx1 = makeCtx();
    widget.setData(10, 5, false);
    widget.render(ctx1);
    expect(ctx1.fillText).toHaveBeenCalledWith('剩5步', expect.any(Number), expect.any(Number));

    // Phase 2: got crown
    const ctx2 = makeCtx();
    widget.setData(10, 5, true);
    widget.render(ctx2);
    expect(ctx2.fillText).not.toHaveBeenCalled();
  });

  test('state transitions: hidden → visible → hidden', () => {
    const widget = new CrownPigWidget({});
    triggerAllOnload();
    widget.setData(10, 5, false);

    // Hidden
    const ctx1 = makeCtx();
    widget.setHidden(true);
    widget.render(ctx1);
    expect(ctx1.drawImage).not.toHaveBeenCalled();

    // Visible
    const ctx2 = makeCtx();
    widget.setHidden(false);
    widget.render(ctx2);
    expect(ctx2.drawImage).toHaveBeenCalled();

    // Hidden again
    const ctx3 = makeCtx();
    widget.setHidden(true);
    widget.render(ctx3);
    expect(ctx3.drawImage).not.toHaveBeenCalled();
  });

  test('multiple setData calls within same widget', () => {
    const widget = new CrownPigWidget({});
    triggerAllOnload();

    widget.setData(10, 2, false);
    expect(widget._crownSteps).toBe(10);
    expect(widget._steps).toBe(2);

    widget.setData(5, 8, true);
    expect(widget._crownSteps).toBe(5);
    expect(widget._steps).toBe(8);
    expect(widget._gotCrown).toBe(true);

    widget.setData(0, 5, false);
    expect(widget._crownSteps).toBe(0);
    expect(widget._steps).toBe(5);
    expect(widget._gotCrown).toBe(false);
  });

  test('render after setData with 0 crownSteps and 0 gotCrown shows only inactive', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 0, false);
    triggerAllOnload();
    const ctx = makeCtx();
    widget.render(ctx);

    // Only inactive image, no bg, no text
    const allSrcs = ctx.drawImage.mock.calls.map(function (c) { return c[0]; });
    expect(allSrcs).toContain(mockImages[1]);  // inactive
    expect(allSrcs).not.toContain(mockImages[2]);  // no bg
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Edge cases
// ═════════════════════════════════════════════════════════════════════════════
describe('CrownPigWidget edge cases', () => {

  test('create with no opts argument at all', () => {
    const widget = new CrownPigWidget();
    expect(widget).toBeDefined();
    expect(widget._hidden).toBe(false);
    expect(widget._gotCrown).toBe(false);
  });

  test('setData with all parameters undefined', () => {
    const widget = new CrownPigWidget({});
    widget.setData(undefined, undefined, undefined);
    expect(widget._crownSteps).toBe(0);
    expect(widget._steps).toBe(0);
    expect(widget._gotCrown).toBe(false);
  });

  test('render with partial image loading (only active)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(0, 0, true);
    mockImages[0].onload();  // Only active loaded

    const ctx = makeCtx();
    widget.render(ctx);

    // Active is drawn
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImages[0], 319, 84, 36, 36);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  test('render with partial image loading (only bg)', () => {
    const widget = new CrownPigWidget({});
    widget.setData(10, 5, false);
    mockImages[2].onload();  // Only bg loaded

    const ctx = makeCtx();
    widget.render(ctx);

    // Inactive not drawn (not loaded), bg drawn
    const inactiveCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[1]; }
    );
    const bgCalls = ctx.drawImage.mock.calls.filter(
      function (c) { return c[0] === mockImages[2]; }
    );
    expect(inactiveCalls.length).toBe(0);
    expect(bgCalls.length).toBe(1);
    // Text still rendered
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
