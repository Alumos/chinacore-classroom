export function stageLayout(width: number, height: number, safeTop = 0, safeBottom = 0) {
  const fontSize = Math.max(28, Math.min(104, width / 40, height / 12))
  const bubbleHeight = Math.ceil(fontSize * 1.85)
  const top = Math.max(68, height * .13, safeTop)
  const bottom = Math.max(96, height * .14, safeBottom)
  const availableHeight = Math.max(bubbleHeight, height - top - bottom)
  const rows = Math.max(1, Math.min(7, Math.floor(availableHeight / (bubbleHeight + fontSize * .65))))
  return {
    fontSize, bubbleHeight, rows,
    rowY: (row: number) => top + (row + .5) * availableHeight / rows,
    speed: Math.max(80, width / 13), gap: Math.max(48, fontSize * 2.5),
    padding: fontSize * 3.2,
    titleSize: Math.min(width / 7.5, height / 3.3),
    subtitleSize: Math.max(14, Math.min(56, width / 55)),
    particleScale: Math.max(1, Math.min(3, width / 1280)),
  }
}

// Use actual positions rather than wall-clock deadlines: dropped frames, long
// messages and background tabs cannot release a lane before its tail has passed.
export function freeLane(bullets: { row: number; x: number; width: number }[], rows: number, width: number, gap: number, next: number) {
  for (let i = 0; i < rows; i++) {
    const row = (next + i) % rows
    if (bullets.every(b => b.row !== row || b.x + b.width + gap <= width + 20)) return row
  }
  return -1
}
