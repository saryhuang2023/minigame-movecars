// 游戏主循环引擎

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');
const LevelSelectEngine = require('../game/LevelSelectEngine.js');
const PlayingEngine = require('../game/PlayingEngine.js');
const { drawComposedPig, getComposedPigSize } = require('../render/PigRenderer.js');

class GameEngine {
  constructor() {
    this.input = new InputManager();
    this.editor = new EditorEngine(this.input);
    this.levelSelect = new LevelSelectEngine(this.input);
    this.playing = new PlayingEngine(this.input);

    // 背景图
    this.bgImg = wx.createImage();
    this.bgImg.src = 'assets/images/bg.jpeg';

    // 菜单按钮
    this.menuButtons = [];

    this.start();
  }

  /** 启动主循环 */
  start() {
    databus.screenWidth = SCREEN_WIDTH;
    databus.screenHeight = SCREEN_HEIGHT;
    databus.gameState = 'menu';
    this.setupMenuInput();
    this.loop();
  }

  // ========== 菜单 ==========
  setupMenuInput() {
    this.input.on('menu', (e) => {
      if (e.type === 'touchstart' && e.touches[0]) {
        const t = e.touches[0];
        for (const btn of this.menuButtons) {
          if (t.x >= btn.x && t.x <= btn.x + btn.w &&
              t.y >= btn.y && t.y <= btn.y + btn.h) {
            if (btn.action) btn.action();
            return;
          }
        }
      }
    });
  }

  renderMenu() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 背景图 — 缩放至屏幕大小
    if (this.bgImg.width) {
      ctx.drawImage(this.bgImg, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    } else {
      // 图片未加载完成时使用渐变色占位
      const grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(1, '#16213e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }

    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('猪了个猪呀', SCREEN_WIDTH / 2, SCREEN_HEIGHT * 0.16);

    // 三图拼接小猪 — 屏幕正中央，等比例缩放至屏宽 65%，带漂浮效果
    const pigSize = getComposedPigSize();
    let pigX = 0, pigY = 0, pigDrawH = 0, pigW = 0;
    if (pigSize) {
      const scale = (SCREEN_WIDTH * 0.65) / pigSize.naturalW;
      pigW = pigSize.naturalW * scale;
      pigDrawH = pigSize.naturalH * scale;
      pigX = (SCREEN_WIDTH - pigW) / 2;
      pigY = (SCREEN_HEIGHT - pigDrawH) / 2;

      // 漂浮效果：上下浮动 + 轻微摇摆
      const floatOffset = Math.sin(databus.frame * 0.16) * 2.5;
      const swayAngle = Math.sin(databus.frame * 0.02) * 1.5; // 度
      pigY += floatOffset;

      const cx = pigX + pigW / 2;
      const cy = pigY + pigDrawH / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(swayAngle * Math.PI / 180);
      ctx.translate(-cx, -cy);
      drawComposedPig(ctx, pigX, pigY, scale);
      ctx.restore();
    }

    // 按钮 — 底部区域
    this.menuButtons = [];
    const btnW = 200, btnH = 52;
    const startX = (SCREEN_WIDTH - btnW) / 2;
    const btnBaseY = SCREEN_HEIGHT * 0.78;

    this.addMenuBtn(startX, btnBaseY, btnW, btnH, '开始游戏', '#4CAF50', () => {
      databus.gameState = 'levelSelect';
    });

    this.addMenuBtn(startX, btnBaseY + 64, btnW, btnH, '关卡编辑器', '#FF9800', () => {
      databus.gameState = 'editor';
    });

    for (const btn of this.menuButtons) {
      ctx.fillStyle = btn.color;
      this.roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
    }
  }

  addMenuBtn(x, y, w, h, text, color, action) {
    this.menuButtons.push({ x, y, w, h, text, color, action });
  }

  // ========== 主循环 ==========
  update() {
    databus.frame++;

    // 状态切换（在事件处理之前，确保引擎已激活）
    this.checkStateTransition();

    this.input.handlePendingEvents();

    // 游玩状态更新动画
    if (databus.gameState === 'playing') {
      this.playing.gp.update();
    }
    if (databus.gameState === 'editor') {
      this.editor.gp.update();
    }
  }

  // 跟踪上一个状态，自动管理 activate/deactivate
  checkStateTransition() {
    const curr = databus.gameState;
    if (curr === this._prevState) return;

    // 反激活旧状态
    switch (this._prevState) {
      case 'editor':      this.editor.deactivate();        break;
      case 'levelSelect': this.levelSelect.deactivate();   break;
      case 'playing':     this.playing.deactivate();       break;
    }

    // 激活新状态（menu 的输入在 setupMenuInput 已注册）
    switch (curr) {
      case 'editor':      this.editor.activate();          break;
      case 'levelSelect': this.levelSelect.activate();     break;
      case 'playing':     this.playing.activate();         break;
    }

    this._prevState = curr;
  }

  render() {
    switch (databus.gameState) {
      case 'menu':
        this.renderMenu();
        break;
      case 'levelSelect':
        this.levelSelect.render();
        break;
      case 'playing':
        this.playing.render();
        break;
      case 'editor':
        this.editor.render();
        break;
    }
  }

  loop() {
    this.update();
    this.render();
    requestAnimationFrame(this.loop.bind(this));
  }

  roundRect(ctx, x, y, w, h, r) {
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
}

module.exports = GameEngine;
