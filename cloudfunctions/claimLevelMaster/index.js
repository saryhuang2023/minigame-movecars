// 夺位关主（写入 level_info 集合）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { levelId, steps, avatarUrl, nickname } = event;
  const { OPENID } = cloud.getWXContext();

  if (!levelId || steps == null) return { code: 1, message: '参数不完整' };

  try {
    const res = await db.collection('level_info')
      .where({ levelId })
      .limit(1)
      .get();

    const current = res.data[0];
    const now = new Date();

    // 持平但同一用户尝试更新头像昵称（授权按钮重传场景）
    if (current && steps === current.masterSteps && current.masterUserId === OPENID && (avatarUrl || nickname)) {
      const patchData = { updatedAt: now };
      if (avatarUrl) patchData.masterAvatarUrl = avatarUrl;
      if (nickname) patchData.masterNickname = nickname;

      await db.collection('level_info')
        .doc(current._id)
        .update({ data: patchData });

      const updated = await db.collection('level_info')
        .where({ levelId })
        .limit(1)
        .get();

      return { code: 0, claimed: false, master: updated.data[0], msg: 'avatar updated' };
    }

    // 持平不夺：已有记录且步数不严格小于
    if (current && steps >= current.masterSteps) {
      return { code: 0, claimed: false, master: current };
    }

    // 新关主数据
    const updateData = {
      masterUserId: OPENID,
      masterSteps: steps,
      updatedAt: now
    };
    if (avatarUrl) updateData.masterAvatarUrl = avatarUrl;
    if (nickname) updateData.masterNickname = nickname;

    if (current) {
      // 更新（保留 crownSteps 等已有字段）
      await db.collection('level_info')
        .doc(current._id)
        .update({ data: updateData });
    } else {
      // 插入新记录（crownSteps 后续由首次部署时初始化）
      await db.collection('level_info').add({
        data: { levelId, crownSteps: 999, ...updateData }
      });
    }

    const updated = await db.collection('level_info')
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
