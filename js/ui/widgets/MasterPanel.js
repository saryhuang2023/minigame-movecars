// 关主面板 — 左下角显示关主信息 + 我的记录 + 当前步数
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

var MUTED = Theme.colors.muted;

/**
 * @param {Object} opts
 */
function MasterPanel(opts) {
  UIComponent.call(this, {
    x: 5,
    y: SCREEN_HEIGHT - 74 - 5,
    w: 150,
    h: 74,
    zIndex: opts.zIndex || 1,
  });

  // 数据
  this._master = null;        // { userId, steps, avatarUrl, nickname }
  this._myRecord = null;      // number | null
  this._currentSteps = 0;
  this._loading = true;

  // 头像 Image 对象
  this._avatarImg = null;
  this._avatarLoaded = false;

  // 版圆角
  this._radius = 20;

  // 头像区域（点击显示昵称）
  this._avatarRect = null;

  // 回调
  this.onAvatarClick = opts.onAvatarClick || null;

  // 可见性由引擎控制
  this._hiddenByTrial = false;
}

MasterPanel.prototype = Object.create(UIComponent.prototype);
MasterPanel.prototype.constructor = MasterPanel;

MasterPanel.prototype.setData = function (master, myRecord, currentSteps, loading) {
  this._master = master || null;
  this._myRecord = myRecord != null ? myRecord : null;
  this._currentSteps = currentSteps || 0;
  this._loading = !!loading;
};

MasterPanel.prototype.setAvatar = function (img) {
  this._avatarImg = img;
  this._avatarLoaded = img && img.complete;
};

/** 设置当前用户 openid（用于判断"我是关主"） */
MasterPanel.prototype.setMyUserId = function (userId) {
  this._myUserId = userId || null;
};

MasterPanel.prototype.setHiddenByTrial = function (hidden) {
  this._hiddenByTrial = !!hidden;
};

MasterPanel.prototype.render = function (ctx) {
  if (this._hiddenByTrial) return;

  var badgeW = 150, badgeH = 74;
  var badgeX = 5, badgeY = SCREEN_HEIGHT - badgeH - 5;
  var badgeR = this._radius;

  // 面板容器
  ctx.save();
  ctx.shadowColor = Theme.shadow.panel.color;
  ctx.shadowBlur = Theme.shadow.panel.blur;
  ctx.shadowOffsetY = Theme.shadow.panel.offsetY;

  var grad = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + badgeH);
  grad.addColorStop(0, Theme.colors.pinkLight);
  grad.addColorStop(0.6, Theme.colors.white);
  grad.addColorStop(1, Theme.colors.pinkMid);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(badgeX + badgeR, badgeY);
  ctx.lineTo(badgeX + badgeW - badgeR, badgeY);
  ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeR, badgeR);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - badgeR);
  ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - badgeR, badgeY + badgeH, badgeR);
  ctx.lineTo(badgeX + badgeR, badgeY + badgeH);
  ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - badgeR, badgeR);
  ctx.lineTo(badgeX, badgeY + badgeR);
  ctx.arcTo(badgeX, badgeY, badgeX + badgeR, badgeY, badgeR);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 边框
  ctx.save();
  ctx.strokeStyle = Theme.colors.pinkBorder;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(badgeX + badgeR, badgeY);
  ctx.lineTo(badgeX + badgeW - badgeR, badgeY);
  ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeR, badgeR);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - badgeR);
  ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - badgeR, badgeY + badgeH, badgeR);
  ctx.lineTo(badgeX + badgeR, badgeY + badgeH);
  ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - badgeR, badgeR);
  ctx.lineTo(badgeX, badgeY + badgeR);
  ctx.arcTo(badgeX, badgeY, badgeX + badgeR, badgeY, badgeR);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 顶部高光线
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(badgeX + badgeR, badgeY);
  ctx.lineTo(badgeX + badgeW - badgeR, badgeY);
  ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeR, badgeR);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - badgeR);
  ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - badgeR, badgeY + badgeH, badgeR);
  ctx.lineTo(badgeX + badgeR, badgeY + badgeH);
  ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - badgeR, badgeR);
  ctx.lineTo(badgeX, badgeY + badgeR);
  ctx.arcTo(badgeX, badgeY, badgeX + badgeR, badgeY, badgeR);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(badgeX + badgeR, badgeY + 0.5);
  ctx.lineTo(badgeX + badgeW - badgeR, badgeY + 0.5);
  ctx.stroke();
  ctx.restore();

  // === 内容 ===
  var innerY = badgeY + 8;
  var innerX = badgeX + 8;

  if (this._loading) {
    ctx.fillStyle = MUTED;
    ctx.font = '12px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('加载中...', innerX + 30, innerY + 10);
  } else {
    // ===== 左栏：关主 =====
    var divX = badgeX + 62;  // 分隔线位置（对齐旧版 _renderMasterBadge）
    var leftCx = badgeX + 30; // 左栏中心 X（对齐旧版）
    var isMeMaster = (this._master && this._master.masterUserId === this._myUserId);

    // 关主标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isMeMaster ? Theme.colors.pink : Theme.colors.dark;
    ctx.font = 'bold 11px ' + Theme.font.family;
    ctx.fillText(isMeMaster ? '我是关主' : '关主记录', leftCx, innerY);

    if (this._master) {
      // 头像（圆形裁剪）
      var avaSize = 36;
      var avaX = leftCx - avaSize / 2;
      var avaY = innerY + 12;
      this._avatarRect = { x: avaX, y: avaY, w: avaSize, h: avaSize };

      ctx.save();
      ctx.beginPath();
      ctx.arc(avaX + avaSize / 2, avaY + avaSize / 2, avaSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (this._avatarImg && this._avatarLoaded) {
        ctx.drawImage(this._avatarImg, avaX, avaY, avaSize, avaSize);
      } else {
        ctx.fillStyle = Theme.colors.pinkBg;
        ctx.fillRect(avaX, avaY, avaSize, avaSize);
      }
      ctx.restore();

      // 关主步数
      var stepsText = this._master.masterSteps + '步';
      var stepY = innerY + avaSize + 12;
      ctx.font = 'bold 12px ' + Theme.font.family;
      var stepsTW = ctx.measureText(stepsText).width;
      var pillPad = 5, pillH = 18;
      var pillX = leftCx - stepsTW / 2 - pillPad;
      var pillY = stepY - 1;
      var pillW = stepsTW + pillPad * 2;

      // 金色圆角背景
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = Theme.colors.gold;
      ctx.beginPath();
      var pr = 4;
      ctx.moveTo(pillX + pr, pillY);
      ctx.lineTo(pillX + pillW - pr, pillY);
      ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pr, pr);
      ctx.lineTo(pillX + pillW, pillY + pillH - pr);
      ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - pr, pillY + pillH, pr);
      ctx.lineTo(pillX + pr, pillY + pillH);
      ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - pr, pr);
      ctx.lineTo(pillX, pillY + pr);
      ctx.arcTo(pillX, pillY, pillX + pr, pillY, pr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = Theme.colors.dark;
      ctx.fillText(stepsText, leftCx, stepY);
    } else {
      // 无管主 → 显示「无」
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = MUTED;
      ctx.font = '11px ' + Theme.font.family;
      ctx.fillText('无人通关', leftCx, innerY + 18);
    }

    // ===== 分隔竖线（始终绘制）=====
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX, badgeY + 12);
    ctx.lineTo(divX, badgeY + badgeH - 12);
    ctx.stroke();

    // ===== 右栏：我的信息（始终绘制）=====
    var rightX = divX + 8;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // 我的记录
    ctx.fillStyle = Theme.colors.dark;
    ctx.font = '12px ' + Theme.font.family;
    var recText = '我的记录:' + (this._myRecord != null ? this._myRecord: '无');
    ctx.fillText(recText, rightX, innerY);

    // 当前步数（金色强调）
    ctx.fillStyle = Theme.colors.gold;
    ctx.font = 'bold 12px ' + Theme.font.family;
    ctx.fillText('当前步数:' + this._currentSteps, rightX, innerY + 22);
  }
};

module.exports = MasterPanel;
