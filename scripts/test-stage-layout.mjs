import ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const context = { exports: {} }
vm.runInNewContext(ts.transpile(fs.readFileSync(new URL('../src/stageLayout.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS }), context)
const { stageLayout, freeLane } = context.exports
for (const [width, height, top, bottom] of [[360, 360, 58, 95], [1000, 560, 70, 110], [1920, 1080, 100, 140], [3840, 2160, 140, 220], [844, 390, 60, 110]]) {
  const layout = stageLayout(width, height, top, bottom)
  for (let row = 0; row < layout.rows; row++) {
    assert.ok(layout.rowY(row) - layout.bubbleHeight / 2 >= top, 'top controls must not cover bubbles')
    assert.ok(layout.rowY(row) + layout.bubbleHeight / 2 <= height - bottom, 'bottom bubbles must remain fully visible')
    if (row) assert.ok(layout.rowY(row) - layout.rowY(row - 1) > layout.bubbleHeight, 'lanes must not overlap')
  }
  let bullets = [], next = 0
  for (let frame = 0; frame < 12000; frame++) {
    // Includes stalls: admission must follow visible positions, not elapsed wall time.
    const delta = frame % 120 === 0 ? 0 : 1 / 60
    for (const b of bullets) b.x -= layout.speed * delta
    bullets = bullets.filter(b => b.x + b.width > 0)
    if (frame % 12 === 0) {
      const row = freeLane(bullets, layout.rows, width, layout.gap, next)
      if (row >= 0) {
        bullets.push({ row, x: width + 20, width: (frame % 3 ? 8 : 80) * layout.fontSize + layout.padding })
        next = (row + 1) % layout.rows
      }
    }
    for (let row = 0; row < layout.rows; row++) {
      const lane = bullets.filter(b => b.row === row).sort((a, b) => a.x - b.x)
      for (let i = 1; i < lane.length; i++) assert.ok(lane[i].x - lane[i - 1].x - lane[i - 1].width >= layout.gap - .001)
    }
  }
  console.log(`${width}×${height}: ${layout.fontSize}px, ${layout.rows} lanes; no collisions or vertical clipping`)
}
