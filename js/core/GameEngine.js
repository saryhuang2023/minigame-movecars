// 游戏主循环引擎

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');

class GameEngine {
  constructor() {
    this.input = new InputManager();
    this.editor = new EditorEngine(this.input);

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

    // 背景渐变
    const grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('猪了个猪呀', SCREEN_WIDTH / 2, SCREEN_HEIGHT * 0.28);

    // 副标题
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText('小猪推推乐', SCREEN_WIDTH / 2, SCREEN_HEIGHT * 0.28 + 38);

    // 按钮
    this.menuButtons = [];
    const btnW = 200, btnH = 52;
    const startX = (SCREEN_WIDTH - btnW) / 2;

    this.addMenuBtn(startX, SCREEN_HEIGHT * 0.50, btnW, btnH, '开始游戏', '#4CAF50', () => {
      databus.gameState = 'playing';
    });

    this.addMenuBtn(startX, SCREEN_HEIGHT * 0.50 + 64, btnW, btnH, '关卡编辑器', '#FF9800', () => {
      databus.gameState = 'editor';
      this.editor.activate();
    });

    // 渲染按钮
    for (const btn of this.menuButtons) {
      // 按钮背景
      ctx.fillStyle = btn.color;
      this.roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10);
      ctx.fill();

      // 按钮文字
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

  // ========== 游戏 ==========
  renderPlaying() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = '#2d8cf0';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏中...', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
  }

  // ========== 主循环 ==========
  update() {
    databus.frame++;
    this.input.handlePendingEvents();
  }

  render() {
    switch (databus.gameState) {
      case 'menu':
        this.renderMenu();
        break;
      case 'playing':
        this.renderPlaying();
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
