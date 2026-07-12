// 云函数：删除玩家云端档案
// 删除 players 集合中当前用户的记录（含金币、进度、皮肤等）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const exist = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    if (exist.data.length === 0) {
      return { code: 0, deleted: false, msg: '玩家记录不存在，无需删除' };
    }

    await db.collection('players')
      .doc(exist.data[0]._id)
      .remove();

    console.log('[deletePlayerProfile] 已删除 players 记录 OPENID=' + OPENID);

    return { code: 0, deleted: true, msg: 'ok' };
  } catch (err) {
    console.error('[deletePlayerProfile]', err);
    return { code: -1, msg: err.message };
  }
};
