// 推猪消除 — 通用加载中窗（等待异步 / 服务器回包时提示玩家并屏蔽触摸）
// 全屏半透明遮罩 + 居中旋转加载环（+ 可选文案，无面板背景）
//
// 用法：
//   LoadingDialog.open({ text: '加载中...' });   // 打开（可重复调用：仅更新文案，不重启动画）
//   ... 同步等待服务器回包 / 异步拉起微信分享 ...
//   LoadingDialog.close();                        // 关闭（动画淡出，期间不再拦截触摸）
//
// 每帧渲染前 LoadingDialog.render(ctx)；全局触控拦截在 InputManager 中（打开时吞噬所有触摸，含面板外）。

var PopupAnimator = require('./PopupAnimator.js');
var Theme = require('../define/GameDefine.js').THEME;
var databus = require('../databus.js');

// ===== 状态 =====
var _animator = PopupAnimator.createPopupAnimator();
var _opts = null;

// ===== 布局常量 =====
var SPIN_R = 24;          // 加载环半径

function open(opts) {
  opts = opts || {};
  // 已在显示：仅更新文案，避免重复 open 重启入场动画（重试用例下保持连续）
  if (_animator.isOpen() || _animator.getPhase() === 'opening') {
    if (opts.text != null) _opts.text = opts.text;
    return;
  }
  _opts = { text: opts.text || '' };
  _animator.open();
}

function close() {
  if (_animator.isClosed()) return;
  _animator.close(function () {
    _opts = null;
  });
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

// ===== 渲染 =====
function render(ctx) {
  if (_animator.isClosed() || !_opts) return;

  var state = _animator.update();
  if (_animator.isClosed() || !_opts) return;

  var alpha = state.alpha;
  var maskAlpha = state.maskAlpha;

  // 1. 半透明遮罩（保留：视觉聚焦 + 与 InputManager 触摸屏蔽配合，提示「不可操作」）
  if (maskAlpha > 0.005) {
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, databus.screenWidth, databus.screenHeight);
  }
  if (alpha < 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // 2. 居中旋转加载环（按真实时间推进，每帧重绘即动画）
  var cx = databus.screenWidth / 2;
  var cy = databus.screenHeight / 2;
  var rot = (Date.now() % 1000) / 1000 * Math.PI * 2;   // ~1s/圈
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  // 轨道（浅色，衬在深色遮罩上）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, SPIN_R, 0, Math.PI * 2);
  ctx.stroke();
  // 活动弧（橙金主题色）
  ctx.strokeStyle = '#FF8925';
  ctx.beginPath();
  ctx.arc(cx, cy, SPIN_R, rot, rot + Math.PI * 1.4);
  ctx.stroke();

  // 3. 文案（仅在传入时绘制；要纯圆圈可传 text:'' 或不传）
  if (_opts.text) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(_opts.text, cx, cy + SPIN_R + 16);
  }

  ctx.restore();
}

// ===== 触控处理：打开期间吞噬所有触摸（加载中不可操作，亦不可点遮罩关闭）=====
function handleEvent() {
  return true;
}

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  render: render,
  handleEvent: handleEvent,
};
