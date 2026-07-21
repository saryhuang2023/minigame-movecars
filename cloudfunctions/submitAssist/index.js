// 云函数：好友提交协助录制
// 接收序列化的录制条目（原始 JSON 字符串），服务端压缩为 BASE64(DEFLATE) 存储。
// 校验：未过期 / assists<3 / 同 openid 未重复；通过则 push 一条 assist 记录，满 3 人标记 full。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const zlib = require('zlib');

function isExpired(doc) {
  if (!doc.expiresAt) return false;
  const t = (doc.expiresAt instanceof Date) ? doc.expiresAt.getTime() : new Date(doc.expiresAt).getTime();
  return t <= Date.now();
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { helpKey, recording, result, assistant } = event;

  if (!helpKey) return { code: 1, msg: 'helpKey missing' };
  if (!recording || typeof recording !== 'string') return { code: 1, msg: 'recording missing' };
  if (!assistant || !assistant.nickName) return { code: 1, msg: 'assistant missing' };

  const recordingB64 = zlib.deflateSync(recording).toString('base64');

  try {
    const res = await db.collection('help_requests').where({ helpKey }).get();
    if (res.data.length === 0) return { code: 2, msg: 'not found' };

    const doc = res.data[0];
    const assists = doc.assists || [];

    if (isExpired(doc) || doc.status === 'expired') return { code: 4, msg: 'expired' };

    const assistEntry = {
      assistantOpenId: OPENID,
      assistant: {
        nickName: assistant.nickName || '',
        avatarUrl: assistant.avatarUrl || '',
      },
      recordedAt: db.serverDate(),
      recording: recordingB64,                       // BASE64(DEFLATE(entries))
      result: result || {},                          // { escapedPigs, totalPigs }
    };

    // 已协助过 → 覆盖旧记录：移除旧的、追加新的；名额不新增（保证「重新协助覆盖旧记录」真正生效）
    const existingIdx = assists.findIndex(a => a.assistantOpenId === OPENID);
    if (existingIdx >= 0) {
      const newAssists = assists.filter((_, i) => i !== existingIdx);
      const newIdx = newAssists.length;   // 重新追加后的下标
      newAssists.push(assistEntry);
      const updateData = { assists: newAssists, lastAssistedBy: OPENID };
      if (newAssists.length >= 3) updateData.status = 'full';
      await db.collection('help_requests').doc(doc._id).update({ data: updateData });
      return { code: 0, overwritten: true, openId: OPENID, idx: newIdx };
    }

    // 新协助者：满员（且不含自己）作为安全网拒绝，否则正常追加
    if (assists.length >= 3) return { code: 3, msg: 'full' };

    const newIdx = assists.length;   // 追加后的下标
    const updateData = {
      assists: _.push(assistEntry),
      lastAssistedBy: OPENID,
    };
    if (assists.length + 1 >= 3) updateData.status = 'full';

    await db.collection('help_requests').doc(doc._id).update({ data: updateData });

    return { code: 0, overwritten: false, openId: OPENID, idx: newIdx };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
