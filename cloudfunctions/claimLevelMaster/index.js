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
    const now = new Date();

    // 持平但同一用户尝试更新头像昵称（授权按钮重传场景）
    if (current && steps === current.minSteps && current.userId === OPENID && (avatarUrl || nickname)) {
      const patchData = { updatedAt: now };
      if (avatarUrl) patchData.avatarUrl = avatarUrl;
      if (nickname) patchData.nickname = nickname;

      await db.collection('level_masters')
        .doc(current._id)
        .update({ data: patchData });

      const updated = await db.collection('level_masters')
        .where({ levelId })
        .limit(1)
        .get();

      return { code: 0, claimed: false, master: updated.data[0], msg: 'avatar updated' };
    }

    // 持平不夺：已有记录且步数不严格小于（不同用户或无新头像昵称）
    if (current && steps >= current.minSteps) {
      return { code: 0, claimed: false, master: current };
    }

    const updateData = {
      userId: OPENID,
      minSteps: steps,
      updatedAt: now
    };
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    if (nickname) updateData.nickname = nickname;

    if (current) {
      // 更新现有记录（新关主）
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
