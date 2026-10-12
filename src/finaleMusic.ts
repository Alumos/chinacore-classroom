// Original ceremonial fanfare, synthesized locally: brass, strings and marching percussion.
// Render once, then play one buffer against the same timestamp as the visual finale.
const duration = 16.5
let score: Promise<AudioBuffer> | undefined
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

function renderScore(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * duration), 44100)
  const mix = ctx.createGain(), compressor = ctx.createDynamicsCompressor()
  mix.gain.value = 0.7
  compressor.threshold.value = -18; compressor.knee.value = 12; compressor.ratio.value = 4
  compressor.attack.value = 0.006; compressor.release.value = 0.2
  mix.connect(compressor).connect(ctx.destination)
  const hall = ctx.createConvolver(), wet = ctx.createGain()
  const impulse = ctx.createBuffer(2, 44100 * 2, 44100)
  let seed = 731
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1 }
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < data.length; i++) data[i] = random() * Math.exp(-i / 15000) * 0.45
  }
  hall.buffer = impulse; wet.gain.value = 0.22
  hall.connect(wet).connect(mix)
  const noise = ctx.createBuffer(1, 44100 * 2, 44100)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = random()

  function envelope(at: number, length: number, volume: number, attack: number, release: number, pan: number) {
    const gain = ctx.createGain(), stereo = ctx.createStereoPanner()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + attack)
    gain.gain.setValueAtTime(volume * 0.8, at + Math.max(attack, length - release))
    gain.gain.linearRampToValueAtTime(0, at + length)
    stereo.pan.value = pan
    gain.connect(stereo); stereo.connect(mix); stereo.connect(hall)
    return gain
  }
  const brassWave = ctx.createPeriodicWave(new Float32Array(10), new Float32Array([0, 1, .68, .48, .33, .24, .16, .1, .06, .03]))
  function brass(note: number, at: number, length: number, volume: number, low = false) {
    const gain = envelope(at, length, volume, low ? .08 : .035, Math.min(.18, length / 3), low ? .12 : -.12)
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = .6
    filter.frequency.setValueAtTime(low ? 450 : 1100, at)
    filter.frequency.linearRampToValueAtTime(low ? 850 : 4200, at + .08)
    filter.frequency.linearRampToValueAtTime(low ? 500 : 2100, at + length)
    filter.connect(gain)
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator(); osc.setPeriodicWave(brassWave)
      osc.frequency.setValueAtTime(hz(note) * .99, at); osc.frequency.exponentialRampToValueAtTime(hz(note), at + .04)
      osc.detune.value = detune; osc.connect(filter); osc.start(at); osc.stop(at + length)
    }
  }
  function strings(notes: number[], at: number, length: number, volume: number) {
    notes.forEach((note, index) => {
      const gain = envelope(at, length, volume, Math.min(.25, length / 3), Math.min(.45, length / 3), (index % 2 ? 1 : -1) * .6)
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2300; filter.connect(gain)
      for (const cents of [-9, 0, 9]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = hz(note); osc.detune.value = cents
        osc.connect(filter); osc.start(at); osc.stop(at + length)
      }
    })
  }
  function drum(at: number, volume: number, timpani = false, pitch = 65.4) {
    const gain = envelope(at, timpani ? .9 : .65, volume, .006, timpani ? .85 : .6, timpani ? -.25 : 0)
    const osc = ctx.createOscillator(); osc.type = 'sine'
    osc.frequency.setValueAtTime(timpani ? pitch * 1.25 : 135, at)
    osc.frequency.exponentialRampToValueAtTime(timpani ? pitch : 38, at + .12)
    osc.connect(gain); osc.start(at); osc.stop(at + 1)
  }
  function hiss(at: number, length: number, volume: number, cymbal = false) {
    const gain = envelope(at, length, volume, .004, length - .01, cymbal ? .4 : -.3)
    const filter = ctx.createBiquadFilter(); filter.type = cymbal ? 'highpass' : 'bandpass'; filter.frequency.value = cymbal ? 6500 : 2100; filter.Q.value = .7
    const source = ctx.createBufferSource(); source.buffer = noise
    source.connect(filter).connect(gain); source.start(at); source.stop(at + length)
    if (!cymbal) {
      const body = ctx.createOscillator(); body.type = 'triangle'; body.frequency.value = 185
      const bodyGain = envelope(at, .12, volume * .4, .003, .1, -.3)
      body.connect(bodyGain); body.start(at); body.stop(at + .12)
    }
  }
  // 120 BPM: rising fanfare over C–Am–F–G, triumphant C at 10s as the title forms.
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50], [43, 47, 50], [48, 52, 55]]
  for (let bar = 0; bar < 6; bar++) {
    const at = bar * 2, chord = chords[bar], intensity = .65 + bar * .07
    strings(chord.map(n => n + 12), at, 2.25, .012 * intensity)
    brass(chord[0] - 12, at, 1.8, .08 * intensity, true)
    chord.forEach(n => brass(n, at, bar >= 4 ? 1.8 : .8, .022 * intensity, true))
    drum(at, .46 * intensity); drum(at + 1, .3 * intensity)
    hiss(at + .5, .16, .15 * intensity); hiss(at + 1.5, .18, .2 * intensity)
    if (bar >= 2) {
      for (let beat = 0; beat < 4; beat++) {
        strings([chord[beat % 3] + 24], at + beat * .5, .35, .023)
        drum(at + beat * .5, .12, true, hz(chord[0]))
      }
    }
    if (bar === 0 || bar === 2 || bar === 5) hiss(at, 1.8, .2, true)
  }
  const melody: [number, number, number][] = [
    [0, 67, .7], [.75, 67, .2], [1, 72, .85], [2, 72, .7], [2.75, 74, .2], [3, 76, .85],
    [4, 77, .7], [4.75, 76, .2], [5, 72, .85], [6, 74, .7], [6.75, 76, .2], [7, 79, .85],
    [8, 74, .4], [8.5, 76, .4], [9, 79, .4], [9.5, 83, .4], [10, 84, 1.8],
    [12, 79, .4], [12.5, 76, .4], [13, 84, 2.2],
  ]
  for (const [at, note, length] of melody) {
    brass(note, at, length, at >= 10 ? .11 : .075)
    if (at >= 4) brass(note - 12, at, length, .033)
  }
  // Snare roll and timpani crescendo lead into the title reveal.
  for (let i = 0; i < 16; i++) hiss(8 + i * .125, .1, .07 + i * .006)
  for (let i = 0; i < 8; i++) drum(9 + i * .125, .08 + i * .025, true)
  strings([48, 55, 60, 64, 67], 12, 3.5, .016)
  ;[36, 48, 52, 55].forEach(n => brass(n, 13, 2.1, .035, true))
  drum(13, .5); hiss(13, 2, .24, true)
  mix.gain.setValueAtTime(.7, 14); mix.gain.linearRampToValueAtTime(0, 16.3)
  return ctx.startRendering()
}

export class FinaleMusic {
  context: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private generation = 0
  private finale = 0
  prepare() { score ??= renderScore(); return score }
  async unlock() {
    const ctx = this.context ??= new AudioContext()
    await ctx.resume()
    if (ctx !== this.context || ctx.state !== 'running') throw new Error('Audio unavailable')
  }
  async start(finaleAt: number) {
    if (this.finale === finaleAt) return
    this.stop()
    const ctx = this.context
    if (!ctx || ctx.state !== 'running' || !finaleAt) return
    this.finale = finaleAt
    const generation = this.generation
    try {
      const buffer = await this.prepare()
      if (generation !== this.generation || ctx !== this.context) return
      const offset = Math.max(0, (Date.now() - finaleAt) / 1000)
      if (offset >= buffer.duration) return
      const source = ctx.createBufferSource(), gain = ctx.createGain()
      source.buffer = buffer; source.connect(gain).connect(ctx.destination)
      gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(.8, ctx.currentTime + .06)
      this.source = source; this.gain = gain
      source.onended = () => { source.disconnect(); gain.disconnect(); if (this.source === source) { this.source = null; this.gain = null } }
      source.start(0, offset)
    } catch (error) { if (generation === this.generation) this.finale = 0; throw error }
  }
  stop() {
    this.generation++; this.finale = 0
    if (this.source && this.context && this.gain) {
      const now = this.context.currentTime
      this.gain.gain.cancelScheduledValues(now); this.gain.gain.setTargetAtTime(0, now, .025)
      this.source.stop(now + .12)
    }
    this.source = null; this.gain = null
  }
  dispose() {
    this.stop()
    if (this.context) void this.context.close()
    this.context = null
  }
}
