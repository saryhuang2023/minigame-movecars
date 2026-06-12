// 颜色常量定义

const COLORS = {
  red:    { hex: '#FF6B6B', name: '红', rgb: [255, 107, 107] },
  blue:   { hex: '#4ECDC4', name: '蓝', rgb: [ 78, 205, 196] },
  green:  { hex: '#51CF66', name: '绿', rgb: [ 81, 207, 102] },
  yellow: { hex: '#FFD43B', name: '黄', rgb: [255, 212,  59] },
};

const COLOR_LIST = Object.keys(COLORS); // ['red', 'blue', 'green', 'yellow']

function getColorHex(colorKey) {
  return (COLORS[colorKey] || COLORS.red).hex;
}

function getColorName(colorKey) {
  return (COLORS[colorKey] || COLORS.red).name;
}

module.exports = { COLORS, COLOR_LIST, getColorHex, getColorName };
