// Small vector stickers are rasterized once, then reused by every animation frame.
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, angle = -Math.PI / 2) {
  c.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = angle + i * Math.PI / 5, radius = i % 2 ? r * .382 : r
    const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius
    if (i) c.lineTo(px, py); else c.moveTo(px, py)
  }
  c.closePath(); c.fill()
}
function flag(c: CanvasRenderingContext2D) {
  c.fillStyle = '#ee2433'; c.fillRect(7, 15, 51, 34)
  c.fillStyle = '#ffdf55'; star(c, 15.5, 23.5, 5.1)
  for (const [x, y] of [[24, 18.4], [27.4, 21.8], [27.4, 26.9], [24, 30.3]]) star(c, x, y, 1.7, Math.atan2(23.5 - y, 15.5 - x))
}
function shape(c: CanvasRenderingContext2D, points: number[][], color: string) {
  c.fillStyle = color; c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill()
}
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  c.fillStyle = color; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill()
}
export const stickerNames = ['五星红旗', '红领巾少年', '中国航天员', '国宝熊猫', '逐梦火箭', '中国芯', '红领巾女孩', '和平白鸽']
export function bulletSticker(kind: number) {
  const tile = document.createElement('canvas'); tile.width = tile.height = 192
  const c = tile.getContext('2d')!; c.scale(3, 3)
  c.fillStyle = '#fff6dc'; c.beginPath(); c.arc(32, 32, 31, 0, Math.PI * 2); c.fill()
  if (kind === 0) { flag(c); return tile }
  if (kind === 3) {
    disc(c,17,16,9,'#282b36'); disc(c,47,16,9,'#282b36'); disc(c,32,32,23,'#fff');
    for (const x of [22,42]) { c.fillStyle='#282b36'; c.beginPath(); c.ellipse(x,30,7,9,x<32?.4:-.4,0,Math.PI*2); c.fill(); disc(c,x,28,2,'#fff') }
    disc(c,32,39,3,'#282b36');
    shape(c,[[17,50],[32,54],[47,50],[35,61],[29,57],[24,63]],'#db263b'); return tile
  }
  if (kind === 4) {
    shape(c,[[24,43],[32,63],[40,43]],'#f39b32'); shape(c,[[28,45],[32,57],[36,45]],'#ffe198');
    shape(c,[[23,28],[12,47],[24,43],[40,43],[52,47],[41,28]],'#ce233b');
    c.fillStyle='#fff'; c.beginPath(); c.moveTo(23,45); c.quadraticCurveTo(17,19,32,5); c.quadraticCurveTo(47,19,41,45); c.closePath(); c.fill();
    shape(c,[[25,14],[32,5],[39,14]],'#db263b'); disc(c,32,26,7,'#5280a1'); disc(c,30,24,3,'#cbeeff');
    c.fillStyle='#d9283b'; star(c,32,39,5); return tile
  }
  if (kind === 5) {
    c.strokeStyle='#bd842e'; c.lineWidth=3;
    for(let n=17;n<=47;n+=10){ c.beginPath();c.moveTo(n,6);c.lineTo(n,58);c.moveTo(6,n);c.lineTo(58,n);c.stroke() }
    c.fillStyle='#c9233b';c.fillRect(12,12,40,40); c.strokeStyle='#ffe1a0';c.strokeRect(16,16,32,32);
    c.fillStyle='#ffe1a0';star(c,32,25,7);c.font='bold 12px sans-serif';c.textAlign='center';c.fillText('中国芯',32,45);return tile
  }
  if (kind === 7) {
    shape(c,[[11,39],[3,28],[19,31],[22,15],[33,30],[45,20],[57,21],[49,29],[45,41],[31,48],[16,48]],'#fff');
    c.strokeStyle='#d8c6a0';c.lineWidth=1.5;c.stroke();disc(c,48,24,1.5,'#443443');
    shape(c,[[55,24],[63,27],[54,28]],'#dd9e3b');
    c.strokeStyle='#638451';c.lineWidth=2;c.beginPath();c.moveTo(53,29);c.lineTo(58,43);c.stroke();
    shape(c,[[56,36],[49,33],[53,40]],'#789b59');shape(c,[[57,36],[63,32],[60,40]],'#789b59');
    c.fillStyle='#d52b3b';star(c,25,53,6);return tile
  }
  if(kind===6){disc(c,9,36,9,'#33292b');disc(c,55,36,9,'#33292b');disc(c,10,29,4,'#df2b42');disc(c,54,29,4,'#df2b42')}

  const astronaut = kind === 2
  c.fillStyle = astronaut ? '#d7e6ed' : '#21354c'; c.beginPath(); c.ellipse(32, 58, 21, 19, 0, 0, Math.PI * 2); c.fill()
  c.fillStyle = astronaut ? '#fff' : '#33292b'; c.beginPath(); c.ellipse(32, 27, astronaut ? 25 : 22, 25, 0, 0, Math.PI * 2); c.fill()
  if (astronaut) { c.strokeStyle = '#aec5d2'; c.lineWidth = 3; c.stroke() }
  c.fillStyle = '#ffdab7'; c.beginPath(); c.ellipse(32, 30, 18, 18, 0, 0, Math.PI * 2); c.fill()
  if (!astronaut) { c.fillStyle = '#33292b'; c.beginPath(); c.moveTo(13, 24); c.quadraticCurveTo(12, 4, 33, 8); c.quadraticCurveTo(53, 9, 50, 27); c.lineTo(40, 18); c.lineTo(34, 24); c.lineTo(26, 19); c.closePath(); c.fill() }
  c.fillStyle = '#3b2830'
  for (const x of [25, 39]) { c.beginPath(); c.ellipse(x, 30, 1.7, 2.3, 0, 0, Math.PI * 2); c.fill() }
  c.fillStyle = '#f49b8b'
  for (const x of [20, 44]) { c.beginPath(); c.ellipse(x, 36, 4, 2, 0, 0, Math.PI * 2); c.fill() }
  c.strokeStyle = '#9b4b43'; c.lineWidth = 1.5; c.beginPath(); c.arc(32, 34, 5, .2, Math.PI - .2); c.stroke()
  c.fillStyle = '#dc2639'; c.beginPath(); c.moveTo(20, 47); c.lineTo(32, 52); c.lineTo(44, 47); c.lineTo(34, 58); c.lineTo(30, 64); c.lineTo(27, 54); c.closePath(); c.fill()
  if (astronaut) { c.fillStyle = '#e12e3b'; c.fillRect(40, 51, 12, 8); c.fillStyle = '#ffdd58'; star(c, 44, 54, 2) }
  return tile
}
