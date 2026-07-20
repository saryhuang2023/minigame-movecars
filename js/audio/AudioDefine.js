// AudioDefine — 音频系统配置与常量
// 自 AudioConfig.js 改名迁移（v133 常量整理）
// 所有静态常量在模块内定义，云端路径引用 CloudDefine

var CloudDefine = require('../define/CloudDefine.js');

// ===== 云存储配置 =====
var CLOUD_PREFIX = CloudDefine.CLOUD.AUDIO_PREFIX || '';

/**
 * 从云存储 fileID 中提取前缀
 * 用法: AudioDefine.setCloudPrefix(fileID)
 */
function setCloudPrefix(sampleFileID) {
  if (!sampleFileID || sampleFileID.indexOf('cloud://') !== 0) return;
  var audioIdx = sampleFileID.indexOf('/audio/');
  if (audioIdx >= 0) {
    CLOUD_PREFIX = sampleFileID.substring(0, audioIdx) + '/audio/';
  } else {
    var lastSlash = sampleFileID.lastIndexOf('/');
    if (lastSlash > 0) {
      CLOUD_PREFIX = sampleFileID.substring(0, lastSlash + 1);
    }
  }
  console.log('[AudioDefine] CLOUD_PREFIX set:', CLOUD_PREFIX);
}

function isCloudEnabled() {
  return !!CLOUD_PREFIX;
}

// ===== 指纹（MD5 内容指纹，与图片统一机制）=====
var AUDIO_FP_KEY = 'audio_cache_fingerprints';

// ===== 本地路径 =====
var CACHE_DIR = wx.env.USER_DATA_PATH + '/audio/';
var SFX_CACHE_DIR = CACHE_DIR + 'sfx/';
var MUSIC_CACHE_DIR = CACHE_DIR + 'music/';
// 注：音频是纯云资源（需求1 规定 assets/ 只含本地只读资源、绝不打包音频；需求5 音频纳入云版本管理）。
// 主包 assets/audio/ 目录不存在，故没有 LOCAL_SFX_DIR / LOCAL_MUSIC_DIR，查找链只有「缓存」与「云下载」两层。

// ===== 语音预算 =====
var MAX_VOICES = 8;

// ===== 优先级（数字越小越优先） =====
var PRIORITY = {
  UI: 0,
  VICTORY: 0,
  ACTION: 1,
  SFX: 2,
  AMBIENT: 3,
};

// ===== SFX 事件定义 =====
var SFX_EVENTS = {
  'collide':      { files: ['collide_duang.mp3'],    priority: PRIORITY.SFX },
  'escape':       { files: ['escape_2.mp3'],         priority: PRIORITY.SFX },
  'coin_fly':     { files: ['coin_fly.mp3'],         priority: PRIORITY.SFX },
  'coin_get':     { files: ['coin_get.mp3'],         priority: PRIORITY.SFX },
  'coin_roll':    { files: ['coin_roll.mp3'],        priority: PRIORITY.SFX },
  // 注：victory.mp3 / stamina_add.mp3 未上传到云端（cloud-src 无对应文件），
  // 这里改为引用云端实际存在的音频，保证 loading 全量下载后可用。
  'victory':      { files: ['rewards.mp3'],          priority: PRIORITY.VICTORY },
  'rewards':      { files: ['rewards.mp3'],          priority: PRIORITY.SFX },
  'button_click': { files: ['button_click.mp3'],     priority: PRIORITY.UI },
  'hint_reveal':  { files: ['hint_reveal.mp3'],      priority: PRIORITY.ACTION },
  'stamina_add':  { files: ['button_click.mp3'],     priority: PRIORITY.UI },
  'rotate_loop':  { files: ['rotate_loop.mp3'],      priority: PRIORITY.AMBIENT },
  // 通关失败音效（云端 sfx/game_loss.mp3，已放入云音效文件夹）
  'fail':         { files: ['game_loss.mp3'],        priority: PRIORITY.VICTORY },
};

// ===== 音乐配置 =====
var MUSIC = {
  explore: { file: 'bgm_explore.mp3', volume: 0.5, fadeMs: 2000 },
  level:   { file: 'bgm_level.mp3',   volume: 0.5, fadeMs: 2000 },
};

module.exports = {
  // 云存储（运行时可变）
  get CLOUD_PREFIX() { return CLOUD_PREFIX; },
  setCloudPrefix: setCloudPrefix,
  isCloudEnabled: isCloudEnabled,

  // 路径
  CACHE_DIR: CACHE_DIR,
  SFX_CACHE_DIR: SFX_CACHE_DIR,
  MUSIC_CACHE_DIR: MUSIC_CACHE_DIR,

  // 指纹
  AUDIO_FP_KEY: AUDIO_FP_KEY,

  // 音频参数
  MAX_VOICES: MAX_VOICES,
  PRIORITY: PRIORITY,
  SFX_EVENTS: SFX_EVENTS,
  MUSIC: MUSIC,
};
