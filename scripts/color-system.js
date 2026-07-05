/* ================= color system ================= */
// bitmask: R=1, G=2, B=4
const COLORS = [
  {bits:1, name:'赤', hex:'#ff5a5a'},
  {bits:2, name:'緑', hex:'#5affa0'},
  {bits:4, name:'青', hex:'#5aa8ff'},
  {bits:3, name:'黄', hex:'#ffe75a'},
  {bits:5, name:'紫', hex:'#ff5ae0'},
  {bits:6, name:'水', hex:'#5afff0'},
  {bits:7, name:'白', hex:'#f5f7fa'},
];
const COLOR_HEX = {};
COLORS.forEach(c => COLOR_HEX[c.bits] = c.hex);
