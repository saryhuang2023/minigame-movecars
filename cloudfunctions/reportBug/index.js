// 云函数：接收 Bug 诊断快照，去重存储
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/** 去重窗口（毫秒）：同设备 + 同错误消息，此窗口内视为重复 */
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 分钟

exports.main = async (event, context) => {
  const { report } = event;
  if (!report || !report.meta) {
    return { code: -1, msg: '缺少 report 或 meta' };
  }

  const meta = report.meta;
  const device = report.device || {};
  const error = report.error || {};
  const deviceId = device.deviceId || 'unknown';
  const now = Date.now();

  try {
    // 去重检查：同设备 + 同错误消息 + 同触发器 + 5分钟内 → 合并
    // 只有带错误信息的才去重（crash/unhandledRejection）；lag 和 user 不去重
    var shouldDedup = (meta.trigger === 'crash' || meta.trigger === 'unhandledRejection') && !!error.message;

    if (shouldDedup) {
      var existing = await db.collection('bug_reports')
        .where({
          'device.deviceId': deviceId,
          'error.message': error.message,
          'meta.trigger': meta.trigger
        })
        .orderBy('meta.timestamp', 'desc')
        .limit(1)
        .get();

      if (existing.data.length > 0) {
        var lastReport = existing.data[0];
        if (now - lastReport.meta.timestamp < DEDUP_WINDOW_MS) {
          // 5分钟内重复 → 增加计数器，更新最后出现时间
          await db.collection('bug_reports').doc(lastReport._id).update({
            data: {
              'meta.lastSeen': now,
              'meta.dupCount': _.inc(1)
            }
          });
          return { code: 0, msg: 'dedup', originalId: lastReport._id, dupCount: lastReport.meta.dupCount + 1 };
        }
      }
    }

    // 写入新记录 — 用服务器时间覆盖客户端时间戳（手机时钟可能不准）
    report.meta.clientTime = report.meta.timestamp;  // 保留原始客户端时间供诊断
    report.meta.timestamp = now;
    report.meta.lastSeen = now;
    report.meta.dupCount = 1;

    var res = await db.collection('bug_reports').add({ data: report });
    return { code: 0, msg: 'created', id: res._id };
  } catch (err) {
    console.error('[reportBug] 写入失败:', err);
    return { code: -1, msg: err.message || 'unknown error' };
  }
};
