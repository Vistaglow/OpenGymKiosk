// The voice coach's mouth. Lines come from phonon through the kiosk server (/k/tts) and play
// through Web Audio, which starts at once once a clip is decoded. When the server cannot speak
// (the Mac asleep, Ollama stopped) the line goes to the iPad's own voice instead, so counting
// never goes quiet. iOS lets a page make sound only after a tap: unlockAudio() is called from
// the tap on a profile.

let ctx = null
let muted = false
let gen = 0          // bumped by every interrupt: queued lines from before it are dropped
let queue = Promise.resolve()
let playing = null   // the AudioBufferSourceNode playing, or 'synth'

const MAX_CLIPS = 200
const clips = new Map() // `${voice}\n${text}` -> Promise<AudioBuffer>

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = ctx.createBuffer(1, 1, 22050)
    src.connect(ctx.destination)
    src.start(0)
  } catch { /* no Web Audio: the iPad's voice still works */ }
  try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(' ')) } catch { /* no speech either */ }
}

export function setMuted(on) {
  muted = on
  if (on) stop()
}
export const isMuted = () => muted

const ttsUrl = (voice, text) => `/k/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`
const decode = ab => new Promise((resolve, reject) => ctx.decodeAudioData(ab, resolve, reject))

function load(voice, text) {
  const key = `${voice}\n${text}`
  let p = clips.get(key)
  if (!p) {
    // Older Safari sent no cookies with fetch unless asked, and /k/tts needs the device cookie.
    p = fetch(ttsUrl(voice, text), { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('speech ' + r.status); return r.arrayBuffer() })
      .then(decode)
    p.catch(() => clips.delete(key))
    clips.set(key, p)
    if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value)
  }
  return p
}

const within = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

/** Have these lines ready before they are needed, one at a time so phonon is not flooded. */
export function prewarm(voice, lines) {
  if (!ctx) return Promise.resolve()
  return lines.reduce((chain, text) => chain.then(() => load(voice, text).catch(() => {})), Promise.resolve())
}

function stop() {
  gen++
  if (playing === 'synth') { try { window.speechSynthesis.cancel() } catch { /* nothing to cancel */ } }
  else if (playing) { try { playing.stop() } catch { /* already ended */ } }
  playing = null
}

function synth(text) {
  return new Promise(resolve => {
    const ss = window.speechSynthesis
    if (!ss) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    const en = ss.getVoices().find(v => /^en[-_]/i.test(v.lang))
    if (en) u.voice = en
    u.rate = 1.05
    u.onend = u.onerror = resolve
    playing = 'synth'
    ss.speak(u)
    setTimeout(resolve, 10000)
  })
}

async function play(text, voice, g) {
  let buf = null
  // A clip not ready in time is spoken by the iPad: a count said late is worse than a plain voice.
  if (ctx) { try { buf = await within(load(voice, text), 2500) } catch { buf = null } }
  if (g !== gen || muted) return
  if (buf) {
    await new Promise(resolve => {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = resolve
      playing = src
      src.start(0)
    })
  } else await synth(text)
  if (g === gen) playing = null
}

/**
 * Say a line. `interrupt` (the default) cuts off whatever is being said and drops what is
 * waiting: right for counts, where only the newest one matters. Otherwise it waits its turn.
 */
export function say(text, voice, { interrupt = true } = {}) {
  if (muted || !text) return Promise.resolve()
  if (interrupt) { stop(); queue = Promise.resolve() }
  const g = gen
  const job = queue.then(() => (g === gen ? play(text, voice, g) : null))
  queue = job.catch(() => {})
  return job
}
