// starScores.js — 星级积分计算工具（编辑器 / 游玩共用）
// 计分：每逃 1 猪 = 1 分；剩余每 1 步 = 1 分（achievedScore = escapedCount + stepBonus）。
//
// 默认星级门槛（2026-07-16 方案，详见 document/关卡星级算法-设计方案.md）：
//   难度3档(easy/normal/hard)，minSteps倍率 1.1/1.2/1.3，可省步数 = totalSteps − N×minMul，
//   3星 = N + 可省×0.55，4星 = N + 可省×0.80；1星 = 3星×1/4，2星 = 3星×2/3（每步1分）。
//   difficulty 优先读关卡字段，否则按 levelId 默认(≤20简单/≤100标准/>100难)，再否则 normal。

var TOTAL_MUL = { easy: 2.5, normal: 2.0, hard: 1.7 };
var MIN_MUL   = { easy: 1.1, normal: 1.2, hard: 1.3 };
var RATIOS    = [0, 0.25, 0.55, 0.80];   // 1星0%(通关) / 2星25% / 3星55% / 4星80% （占可省步数比例）

/** 按关卡 ID 默认难度 */
function difficultyById(levelId) {
  var id = (typeof levelId === 'number' && levelId > 0) ? levelId : -1;
  if (id <= 20) return 'easy';
  if (id <= 100) return 'normal';
  return 'hard';
}

/** 解析有效难度：关卡字段优先 → levelId 默认 → normal */
function resolveDifficulty(data, levelId) {
  if (data) {
    if (data.difficulty === 'easy') return 'easy';
    if (data.difficulty === 'normal') return 'normal';
    if (data.difficulty === 'hard') return 'hard';
  }
  if (typeof levelId === 'number' && levelId > 0) return difficultyById(levelId);
  return 'normal';
}

/**
 * 计算默认星级门槛 [s1,s2,s3,s4]
 * @param {number} pigCount 猪数 N
 * @param {number} totalSteps 总步数预算（stepBonusThreshold）
 * @param {string} [difficulty] 'easy'|'normal'|'hard'；缺省按 normal
 * @param {number} [levelId] 关卡 ID（difficulty 缺省时可用于按 ID 推断，这里留作扩展位）
 */
function computeDefaultStarScores(pigCount, totalSteps, difficulty) {
  var N = pigCount || 0;
  var diff = (difficulty === 'easy' || difficulty === 'normal' || difficulty === 'hard')
    ? difficulty : 'normal';
  var steps = (typeof totalSteps === 'number' && totalSteps > 0) ? totalSteps : 0;
  var minSteps = N * MIN_MUL[diff];
  var savable = Math.max(0, steps - minSteps);   // 可省步数 = 总步数 − 最少通关步数
  var s3 = Math.max(1, Math.round(N + savable * 0.55));
  var out = [
    Math.max(1, Math.round(s3 / 4)),              // 1星 = 3星 × 1/4
    Math.max(1, Math.round(s3 * 2 / 3)),           // 2星 = 3星 × 2/3
    s3,                                             // 3星 = N + 可省×0.55
    Math.max(1, Math.round(N + savable * 0.80)),   // 4星 = N + 可省×0.80
  ];
  return out;
}

// score 落在哪一档（0~4）
function getStarTier(score, starScores) {
  if (!starScores || starScores.length < 4) return 0;
  var s = score || 0;
  var tier = 0;
  for (var i = 0; i < 4; i++) {
    if (s >= starScores[i]) tier = i + 1;
  }
  return tier;
}

// 进度条分母 = 4 星门槛；缺失时回退 fallback（再不行 30）
function getStar4Score(starScores, fallback) {
  if (starScores && starScores.length >= 4 && starScores[3] > 0) return starScores[3];
  if (typeof fallback === 'number' && fallback > 0) return fallback;
  return 30;
}

module.exports = {
  RATIOS: RATIOS,
  TOTAL_MUL: TOTAL_MUL,
  MIN_MUL: MIN_MUL,
  difficultyById: difficultyById,
  resolveDifficulty: resolveDifficulty,
  computeDefaultStarScores: computeDefaultStarScores,
  getStarTier: getStarTier,
  getStar4Score: getStar4Score,
};
