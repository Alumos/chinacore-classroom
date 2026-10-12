import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Sparkles, WandSparkles, Volume2, VolumeX } from 'lucide-react'
import type { Message } from './lib'
import { FinaleMusic } from './finaleMusic'
import { stageLayout, freeLane } from './stageLayout'
import { bulletSticker, stickerNames, fieldEmoji } from './bulletArt'

const themes = [{ fill: '#a71930', border: '#edbd70', ink: '#fff5d9' }, { fill: '#fff5df', border: '#efc477', ink: '#8b1830' }, { fill: '#7d1830', border: '#e5a85f', ink: '#ffe8b5' }, { fill: '#fff9ed', border: '#d9b56d', ink: '#852c3f' }, { fill: '#b33226', border: '#ffcd80', ink: '#fff7df' }, { fill: '#662239', border: '#efc67b', ink: '#ffe5ac' }, { fill: '#ffe5dc', border: '#eaa58e', ink: '#912640' }, { fill: '#f8eed3', border: '#dec382', ink: '#70402e' }]
type Bullet = { id: number; text: string; theme: number; x: number; y: number; width: number; row: number; alpha: number }
type Particle = { x: number; y: number; sx: number; sy: number; tx: number; ty: number; size: number; phase: number; glow: HTMLCanvasElement[] }

export default function Stage({ messages, finaleAt, full, toggleFull, demo, previewing, togglePreview }: { messages: Message[]; finaleAt: number; full: boolean; toggleFull: () => void; demo: boolean; previewing: boolean; togglePreview: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const music = useRef(new FinaleMusic())
  const [soundOn, setSoundOn] = useState(true)
  const [soundError, setSoundError] = useState('')
  const enabled = useRef(true)
  const [audioReady, setAudioReady] = useState(false)
  async function activateAudio() {
    if (!enabled.current) return
    try {
      await music.current.unlock()
      if (!enabled.current) return
      setAudioReady(true); setSoundError('')
      if (current.current.finaleAt) await music.current.start(current.current.finaleAt)
    } catch { if (enabled.current) setSoundError('点击页面启用配乐') }
  }
  function toggleSound() {
    enabled.current = !enabled.current
    setSoundOn(enabled.current)
    if (enabled.current) void activateAudio()
    else { music.current.stop(); setSoundError('') }
  }
  const current = useRef({ messages, finaleAt })
  current.current = { messages, finaleAt }
  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!
    const stickers = stickerNames.map((_, i) => bulletSticker(i))
    let dpr = 1, width = 0, height = 0, frame = 0, lastTime = 0, lastSpawn = 0, cursor = 0, previousFinale = 0
    let bullets: Bullet[] = [], particles: Particle[] = [], seen = new Set<number>(), queue: Message[] = []
    let previousMessages: Message[] | null = null
    let titleLayer: HTMLCanvasElement | null = null
    // Cache the expensive blur, retaining each particle's exact radius and both blur levels.
    const particleSizes = Array.from({ length: 1800 }, () => .6 + Math.random() * 1.3)
    let warmupTimer: ReturnType<typeof setTimeout> | undefined
    function warmGlows(index = 0) {
      for (let i = index; i < Math.min(index + 24, particleSizes.length); i++) particleGlow(particleSizes[i])
      if (index + 24 < particleSizes.length) warmupTimer = setTimeout(() => warmGlows(index + 24), 16)
    }
    const glowCache = new Map<number, HTMLCanvasElement[]>()
    function particleGlow(size: number) {
      let images = glowCache.get(size)
      if (images) return images
      images = [10, 6].map(blur => {
        const tile = document.createElement('canvas')
        tile.width = tile.height = Math.ceil(40 * dpr)
        const g = tile.getContext('2d')!
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        // Move the source out of the tile; only its original Canvas shadow remains.
        g.shadowColor = '#edc678'; g.shadowBlur = blur; g.shadowOffsetX = 128 * dpr
        g.fillStyle = '#fff'; g.beginPath(); g.arc(20 - 128, 20, size, 0, Math.PI * 2); g.fill()
        return tile
      })
      glowCache.set(size, images)
      return images
    }
    let layout = stageLayout(1000, 560), nextRow = 0, safeTop = 0, safeBottom = 0
    let stars: { x: number; y: number; r: number; phase: number }[] = []
    function resize() {
      const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return
      const topRect = canvas.parentElement?.querySelector('.stage-top')?.getBoundingClientRect()
      const bottomRect = canvas.parentElement?.querySelector('.stage-bottom')?.getBoundingClientRect()
      const nextTop = topRect ? Math.max(0, topRect.bottom - rect.top + 24) : 0
      const nextBottom = bottomRect ? Math.max(0, rect.bottom - bottomRect.top + 24) : 0
      if (width === rect.width && height === rect.height && safeTop === nextTop && safeBottom === nextBottom) return
      safeTop = nextTop; safeBottom = nextBottom
      width = rect.width; height = rect.height
      layout = stageLayout(width, height, safeTop, safeBottom)
      // Font metrics and lane positions change on entering/leaving fullscreen.
      bullets = []; nextRow = 0; lastSpawn = 0
      dpr = Math.min(window.devicePixelRatio || 1, 1.75); glowCache.clear(); titleLayer = null; clearTimeout(warmupTimer); warmupTimer = setTimeout(() => warmGlows(), 0); canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = Array.from({ length: Math.min(130, Math.round(width / 6)) }, () => ({ x: Math.random() * width, y: Math.random() * height, r: Math.random() * 1.2 + .3, phase: Math.random() * 6.28 }))
      if (current.current.finaleAt) prepareFinale()
    }
    function prepareFinale() {
      const target = document.createElement('canvas'); target.width = Math.round(width); target.height = Math.round(height)
      const tc = target.getContext('2d')!; const font = layout.titleSize
      tc.font = `700 ${font}px "Microsoft YaHei", sans-serif`; tc.textAlign = 'center'; tc.textBaseline = 'middle'; tc.fillStyle = 'white'; tc.fillText('中国芯·强国梦', width / 2, height * .48)
      const pixels = tc.getImageData(0, 0, target.width, target.height).data
      const targets: { x: number; y: number }[] = []; const step = Math.max(3, Math.round(width / 330))
      for (let y = Math.floor(height * .25); y < height * .7; y += step) for (let x = 0; x < width; x += step) if (pixels[(y * target.width + x) * 4 + 3] > 100) targets.push({ x, y })
      const shuffled = targets.sort(() => Math.random() - .5).slice(0, 1800)
      // Seeds follow the positions of actual visible comments before turning into light.
      const anchors = bullets.length ? bullets : Array.from({ length: 12 }, (_, i) => ({ x: Math.random() * width, y: layout.rowY(i % layout.rows), width: 180 }))
      particles = shuffled.map((p, i) => { const anchor = anchors[i % anchors.length]; const sx = Math.max(0, Math.min(width, anchor.x + Math.random() * anchor.width)); const sy = anchor.y + (Math.random() - .5) * 15; return { x: sx, y: sy, sx, sy, tx: p.x, ty: p.y, size: particleSizes[i], glow: [], phase: Math.random() * Math.PI * 2 } })
      for (const particle of particles) particle.glow = particleGlow(particle.size)
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas)
    canvas.parentElement?.querySelectorAll('.stage-top, .stage-bottom').forEach(element => observer.observe(element))
    function draw(now: number) {
      frame = requestAnimationFrame(draw)
      const delta = lastTime ? Math.min((now - lastTime) / 1000, .06) : 0; lastTime = now
      ctx.clearRect(0, 0, width, height)
      for (const star of stars) { ctx.globalAlpha = .2 + .3 * (Math.sin(now / 2100 + star.phase) + 1) / 2; ctx.fillStyle = '#f5d49b'; ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill() }
      ctx.globalAlpha = 1
      const { messages: currentMessages, finaleAt: start } = current.current
      if (currentMessages !== previousMessages) {
        previousMessages = currentMessages
        const ids = new Set(currentMessages.map(m => m.id))
        bullets = bullets.filter(b => ids.has(b.id)); queue = queue.filter(m => ids.has(m.id))
        for (const m of currentMessages) if (!seen.has(m.id)) { seen.add(m.id); queue.push(m) }
        seen = ids
      }
      // New live comments take priority over the repeating history.
      if (!start && now - lastSpawn > 950 && currentMessages.length) {
        const fontSize = layout.fontSize; ctx.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`
        const row = freeLane(bullets, layout.rows, width, layout.gap, nextRow)
        if (row >= 0) { const m = queue.shift() || currentMessages[cursor++ % currentMessages.length]; const text = `${fieldEmoji[m.category] || fieldEmoji['其他']}  ${m.content}`; const textWidth = ctx.measureText(text).width + layout.padding; nextRow = (row + 1) % layout.rows; bullets.push({ id: m.id, text, theme: Math.abs(m.id) % themes.length, x: width + 20, y: layout.rowY(row), width: textWidth, row, alpha: 1 }); lastSpawn = now }
      }
      if (start !== previousFinale) { previousFinale = start; if (start) { prepareFinale() } else { particles = []; bullets = []; nextRow = 0 } }
      const elapsed = start ? Math.max(0, (Date.now() - start) / 1000) : 0
      ctx.font = `600 ${layout.fontSize}px "Microsoft YaHei", sans-serif`; ctx.textBaseline = 'middle'
      for (const b of bullets) {
        if (start && elapsed >= 2.7) break
        b.x -= layout.speed * delta; ctx.globalAlpha = start ? Math.max(0, 1 - elapsed / 2.7) : .94
        const bw = b.width, bh = layout.bubbleHeight, top = b.y - bh / 2
        const theme = themes[b.theme], stickerSize = bh - 8
        ctx.fillStyle = theme.fill; ctx.strokeStyle = theme.border; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.roundRect(b.x, top, bw, bh, bh / 2); ctx.fill(); ctx.stroke()
        ctx.drawImage(stickers[b.theme], b.x + 4, top + 4, stickerSize, stickerSize)
        ctx.fillStyle = theme.ink; ctx.fillText(b.text, b.x + bh + layout.fontSize * .25, b.y)
      }
      bullets = bullets.filter(b => b.x + b.width > -20); ctx.globalAlpha = 1
      if (start) {
        const rise = Math.min(1, elapsed / 4.5), gather = Math.max(0, Math.min(1, (elapsed - 4.5) / 5.5)), eased = gather * gather * (3 - 2 * gather)
        for (const p of particles) {
          const ax = p.sx + Math.sin(p.phase + elapsed * .5) * 45 * rise, ay = p.sy - height * .28 * rise
          p.x = ax + (p.tx - ax) * eased; p.y = ay + (p.ty - ay) * eased
          const alpha = Math.min(1, elapsed / 1.2) * (elapsed > 11 ? Math.max(.25, 1 - (elapsed - 11) / 4) : 1)
          ctx.globalAlpha = alpha; ctx.fillStyle = `hsl(${39 + Math.sin(p.phase) * 7} 85% ${66 + Math.sin(now / 500 + p.phase) * 13}%)`; ctx.drawImage(p.glow[gather > .7 ? 1 : 0], p.x - 20 * layout.particleScale, p.y - 20 * layout.particleScale, 40 * layout.particleScale, 40 * layout.particleScale); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * layout.particleScale, 0, Math.PI * 2); ctx.fill()
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = Math.max(0, Math.min(1, (elapsed - 9.5) / 3.5))
        if (ctx.globalAlpha > 0) {
          if (!titleLayer) {
            titleLayer = document.createElement('canvas'); titleLayer.width = canvas.width; titleLayer.height = canvas.height
            const tc = titleLayer.getContext('2d')!; tc.setTransform(dpr, 0, 0, dpr, 0, 0)
        const font = layout.titleSize; tc.font = `700 ${font}px "Microsoft YaHei", sans-serif`; tc.textAlign = 'center'; tc.textBaseline = 'middle'
        const gold = tc.createLinearGradient(0, height * .35, 0, height * .62); gold.addColorStop(0, '#fff2c6'); gold.addColorStop(.45, '#f7d899'); gold.addColorStop(.7, '#bd863d'); gold.addColorStop(1, '#f8d798'); tc.fillStyle = gold; tc.shadowColor = '#d7a654'; tc.shadowBlur = 24; tc.fillText('中国芯·强国梦', width / 2, height * .48); tc.shadowBlur = 0
        tc.font = `400 ${layout.subtitleSize}px "Microsoft YaHei", sans-serif`; tc.fillStyle = '#cbbf9d'; tc.fillText('以青春之名，赴自主创新之约', width / 2, height * .67); tc.textAlign = 'left'
          }
          ctx.drawImage(titleLayer, 0, 0, width, height)
        }
        ctx.globalAlpha = 1
      }
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); clearTimeout(warmupTimer); glowCache.clear(); observer.disconnect() }
  }, [])
  useEffect(() => {
    if (soundOn && finaleAt) void music.current.start(finaleAt).catch(() => setSoundError('配乐加载失败，请关闭后重试'))
    else music.current.stop()
    return () => music.current.stop()
  }, [soundOn, finaleAt])
  useEffect(() => {
    const player = music.current
    void player.prepare().catch(() => setSoundError('配乐加载失败，请刷新重试'))
    // Gesture listeners unlock remote teacher-triggered playback on the projection device.
    const activate = () => { void activateAudio() }
    document.addEventListener('click', activate)
    document.addEventListener('keydown', activate)
    return () => {
      document.removeEventListener('click', activate)
      document.removeEventListener('keydown', activate)
      player.dispose()
    }
  }, [])
  return <div className={`stage ${finaleAt ? 'stage-finale' : ''} ${full ? 'stage-full' : ''}`}>
    <div className="stage-grid" />
    <div className="stage-orbit orbit-one" /><div className="stage-orbit orbit-two" /><div className="stage-orbit orbit-three" />
    <div className="chip-art" aria-hidden="true"><div className="chip-pins horizontal" /><div className="chip-pins vertical" /><div className="chip-core"><span>中国芯</span><small>CHINA · CORE</small><div className="chip-light" /></div></div>
    <div className="stage-top"><span><i className="live-dot" /> {demo ? '演示预览 · 示例弹幕' : '灵感星海 · 实时弹幕'}</span><span className="stage-caption">每一个想法，都有改变未来的力量</span></div>
    <canvas ref={canvasRef} aria-label={finaleAt ? '弹幕光点飞升，汇聚成鎏金大字：中国芯·强国梦' : '实时班级弹幕画布'} />
    {!messages.length && !finaleAt && <div className="stage-empty"><Sparkles size={18} /><span>等待第一束灵感，点亮这片星海</span></div>}
    <div className="stage-bottom"><span>{finaleAt ? '青春的答案，汇成中国的力量' : '自主创新的未来，从你的一个想法开始'}</span><div className="stage-bottom-actions"><button className="stage-preview" onClick={togglePreview} aria-pressed={previewing}><WandSparkles size={20} /><span>{previewing ? '返回互动' : '收束预览'}</span></button>{soundError && <span role="status">{soundError}</span>}<button className="icon-button" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? '关闭收束音乐' : '开启收束音乐'} title={soundOn ? '关闭收束音乐' : '开启收束音乐'}>{soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}<span>{soundOn ? (audioReady ? '配乐已开启' : '配乐已开启 · 点击页面激活') : '开启配乐'}</span></button><button className="icon-button" onClick={toggleFull} aria-label={full ? '退出全屏' : '大屏全屏'}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button></div></div>
  </div>
}
