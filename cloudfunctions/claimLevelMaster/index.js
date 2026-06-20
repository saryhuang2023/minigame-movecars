// 夺位关主
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { levelId, steps, avatarUrl, nickname } = event;
  const { OPENID } = cloud.getWXContext();

  if (!levelId || steps == null) return { code: 1, message: '参数不完整' };

  try {
    const res = await db.collection('level_masters')
      .where({ levelId })
      .limit(1)
      .get();

    const current = res.data[0];

    // 持平不夺：已有记录且步数不严格小于
    if (current && steps >= current.minSteps) {
      return { code: 0, claimed: false, master: current };
    }

    const now = new Date();
    const updateData = {
      userId: OPENID,
      minSteps: steps,
      updatedAt: now
    };
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    if (nickname) updateData.nickname = nickname;

    if (current) {
      // 更新现有记录
      await db.collection('level_masters')
        .doc(current._id)
        .update({ data: updateData });
    } else {
      // 插入新记录
      await db.collection('level_masters').add({
        data: { levelId, ...updateData }
      });
    }

    // 读取更新后的记录
    const updated = await db.collection('level_masters')
      .where({ levelId })
      .limit(1)
      .get();

    return {
      code: 0,
      claimed: true,
      master: updated.data[0]
    };
  } catch (err) {
    console.error('[claimLevelMaster]', err);
    return { code: 2, message: err.message };
  }
};
