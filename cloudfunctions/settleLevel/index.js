// 云函数：关卡金币结算（服务器权威）
// 客户端传 levelId + pigCount，服务器计算奖励并更新 players 集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { levelId, pigCount, stepBonus, double } = event;
  const { OPENID } = cloud.getWXContext();

  if (!levelId || pigCount == null) {
    return { code: 1, msg: '缺少 levelId 或 pigCount' };
  }

  try {
    // 查找玩家记录
    const exist = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    if (exist.data.length === 0) {
      return { code: 2, msg: '玩家记录不存在' };
    }

    const player = exist.data[0];

    // 防重复刷金币：进度线性，已通关最高关 = lastLevelIndex。
    // 仅当本关比已记录进度更靠前（即首通）才发奖，否则视为已领过。
    if (typeof player.lastLevelIndex === 'number' && levelId <= player.lastLevelIndex) {
      return {
        code: 0,
        gold: player.gold || 0,
        reward: 0,
        claimed: false,
        msg: '已领取过'
      };
    }

    // 计算奖励 = 猪数量 + 步数奖励
    var reward = Math.max(0, parseInt(pigCount, 10) || 0) + Math.max(0, parseInt(stepBonus, 10) || 0);
    if (double) {
      reward *= 2;
    }

    var newGold = (player.gold || 0) + reward;
    var newLastLevelIndex = Math.max(player.lastLevelIndex || 0, levelId);

    // 原子更新
    await db.collection('players')
      .doc(player._id)
      .update({
        data: {
          gold: newGold,
          lastLevelIndex: newLastLevelIndex,
          updatedAt: db.serverDate()
        }
      });

    console.log('[settleLevel] OPENID=' + OPENID +
      ' levelId=' + levelId +
      ' pigCount=' + pigCount +
      ' stepBonus=' + (stepBonus || 0) +
      ' double=' + double +
      ' reward=' + reward +
      ' gold=' + player.gold + '→' + newGold);

    return {
      code: 0,
      gold: newGold,
      reward: reward,
      claimed: true,
      msg: 'ok'
    };

  } catch (err) {
    console.error('[settleLevel]', err);
    return { code: -1, msg: err.message };
  }
};
