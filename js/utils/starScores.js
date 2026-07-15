// 星级积分计算工具（编辑器 / 游玩共用）
// 计分规则：每逃出 1 猪 = 1 积分；剩余每 1 步 = 2 积分。
// 默认星级门槛：maxScore ≈ 猪数 + 总步数×0.5（总步数约 1/4 可转化为剩余步数，每步 2 分）
//   s1..s4 = round([0.25, 0.50, 0.75, 0.95] × maxScore)
// 星级档位 tier = starScores 中 ≤ score 的档位数（0~4）。

var RATIOS = [0.25, 0.50, 0.75, 0.95];

function computeDefaultStarScores(pigCount, totalSteps) {
  var steps = (typeof totalSteps === 'number' && totalSteps > 0) ? totalSteps : 0;
  var maxScore = (pigCount || 0) + steps * 0.5;
  var out = [];
  for (var i = 0; i < 4; i++) {
    out.push(Math.max(1, Math.round(RATIOS[i] * maxScore)));
  }
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
  computeDefaultStarScores: computeDefaultStarScores,
  getStarTier: getStarTier,
  getStar4Score: getStar4Score,
};
