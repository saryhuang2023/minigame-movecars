// 推猪消除 — 设置面板（v3 · Scale-based spring 弹入/回弹缩回）
// 渲染悬停面板，支持音乐/音效独立开关 + 可选底部功能按钮
// 动画系统：PopupAnimator 驱动 scale spring pop-in / pop-out

var audio = require('../audio/AudioManager.js');
var databus = require('../databus.js');
var Easing = require('../core/Easing.js');
var PopupAnimator = require('./PopupAnimator.js');
var AssetPreloader = require('./AssetPreloader.js');
var Theme = require('./Theme.js');

// ===== 继续按钮手绘（3层 Figma 设计还原）=====
function _drawContinueBtnBg(ctx, x, y, w, h) {
  ctx.save();

  // === 第1层：深青色外框 127×48, #1D6C72, radius 14 ===
  _roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#1D6C72';
  ctx.fill();

  // === 第2层：青色渐变内框 123×44, #00C3D8, radius 12，偏移约 (2, 2) ===
  var ix = x + 2;
  var iy = y + 2;
  var iw = w - 4;
  var ih = h - 4;

  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.fillStyle = '#00C3D8';
  ctx.fill();

  // 内高光/阴影（clip 到内框）
  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.save();
  ctx.clip();

  // inset top: 0px 3px 3px rgba(255,255,255,0.3)
  var tGrad = ctx.createLinearGradient(ix, iy, ix, iy + 4);
  tGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  tGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = tGrad;
  ctx.fillRect(ix, iy, iw, 5);

  // inset bottom: 0px -4px 0px #0A88B6
  ctx.fillStyle = '#0A88B6';
  ctx.fillRect(ix, iy + ih - 4, iw, 4);

  ctx.restore();  // clip

  // === 第3层：亮青色描边 123×41, 1.5px #33D4D7, radius 12 ===
  var sx = x + 2;
  var sy = y + 2;
  var sw = w - 4;
  var sh = h - 7;  // 41 height

  _roundRect(ctx, sx, sy, sw, sh, 12);
  ctx.strokeStyle = '#33D4D7';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();  // outer save
}

// ===== 背景图 key（需在 GameEngine 启动时预加载）=====
// popup_bg.png: Figma @1x = 289×225，@3x 导出 = 867×675
// 三宫格（@1x）：top≈135 / bottom≈36；对应 @3x：405 / 108
var BG_KEY = 'settings_bg';
var _bgSrcTop = 405;      // 图片源区域顶部高度（135×3）
var _bgSrcMid = 162;      // 图片源区域中部高度（54×3）
var _bgSrcBottom = 108;   // 图片源区域底部高度（36×3）
var _bgDstTop = 135;      // 面板目标区域顶部高度（@1x）
var _bgDstBottom = 36;    // 面板目标区域底部高度（@1x）

/**
 * 三宫格绘制背景图：上下固定高度不拉伸，中间垂直拉伸，水平整体拉伸
 * 图片为 3x 导出，drawImage 的 sx/sy/sw/sh 用 3x 值切图，dx/dy/dw/dh 用 1x 值画到面板
 */
function _drawThreeSlice(ctx, img, x, y, w, h) {
  var sw = img.width;
  var sh = img.height;
  if (!sw || !sh) return;

  var midDstH = h - _bgDstTop - _bgDstBottom;
  if (midDstH < 1) midDstH = 1;

  // 顶部（源 405px → 目标 135px，宽度整体拉伸）
  ctx.drawImage(img, 0, 0, sw, _bgSrcTop,              x, y, w, _bgDstTop);
  // 中部（源 162px → 目标 midDstH 拉伸）
  ctx.drawImage(img, 0, _bgSrcTop, sw, _bgSrcMid,      x, y + _bgDstTop, w, midDstH);
  // 底部（源 108px → 目标 36px，宽度整体拉伸）
  ctx.drawImage(img, 0, sh - _bgSrcBottom, sw, _bgSrcBottom, x, y + h - _bgDstBottom, w, _bgDstBottom);
}

// ===== PopupAnimator 实例（替代旧动画状态机）=====
var _animator = PopupAnimator.createPopupAnimator();
var _openStartTime = 0;  // 记录打开开始时间，供 stagger 计算

// 面板布局数据（仅在面板可见时有效）
var _panel = null;           // { x, y, w, h }
var _buttons = null;
var _title = null;

// 开关滑块动画
var _toggleMusicTarget = null;  // 目标值（true/false），动画中平滑过渡
var _toggleSfxTarget = null;
var _toggleMusicDisplay = null; // 当前渲染值（0..1），动画完成后 = target
var _toggleSfxDisplay = null;

// 按钮点击压感动画
var _btnPress = {};  // { btnKey: { startTime, phase: 'pressing'|'releasing' } }
// 按钮呼吸动画
var _btnBreathe = {}; // { btnKey: startTime }

// 热区
var _musicRect = null;
var _sfxRect = null;
var _closeRect = null;
var _btnRects = null;

// ===== 布局常量 =====
// 两种面板尺寸（宽统一 289）：
//   主菜单弹窗 289×249 · 游戏内暂停 289×249
var PANEL_WIDTH = 289;
var SIZE_PRESETS = {
  dialog: 249,   // 主菜单设置弹窗（无底部按钮，纯音频行）
  ingame: 333,   // 游戏内暂停面板（音频行 + 底部图标按钮）
};

// ===== 动画参数 =====
var STAGGER_INTERVAL = 40;   // 底部按钮错开间隔 (ms)
var BUTTON_PRESS_DURATION = 100;  // 按钮按压回弹时长
var BUTTON_RELEASE_DURATION = 140;

// 呼吸动画（点击后振荡）
var BREATHE_DURATION = 1500;
var BREATHE_CYCLES = 3;
var BREATHE_AMPLITUDE = 0.06;

// ===== 公开 API =====

function open(opts) {
  opts = opts || {};
  _buttons = opts.buttons || null;
  _title = opts.title || '';

  // 根据 size 参数或是否有按钮自动选面板高度
  var sizeKey = opts.size || (_buttons && _buttons.length > 0 ? 'ingame' : 'dialog');
  var ph = opts.height || SIZE_PRESETS[sizeKey] || SIZE_PRESETS.dialog;
  var pw = PANEL_WIDTH;

  var cx = databus.screenWidth / 2;
  _panel = {
    x: cx - pw / 2,
    y: (databus.screenHeight - ph) / 2 - 20,
    w: pw,
    h: ph,
  };

  // 初始化滑块显示位置（从当前实际状态开始）
  _toggleMusicTarget = audio.isMusicEnabled();
  _toggleSfxTarget = audio.isSfxEnabled();
  _toggleMusicDisplay = _toggleMusicTarget ? 1 : 0;
  _toggleSfxDisplay = _toggleSfxTarget ? 1 : 0;

  // 复位按钮压感
  _btnPress = {};
  _btnBreathe = {};

  // 记录打开时间
  _openStartTime = Date.now();

  // 触发动画
  _animator.open();
}

/**
 * 关闭面板（带弹出动画）。close 按钮/遮罩点击/底部按钮关闭都用这个。
 */
function close() {
  if (_animator.isClosed()) return;
  _btnPress = {};
  _btnBreathe = {};

  _animator.close(function() {
    // 动画结束后清理布局数据
    _panel = null;
    _buttons = null;
    _title = null;
    _musicRect = null;
    _sfxRect = null;
    _closeRect = null;
    _btnRects = null;
  });
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

function toggle() {
  if (isOpen()) close(); else open();
}

// ===== 渲染 =====

function render(ctx) {
  if (_animator.isClosed() || !_panel) return;

  // 驱动动画状态机
  var state = _animator.update();

  // 动画结束后的二次守卫
  if (_animator.isClosed() || !_panel) return;

  var p = _panel;
  var cx = p.x + p.w / 2;
  var scale = state.scale;
  var alpha = state.alpha;
  var maskAlpha = state.maskAlpha;
  var phase = _animator.getPhase();
  var isEntering = (phase === 'opening');

  // 1. 半透明遮罩
  if (maskAlpha > 0.005) {
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, databus.screenWidth, databus.screenHeight);
  }

  if (alpha < 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // 缩放变换（围绕面板中心）
  var pCenterX = p.x + p.w / 2;
  var pCenterY = p.y + p.h / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-pCenterX, -pCenterY);

  // 3. 面板背景图（三宫格）
  var bgImg = AssetPreloader.get(BG_KEY);
  if (bgImg && AssetPreloader.isReady(BG_KEY)) {
    _drawThreeSlice(ctx, bgImg, p.x, p.y, p.w, p.h);
  }

  // 4. 标题文字
  if (_title) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(_title, pCenterX, p.y + 65);
  }

  // 5. 关闭按钮
  _renderCloseBtn(ctx);

  // 6. 音乐行（图标相对背景：top 133, left 66）
  _musicRect = _renderAudioRow(ctx, p, {
    text: '音乐', iconKey: 'icon_music', yOff: 133, gap: 0, displayVal: _toggleMusicDisplay,
  });

  // 7. 音效行（图标相对背景：top 181, left 66）
  _sfxRect = _renderAudioRow(ctx, p, {
    text: '音效', iconKey: 'icon_sound', yOff: 181, gap: 48, displayVal: _toggleSfxDisplay,
  });

  // 8. 底部图标按钮（仅在入场完成或已打开时渲染，错开淡入）
  if (_buttons && _buttons.length > 0) {
    _renderBottomIcons(ctx, isEntering);
  }

  ctx.restore();

  // 更新滑块显示位置（平滑 lerp 到目标值）
  _updateToggleSliders();
}

// ===== 关闭按钮（win_cancel 图片，30×30）=====

function _renderCloseBtn(ctx) {
  var p = _panel;
  var closeW = 30;
  var closeH = 30;
  var closeX = p.x + p.w - closeW;   // right: 0
  var closeY = p.y + 63;              // top: 63

  _closeRect = { x: closeX - 4, y: closeY - 4, w: closeW + 8, h: closeH + 8 };

  // 按钮压感
  var ccx = closeX + closeW / 2;
  var ccy = closeY + closeH / 2;
  var pressScale = _getBtnPressScale('close', ccx, ccy);

  ctx.save();
  ctx.translate(ccx, ccy);
  ctx.scale(pressScale, pressScale);
  ctx.translate(-ccx, -ccy);

  var img = AssetPreloader.get('win_cancel');
  if (img && AssetPreloader.isReady('win_cancel')) {
    ctx.drawImage(img, closeX, closeY, closeW, closeH);
  }

  ctx.restore();
}

// ===== 音频行渲染（音乐/音效共用）=====

var MUSIC_ICON_KEY = 'icon_music';
var SOUND_ICON_KEY = 'icon_sound';

/**
 * @param {Object} opts — { text, iconKey, yOff, gap, displayVal }
 *   yOff: 绝对 Y 坐标（p.y + yOff）
 * @returns {Object} 热区 { x, y, w, h }
 */
function _renderAudioRow(ctx, p, opts) {
  var display = opts.displayVal;
  var yAbs   = p.y + opts.yOff;
  var iconLeft = p.x + 66;
  var iconTop  = yAbs;
  var textLeft = p.x + 103;
  var textTop  = yAbs;
  var sliderX  = p.x + 169;
  var sliderY  = yAbs - 1;
  var sliderW  = 64;
  var sliderH  = 28;
  var sliderR  = 14;  // 高度一半 → 完全圆角 pill

  // 图标
  var iconImg = AssetPreloader.get(opts.iconKey);
  if (iconImg && AssetPreloader.isReady(opts.iconKey)) {
    ctx.drawImage(iconImg, iconLeft, iconTop, 25, 25);
  }

  // 文字
  ctx.fillStyle = '#E3632D';
  ctx.font = '20px ' + Theme.font.family + '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(opts.text, textLeft, textTop);

  // 滑块底板填充（选中 #CC6F27 ↔ 未选中 #8F4F00 平滑过渡）
  var fillR = Math.round(143 + (204 - 143) * display);
  var fillG = Math.round(79  + (111 - 79)  * display);
  var fillB = Math.round(0   + (39  - 0)   * display);
  ctx.fillStyle = 'rgb(' + fillR + ',' + fillG + ',' + fillB + ')';
  _roundRect(ctx, sliderX, sliderY, sliderW, sliderH, sliderR);
  ctx.fill();

  // 内阴影（选中：顶部 #C25E11 / 未选中：底部 rgba(0,0,0,0.25)）
  // 两套渐变独立叠加，各自用 alpha 控制显隐
  ctx.save();
  _roundRect(ctx, sliderX, sliderY, sliderW, sliderH, sliderR);
  ctx.clip();

  // ON 态顶部阴影（y=-2 → 渐变从顶部往下）
  var onAlpha = display;
  if (onAlpha > 0.005) {
    var gradOn = ctx.createLinearGradient(0, sliderY, 0, sliderY + 8);
    gradOn.addColorStop(0, 'rgba(194, 94, 17, ' + (0.55 * onAlpha).toFixed(3) + ')');
    gradOn.addColorStop(1, 'rgba(194, 94, 17, 0)');
    ctx.fillStyle = gradOn;
    ctx.fillRect(sliderX, sliderY, sliderW, 8);
  }

  // OFF 态底部阴影（y=2 → 渐变从底部往上）
  var offAlpha = 1 - display;
  if (offAlpha > 0.005) {
    var gradOff = ctx.createLinearGradient(0, sliderY + sliderH - 8, 0, sliderY + sliderH);
    gradOff.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradOff.addColorStop(1, 'rgba(0, 0, 0, ' + (0.25 * offAlpha).toFixed(3) + ')');
    ctx.fillStyle = gradOff;
    ctx.fillRect(sliderX, sliderY + sliderH - 8, sliderW, 8);
  }

  ctx.restore();

  // Stroke
  ctx.strokeStyle = '#FF8E36';
  ctx.lineWidth = 1.5;
  _roundRect(ctx, sliderX, sliderY, sliderW, sliderH, sliderR);
  ctx.stroke();

  // 滑块小球 25×25：fill #FFE531, stroke #000 1px, glow rgba(255,255,255,0.25) blur 4
  var thumbR = 12.5;
  var thumbTravel = sliderW - thumbR * 2 - 2; // 左右各留 1px
  var thumbX = sliderX + thumbR + 1 + thumbTravel * display;
  var thumbY = sliderY + sliderH / 2;

  // 白色发光
  ctx.save();
  ctx.shadowColor = 'rgba(255, 255, 255, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#FFE531';
  ctx.beginPath();
  ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 黑色描边（不带发光）
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(thumbX, thumbY, thumbR, 0, Math.PI * 2);
  ctx.stroke();

  // 返回热区
  return {
    x: p.x + 45,
    y: opts.yOff + p.y - 4,
    w: p.w - 90,
    h: 36,
  };
}

// ===== 滑块动画 =====

function _updateToggleSliders() {
  // 平滑 lerp display → target
  if (_toggleMusicTarget !== null && Math.abs(_toggleMusicDisplay - (_toggleMusicTarget ? 1 : 0)) > 0.005) {
    _toggleMusicDisplay = Easing.lerp(_toggleMusicDisplay, _toggleMusicTarget ? 1 : 0, 0.2);
    if (Math.abs(_toggleMusicDisplay - (_toggleMusicTarget ? 1 : 0)) < 0.005) {
      _toggleMusicDisplay = _toggleMusicTarget ? 1 : 0;
    }
  }

  if (_toggleSfxTarget !== null && Math.abs(_toggleSfxDisplay - (_toggleSfxTarget ? 1 : 0)) > 0.005) {
    _toggleSfxDisplay = Easing.lerp(_toggleSfxDisplay, _toggleSfxTarget ? 1 : 0, 0.2);
    if (Math.abs(_toggleSfxDisplay - (_toggleSfxTarget ? 1 : 0)) < 0.005) {
      _toggleSfxDisplay = _toggleSfxTarget ? 1 : 0;
    }
  }
}

// ===== 底部图标按钮 =====

var BOTTOM_ICON_CONFIG = {
  btn_home:     { fromLeft: 26,  fromBottomFn: function(ph) { return Math.max(26, Math.floor(ph * 0.112)); }, w: 36, h: 36 },
  btn_continue: { fromLeft: null, fromBottom: 36, w: 127, h: 48, label: '继续游戏', handDrawn: true,
    labelStyle: { size: 22, weight: '400', color: '#FFFFFF', spacing: 1, shadowColor: 'rgba(3,48,75,0.6)', shadowBlur: 2 } },
  btn_again:    { fromRight: 26, fromBottomFn: function(ph) { return Math.max(26, Math.floor(ph * 0.112)); }, w: 36, h: 36 },
};
var BOTTOM_ICON_SIZE_DEFAULT = 36;

function _renderBottomIcons(ctx, isEntering) {
  var p = _panel;
  _btnRects = [];

  var elapsed = Date.now() - _openStartTime;
  var openDur = _animator.getOpenDur();

  for (var i = 0; i < _buttons.length; i++) {
    var b = _buttons[i];
    var iconKey = b.iconKey;
    var cfg = BOTTOM_ICON_CONFIG[iconKey];
    if (!cfg) continue;

    var iw = cfg.w || BOTTOM_ICON_SIZE_DEFAULT;
    var ih = cfg.h || BOTTOM_ICON_SIZE_DEFAULT;

    // 计算坐标
    var bx, by;
    var fromBottom = cfg.fromBottom !== undefined ? cfg.fromBottom
      : (cfg.fromBottomFn ? cfg.fromBottomFn(p.h) : 40);
    by = p.y + p.h - fromBottom - ih;
    if (cfg.fromRight != null) {
      bx = p.x + p.w - cfg.fromRight - iw;
    } else if (cfg.fromLeft != null) {
      bx = p.x + cfg.fromLeft;
    } else {
      // 水平居中
      bx = p.x + Math.floor((p.w - iw) / 2);
    }

    // Stagger 入场动画
    var staggerDelay = i * STAGGER_INTERVAL;
    var btnAnimT = 1;
    if (isEntering) {
      var btnElapsed = Math.max(0, elapsed - staggerDelay);
      var btnRawT = Math.min(btnElapsed / Math.max(openDur - staggerDelay, 1), 1);
      btnAnimT = Easing.spring(btnRawT * 3.2, 180, 14);
    }
    if (btnAnimT < 0.005) continue;

    var btnAlpha = btnAnimT;
    var btnScale = 0.5 + 0.5 * btnAnimT;

    var cX = bx + iw / 2;
    var cY = by + ih / 2;
    var pressScale = _getBtnPressScale('btn_' + i, cX, cY);
    var finalScale = btnScale * pressScale;

    ctx.save();
    ctx.globalAlpha = btnAlpha;
    ctx.translate(cX, cY);
    ctx.scale(finalScale, finalScale);
    ctx.translate(-cX, -cY);

    var img = AssetPreloader.get(iconKey);
    if (cfg.handDrawn) {
      _drawContinueBtnBg(ctx, bx, by, iw, ih);
    } else if (img && AssetPreloader.isReady(iconKey)) {
      ctx.drawImage(img, bx, by, iw, ih);
    }

    // 按钮文字（如"继续游戏"）
    if (cfg.label) {
      var ls = cfg.labelStyle || {};
      ctx.fillStyle = ls.color || '#FFFFFF';
      ctx.font = (ls.weight || '400') + ' ' + (ls.size || 16) + 'px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 文字阴影
      if (ls.shadowColor) {
        ctx.shadowColor = ls.shadowColor;
        ctx.shadowBlur = ls.shadowBlur || 2;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      var labelX = bx + iw / 2;
      var labelY = by + ih / 2;

      // 支持 letter-spacing（逐字绘制）
      var spacing = ls.spacing || 0;
      if (spacing > 0) {
        var totalW = 0;
        for (var ci = 0; ci < cfg.label.length; ci++) {
          totalW += ctx.measureText(cfg.label[ci]).width + spacing;
        }
        totalW -= spacing; // 最后一个字不加间距
        var curX = labelX - totalW / 2;
        for (var ci = 0; ci < cfg.label.length; ci++) {
          var charW = ctx.measureText(cfg.label[ci]).width;
          ctx.fillText(cfg.label[ci], curX + charW / 2, labelY);
          curX += charW + spacing;
        }
      } else {
        ctx.fillText(cfg.label, labelX, labelY);
      }

      // 重置阴影
      if (ls.shadowColor) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
    }

    ctx.restore();

    _btnRects.push({
      x: bx, y: by,
      w: iw, h: ih,
      action: b.action,
    });
  }
}

// ===== 按钮压感 =====

function _getBtnPressScale(key, cx, cy) {
  var press = _btnPress[key];
  if (press) {
    var elapsed = Date.now() - press.startTime;
    if (press.phase === 'pressing') {
      var t = Math.min(elapsed / BUTTON_PRESS_DURATION, 1);
      return 1 - 0.05 * Easing.easeOutCubic(t);
    } else {
      var t2 = Math.min(elapsed / BUTTON_RELEASE_DURATION, 1);
      var s = 0.95 + 0.05 * Easing.easeOutBack(t2, 1.5);
      if (t2 >= 1) {
        delete _btnPress[key];
      }
      return s;
    }
  }

  // 无按压动画 → 检查呼吸
  return _getBreatheScale(key);
}

function _getBreatheScale(key) {
  var startTime = _btnBreathe[key];
  if (!startTime) return 1;

  var elapsed = Date.now() - startTime;
  if (elapsed >= BREATHE_DURATION) {
    delete _btnBreathe[key];
    return 1;
  }

  var t = elapsed / BREATHE_DURATION;
  var dampen = 1 - t;
  var oscillation = Math.sin(t * BREATHE_CYCLES * Math.PI * 2);
  return 1 + oscillation * BREATHE_AMPLITUDE * dampen;
}

function _startBtnPress(key) {
  _btnPress[key] = { startTime: Date.now(), phase: 'pressing' };
}

function _releaseBtnPress(key) {
  if (_btnPress[key]) {
    _btnPress[key] = { startTime: Date.now(), phase: 'releasing' };
  }
}

function _startBtnBreathe(key) {
  _btnBreathe[key] = Date.now();
}

// ===== 触控处理 =====

function handleTouch(x, y, type) {
  if (_animator.isClosed()) return false;
  if (_animator.getPhase() === 'opening') return true; // 动画中消费事件但不响应

  if (type === 'touchstart') {
    // 点关闭按钮
    if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
        y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
      _startBtnPress('close');
      _startBtnBreathe('close');
      close();
      return true;
    }

    // 点音乐开关
    if (_musicRect && x >= _musicRect.x && x <= _musicRect.x + _musicRect.w &&
        y >= _musicRect.y && y <= _musicRect.y + _musicRect.h) {
      var newVal = !audio.isMusicEnabled();
      audio.setMusicEnabled(newVal);
      _toggleMusicTarget = newVal;
      return true;
    }

    // 点音效开关
    if (_sfxRect && x >= _sfxRect.x && x <= _sfxRect.x + _sfxRect.w &&
        y >= _sfxRect.y && y <= _sfxRect.y + _sfxRect.h) {
      var newSfx = !audio.isSfxEnabled();
      audio.setSfxEnabled(newSfx);
      _toggleSfxTarget = newSfx;
      return true;
    }

    // 点底部按钮
    if (_btnRects) {
      for (var i = 0; i < _btnRects.length; i++) {
        var r = _btnRects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          _startBtnPress('btn_' + i);
          _startBtnBreathe('btn_' + i);
          if (r.action) r.action();
          return true;
        }
      }
    }

    // 点在遮罩上 → 关闭
    if (_panel) {
      var px = _panel.x, py = _panel.y, pw = _panel.w, ph = _panel.h;
      if (x < px || x > px + pw || y < py || y > py + ph) {
        close();
        return true;
      }
    }

    return true; // 面板内但不命中按钮：消费但不做任何操作
  }

  return type === 'touchstart' || type === 'touchend' || type === 'touchmove';
}

// ===== 工具 =====

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ===== 矢量图标 =====

function drawGearIcon(ctx, cx, cy, r, color) {
  var teethR = r * 0.15;
  var bodyR = r * 0.78;
  var innerR = r * 0.28;
  var teethCount = 8;

  for (var i = 0; i < teethCount; i++) {
    var angle = Math.PI * 2 * i / teethCount - Math.PI / 2;
    var tx = cx + Math.cos(angle) * bodyR;
    var ty = cy + Math.sin(angle) * bodyR;
    ctx.beginPath();
    ctx.arc(tx, ty, teethR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
}

module.exports = {
  open: open,
  close: close,
  toggle: toggle,
  isOpen: isOpen,
  render: render,
  handleTouch: handleTouch,
  drawGearIcon: drawGearIcon,
};
