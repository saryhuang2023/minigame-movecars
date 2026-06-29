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

    // 同步清理 level_info 中该用户的关主记录
    try {
      const masterDocs = await db.collection('level_info')
        .where({ masterUserId: OPENID })
        .get();

      if (masterDocs.data.length > 0) {
        for (const doc of masterDocs.data) {
          await db.collection('level_info').doc(doc._id).update({
            data: {
              masterUserId: db.command.remove(),
              masterSteps: db.command.remove(),
              masterAvatarUrl: db.command.remove(),
              masterNickname: db.command.remove(),
              updatedAt: new Date()
            }
          });
        }
        console.log('[deletePlayerProfile] 已清除 ' + masterDocs.data.length + ' 条关主记录 OPENID=' + OPENID);
      }
    } catch (e) {
      console.warn('[deletePlayerProfile] 清理关主记录失败（非致命）:', e.message);
    }

    return { code: 0, deleted: true, msg: 'ok' };
  } catch (err) {
    console.error('[deletePlayerProfile]', err);
    return { code: -1, msg: err.message };
  }
};
