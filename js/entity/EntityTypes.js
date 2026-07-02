// EntityTypes — 精灵类型定义与查询
// 每个精灵 = { type, skinId } 组合，运行时通过 entityProps() 获取属性
// 帧数由 skin.json 驱动，不写死在此处

var ENTITY = {
  PIG: 'pig',
  ROCK: 'rock',
};

// props(key) = { skinId, draggable, canEscape, minLength }
// key = "{type}_{skinId}"，例如 "pig_0"、"rock_0"
var ENTITY_PROPS = {
  pig_0: { skinId: 0, draggable: true, canEscape: true, minLength: 70 },
  rock:   { skinId: -1, draggable: false, canEscape: false, minLength: 50 },
};

/** 根据精灵对象获取属性 */
function entityProps(sprite) {
  if (!sprite) return ENTITY_PROPS['pig_0'];
  var type = sprite.type || 'pig';
  if (type === 'rock') return ENTITY_PROPS['rock'];  // rock 无皮肤
  var skinId = (sprite.skinId != null) ? sprite.skinId : 0;
  var key = type + '_' + skinId;
  return ENTITY_PROPS[key] || ENTITY_PROPS['pig_0'];
}

/** 根据 type+skinId 获取属性 */
function entityPropsByKey(type, skinId) {
  if (type === 'rock') return ENTITY_PROPS['rock'];
  var key = (type || 'pig') + '_' + (skinId || 0);
  return ENTITY_PROPS[key] || ENTITY_PROPS['pig_0'];
}

/** 返回精灵的完整 key（如 "pig_0" 或 "rock"） */
function entityKey(sprite) {
  var type = sprite.type || 'pig';
  if (type === 'rock') return 'rock';
  return type + '_' + (sprite.skinId || 0);
}

// ---- 编辑器标签 ----
var ENTITY_LABELS = {
  pig: '猪',
  rock: '石头',
};

function entityLabel(type) {
  return ENTITY_LABELS[type] || type;
}

// ---- 预设长度值（编辑器顶部按钮） ----
var PRESET_LENGTHS = {
  pig: [70, 125, 205, 275, 370],
  rock: [44],  // rock 只占 1 孔，长度=孔直径
};  

module.exports = {
  ENTITY: ENTITY,
  ENTITY_PROPS: ENTITY_PROPS,
  entityProps: entityProps,
  entityPropsByKey: entityPropsByKey,
  entityKey: entityKey,
  entityLabel: entityLabel,
  PRESET_LENGTHS: PRESET_LENGTHS,
};
