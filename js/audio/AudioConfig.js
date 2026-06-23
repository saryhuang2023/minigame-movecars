// 推猪消除 — 音频系统配置
// 方案：主包内置 button_click（8KB）→ 其余从云存储按需下载 + 本地缓存

var CLOUD_ENV = require('../cloud.js').CLOUD_ENV || 'cloud1-4gmoyu9g16089510';

// ===== 云存储配置 =====
// 上传音频文件到云存储后，在控制台查看任意文件的 fileID，获取此前缀
// fileID 格式: cloud://{env-id}.{dirHash}-{appid}/audio/sfx/collide_1.mp3
// 去掉最后文件名即为前缀。留空字符串可关闭云存储下载
var CLOUD_PREFIX = '';

/**
 * 从云存储 fileID 中提取前缀
 * 用法: 在云开发控制台 → 存储 → 点击任意音频文件 → 复制 fileID
 *       然后调用 AudioConfig.setCloudPrefix(fileID)
 *       例如 setCloudPrefix('cloud://env.636c-wxe02448bcf0540ff0/audio/sfx/collide_1.mp3')
 *       → 自动提取为 'cloud://env.636c-wxe02448bcf0540ff0/audio/'
 */
function setCloudPrefix(sampleFileID) {
  if (!sampleFileID || sampleFileID.indexOf('cloud://') !== 0) return;
  // sampleFileID 示例: cloud://env.636c-wxe02448bcf0540ff0/audio/sfx/escape_1.mp3
  // 提取前缀到 /audio/（不含子目录），让下载时自动追加 sfx/ 或 music/
  var audioIdx = sampleFileID.indexOf('/audio/');
  if (audioIdx >= 0) {
    CLOUD_PREFIX = sampleFileID.substring(0, audioIdx) + '/audio/';
  } else {
    var lastSlash = sampleFileID.lastIndexOf('/');
    if (lastSlash > 0) {
      CLOUD_PREFIX = sampleFileID.substring(0, lastSlash + 1);
    }
  }
  console.log('[AudioConfig] CLOUD_PREFIX set:', CLOUD_PREFIX);
}

function isCloudEnabled() {
  return !!CLOUD_PREFIX;
}

// ===== 版本检测 =====
// 云存储 audio/version.txt 内容为一个递增整数或时间戳
// 启动时比对本地缓存的版本号，不一致则清缓存重拉
var AUDIO_VERSION_KEY = 'audio_cache_version';
var VERSION_FILE = 'version.txt'; // 相对于 CLOUD_PREFIX 的路径

// ===== 本地路径（主包内置 + 云存储缓存） =====
var CACHE_DIR = wx.env.USER_DATA_PATH + '/audio/';
var SFX_CACHE_DIR = CACHE_DIR + 'sfx/';
var MUSIC_CACHE_DIR = CACHE_DIR + 'music/';

// 主包音频目录（button_click.mp3 放这里，其余可选择性放）
var LOCAL_SFX_DIR = 'assets/audio/sfx/';
var LOCAL_MUSIC_DIR = 'assets/audio/music/';

// ===== 语音预算 =====
var MAX_VOICES = 8;

// ===== 优先级（数字越小越优先，不会被抢占） =====
var PRIORITY = {
  UI:       0,  // UI 反馈，绝不抢
  VICTORY:  0,  // 胜利，绝不抢
  ACTION:   1,  // 操作反馈（拖拽、提示、重置）
  SFX:      2,  // 核心音效（碰撞、飞出）
  AMBIENT:  3,  // 环境/循环音效（旋转）
};

// ===== SFX 事件定义 =====
// key: 事件名（AudioManager.play('collide') 的参数）
// files: 音频文件名数组（随机选变体）
// priority: 抢占优先级
var SFX_EVENTS = {
  // ── P0 核心 ──
  'collide': {
    files: ['collide_1.mp3'],
    priority: PRIORITY.SFX,
  },
  'escape': {
    files: ['escape_2.mp3'],
    priority: PRIORITY.SFX,
  },
  'victory': {
    files: ['victory.mp3'],
    priority: PRIORITY.VICTORY,
  },
  'button_click': {
    files: ['button_click.mp3'],
    priority: PRIORITY.UI,
  },

  // ── P1 增强 ──
  'drag_start': {
    files: ['drag_start.mp3'],
    priority: PRIORITY.ACTION,
  },
  'hint_reveal': {
    files: ['hint_reveal.mp3'],
    priority: PRIORITY.ACTION,
  },
  'hint_ghost': {
    files: ['hint_ghost.mp3'],
    priority: PRIORITY.AMBIENT,
  },
  'reset': {
    files: ['reset.mp3'],
    priority: PRIORITY.ACTION,
  },
  'level_start': {
    files: ['level_start.mp3'],
    priority: PRIORITY.ACTION,
  },

  // ── P2 锦上添花 ──
  'rotate_loop': {
    files: ['rotate_loop.mp3'],
    priority: PRIORITY.AMBIENT,
  },
};

// ===== 音乐配置 =====
var MUSIC = {
  explore: {
    file: 'bgm_explore.mp3',
    volume: 0.5,
    fadeMs: 2000,
  },
  level: {
    file: 'bgm_level.mp3',
    volume: 0.5,
    fadeMs: 2000,
  },
};

module.exports = {
  // 云存储
  get CLOUD_PREFIX() { return CLOUD_PREFIX; },
  setCloudPrefix: setCloudPrefix,
  isCloudEnabled: isCloudEnabled,

  // 路径
  CACHE_DIR: CACHE_DIR,
  SFX_CACHE_DIR: SFX_CACHE_DIR,
  MUSIC_CACHE_DIR: MUSIC_CACHE_DIR,
  LOCAL_SFX_DIR: LOCAL_SFX_DIR,
  LOCAL_MUSIC_DIR: LOCAL_MUSIC_DIR,

  // 版本检测
  AUDIO_VERSION_KEY: AUDIO_VERSION_KEY,
  VERSION_FILE: VERSION_FILE,

  // 音频参数
  MAX_VOICES: MAX_VOICES,
  PRIORITY: PRIORITY,
  SFX_EVENTS: SFX_EVENTS,
  MUSIC: MUSIC,
};
