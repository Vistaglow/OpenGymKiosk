// Gym kiosk server. Plain node:http, no dependencies, like openGym's own API.
//
// What it does, and why it is a server rather than just files:
//   - holds each person's openGym pairing token in data/profiles.json and adds it to their
//     requests, so the iPad (whose storage Safari may clear) never keeps one;
//   - relays reps: the rep sensor POSTs one per rep, every open kiosk page hears it over SSE;
//   - speaks: asks phonon (Ollama) for a line, fixes the streamed WAV header, caches the file;
//   - passes the exercise animations through from openGym's web container.
//
// Everything under /k/ needs the kiosk cookie, which /enroll?key=KIOSK_KEY sets once per device.
// The sensor uses its own token (SENSOR_TOKEN) on /sensor/*.

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { fixWavSizes } from './wav.js'

const env = process.env
const PORT = Number(env.PORT) || 8090
const DATA_DIR = env.DATA_DIR || path.resolve('data')
const PUBLIC_DIR = env.PUBLIC_DIR || path.resolve('web/dist')
const KIOSK_KEY = env.KIOSK_KEY || ''
const SENSOR_TOKEN = env.SENSOR_TOKEN || ''
const OPENGYM_API = (env.OPENGYM_API || 'http://api:3000').replace(/\/+$/, '')
const OPENGYM_WEB = (env.OPENGYM_WEB || 'http://web:80').replace(/\/+$/, '')
const TTS_URL = (env.TTS_URL || 'http://host.docker.internal:11434').replace(/\/+$/, '')
const TTS_MODEL = env.TTS_MODEL || 'phonon'
const TTS_DEFAULT_VOICE = env.TTS_DEFAULT_VOICE || 'default'

if (KIOSK_KEY.length < 16) {
  console.error('KIOSK_KEY must be set to at least 16 characters (see .env.example)')
  process.exit(1)
}
if (SENSOR_TOKEN.length < 16) console.warn('SENSOR_TOKEN is not set (16+ characters): the rep sensor will be refused')

fs.mkdirSync(DATA_DIR, { recursive: true })

/* ---------- small helpers ---------- */

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0
    req.on('data', c => {
      n += c.length
      if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
async function readJson(req, limit) {
  const raw = await readBody(req, limit)
  if (!raw.length) return {}
  try { return JSON.parse(raw.toString('utf8')) } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }) }
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => {
  const i = c.indexOf('=')
  return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]
}))

/* ---------- device enrolment ---------- */

// The cookie is derived from the key, so changing KIOSK_KEY signs every device out at once.
const DEVICE_COOKIE = 'gk'
const deviceValue = crypto.createHmac('sha256', KIOSK_KEY).update('gym-kiosk device v1').digest('hex')
const enrolled = req => safeEqual(cookies(req)[DEVICE_COOKIE] || '', deviceValue)

function deviceCookie(req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  return `${DEVICE_COOKIE}=${deviceValue}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax${secure}`
}

function enroll(req, res, url) {
  if (!safeEqual(url.searchParams.get('key') || '', KIOSK_KEY)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end('<!doctype html><meta name=viewport content="width=device-width"><p style="font:18px system-ui;padding:24px">That key is not right.</p>')
  }
  res.writeHead(302, { 'Set-Cookie': deviceCookie(req), Location: '/' })
  res.end()
}

// Short device codes. An iPad's Home Screen app keeps its own cookies, apart from Safari's, and
// has no address bar to open /enroll in; so an enrolled screen hands out a 6-digit code (Setup →
// Add a device) that the new screen types in. One use, ten minutes.
const deviceCodes = new Map() // code -> expiry
function newDeviceCode() {
  const now = Date.now()
  for (const [c, exp] of deviceCodes) if (exp < now) deviceCodes.delete(c)
  let code
  do code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); while (deviceCodes.has(code))
  deviceCodes.set(code, now + 10 * 60e3)
  return code
}

// Guesses are counted for everyone together: behind Docker's port mapping every client has the
// same address. 20 wrong tries in 10 minutes pauses code entry, which puts a million codes far
// out of reach while a typo or two costs nothing.
const ENROLL_WINDOW_MS = 10 * 60e3
const ENROLL_MAX_MISSES = 20
let misses = []

async function enrollWithCode(req, res) {
  const now = Date.now()
  misses = misses.filter(t => now - t < ENROLL_WINDOW_MS)
  if (misses.length >= ENROLL_MAX_MISSES) return json(res, 429, { error: 'too-many', message: 'Too many wrong codes. Wait ten minutes and try again.' })
  const { code } = await readJson(req)
  const given = String(code || '').trim()
  // The full KIOSK_KEY works here too, for when no enrolled screen is at hand.
  const ok = given.length >= 16
    ? safeEqual(given, KIOSK_KEY)
    : deviceCodes.get(given) > now && deviceCodes.delete(given)
  if (!ok) {
    misses.push(now)
    return json(res, 400, { error: 'code-invalid', message: 'That code didn’t work. Codes work once, for 10 minutes.' })
  }
  res.writeHead(200, { 'Set-Cookie': deviceCookie(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ enrolled: true }))
}

/* ---------- profiles (openGym pairings) ---------- */

const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json')
let profiles = loadProfiles()

function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) } catch (e) {
    if (e.code !== 'ENOENT') console.error('profiles.json unreadable, starting empty:', e.message)
    return []
  }
}
function saveProfiles() {
  const tmp = PROFILES_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, PROFILES_FILE)
}
const publicProfile = p => ({ id: p.id, name: p.name, voice: p.voice })
const profileById = id => profiles.find(p => p.id === id)

// One call to openGym's API, as that profile when one is given.
async function og(pathname, { profile = null, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (profile) headers.Authorization = 'Bearer ' + profile.token
  const res = await fetch(OPENGYM_API + pathname, { method, headers, body, signal: AbortSignal.timeout(20000) })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text.slice(0, 200) } }
  return { status: res.status, data }
}

const expired = res => json(res, 401, { error: 'pairing-expired', message: 'This person’s pairing has run out. Pair them again in Setup.' })

// A paired token is renewed by /api/me once it is past half its life; asking once an hour is plenty.
async function renewToken(p) {
  if (Date.now() - (p.checkedAt || 0) < 3600e3) return
  p.checkedAt = Date.now()
  try {
    const r = await og('/api/me', { profile: p })
    if (r.status === 200 && r.data?.token) p.token = r.data.token
    if (r.status === 200 && r.data?.user?.name) p.name = r.data.user.name
    saveProfiles()
  } catch (e) { console.error('token renewal failed for', p.id, e.message) }
}

async function pair(req, res) {
  const { code } = await readJson(req)
  if (typeof code !== 'string' || !code.trim()) return json(res, 400, { error: 'code-missing', message: 'Enter the code openGym shows.' })
  let r
  try { r = await og('/api/pair/redeem', { method: 'POST', body: JSON.stringify({ code: code.trim() }) }) } catch (e) {
    return json(res, 502, { error: 'opengym-unreachable', message: 'Could not reach openGym: ' + e.message })
  }
  if (r.status === 400) return json(res, 400, { error: 'code-invalid', message: 'That code didn’t work. Codes last 5 minutes and work once, so make a fresh one.' })
  if (r.status !== 200 || !r.data?.token || !r.data?.user?.id) return json(res, 502, { error: 'opengym-error', message: 'openGym answered ' + r.status })
  const { token, user } = r.data
  const existing = profileById(user.id)
  if (existing) Object.assign(existing, { token, name: user.name, checkedAt: Date.now() })
  else profiles.push({ id: user.id, name: user.name, token, voice: TTS_DEFAULT_VOICE, pairedAt: Date.now(), checkedAt: Date.now() })
  saveProfiles()
  json(res, 200, { profile: publicProfile(profileById(user.id)) })
}

async function getData(res, p) {
  const r = await og('/api/data', { profile: p })
  if (r.status === 401) return expired(res)
  json(res, r.status, r.data)
  if (r.status === 200) renewToken(p)
}

async function putData(req, res, p) {
  // openGym's own limit is 5 MiB; a little over it so openGym is the one that says no.
  const body = await readBody(req, 6 * 1024 * 1024)
  const r = await og('/api/data', { profile: p, method: 'PUT', body })
  if (r.status === 401) return expired(res)
  json(res, r.status, r.data)
}

/* ---------- live events: reps and sensor status ---------- */

const listeners = new Set()
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const res of listeners) res.write(line)
}
setInterval(() => { for (const res of listeners) res.write(': ping\n\n') }, 20000).unref()

function events(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.write('retry: 2000\n\n')
  res.write(`data: ${JSON.stringify({ type: 'sensor', online: sensorOnline() })}\n\n`)
  listeners.add(res)
  req.on('close', () => listeners.delete(res))
}

const sensor = { lastSeen: 0, seen: new Map() }
const SENSOR_OFFLINE_MS = 30000
const sensorOnline = () => Date.now() - sensor.lastSeen < SENSOR_OFFLINE_MS
let reportedOnline = false
function sensorSeen() {
  sensor.lastSeen = Date.now()
  if (!reportedOnline) { reportedOnline = true; broadcast({ type: 'sensor', online: true }) }
}
setInterval(() => {
  if (reportedOnline && !sensorOnline()) { reportedOnline = false; broadcast({ type: 'sensor', online: false }) }
}, 5000).unref()

const sensorAuthorized = req => SENSOR_TOKEN.length >= 16 && safeEqual((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SENSOR_TOKEN)

async function sensorRep(req, res) {
  const { seq } = await readJson(req)
  sensorSeen()
  // The sensor retries a POST it got no answer to; the same seq inside a minute is that retry.
  if (seq != null) {
    const now = Date.now()
    for (const [k, t] of sensor.seen) if (now - t > 60000) sensor.seen.delete(k)
    if (sensor.seen.has(String(seq))) return json(res, 200, { ok: true, duplicate: true })
    sensor.seen.set(String(seq), now)
  }
  broadcast({ type: 'rep', source: 'sensor', at: Date.now() })
  json(res, 200, { ok: true })
}

/* ---------- speech (phonon on Ollama) ---------- */

const TTS_DIR = path.join(DATA_DIR, 'tts-cache')
const TTS_CACHE_MAX = 4000
const inflight = new Map()
let writesSincePrune = 0

let voiceCache = { at: 0, voices: [] }
async function voices() {
  if (Date.now() - voiceCache.at < 600e3 && voiceCache.voices.length) return voiceCache.voices
  const res = await fetch(TTS_URL + '/api/show', { method: 'POST', body: JSON.stringify({ model: TTS_MODEL }), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error('ollama answered ' + res.status)
  const list = (await res.json()).voices
  voiceCache = { at: Date.now(), voices: Array.isArray(list) ? list : [] }
  return voiceCache.voices
}

async function speech(voice, text) {
  const key = crypto.createHash('sha256').update(`${TTS_MODEL}\n${voice}\n${text}`).digest('hex').slice(0, 32)
  const file = path.join(TTS_DIR, key + '.wav')
  try { return await fsp.readFile(file) } catch { /* not cached yet */ }
  if (inflight.has(key)) return inflight.get(key)
  const job = (async () => {
    const res = await fetch(TTS_URL + '/v1/audio/speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, voice, input: text }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error('phonon answered ' + res.status)
    const wav = fixWavSizes(Buffer.from(await res.arrayBuffer()))
    await fsp.mkdir(TTS_DIR, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, wav)
    await fsp.rename(tmp, file)
    if (++writesSincePrune >= 50) { writesSincePrune = 0; pruneSpeech().catch(e => console.error('speech cache prune:', e.message)) }
    return wav
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function pruneSpeech() {
  const names = (await fsp.readdir(TTS_DIR)).filter(n => n.endsWith('.wav'))
  if (names.length <= TTS_CACHE_MAX) return
  const stats = await Promise.all(names.map(async n => ({ n, t: (await fsp.stat(path.join(TTS_DIR, n))).mtimeMs })))
  stats.sort((a, b) => a.t - b.t)
  for (const { n } of stats.slice(0, names.length - TTS_CACHE_MAX)) await fsp.rm(path.join(TTS_DIR, n), { force: true })
}

async function tts(res, url) {
  const text = (url.searchParams.get('text') || '').trim()
  const voice = url.searchParams.get('voice') || TTS_DEFAULT_VOICE
  if (!text || text.length > 400) return json(res, 400, { error: 'text must be 1–400 characters' })
  try {
    const wav = await speech(voice, text)
    // The same voice and text always make the same file, so the browser may keep it.
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'private, max-age=31536000, immutable' })
    res.end(wav)
  } catch (e) {
    // The page falls back to the iPad's own voice on any failure here.
    json(res, 503, { error: 'speech-unavailable', message: e.message })
  }
}

/* ---------- openGym's exercise animations ---------- */

const MEDIA_PATH = /^\/exercise-media\/(clip|still)\/[A-Za-z0-9._-]+$/
async function media(req, res, url) {
  if (!MEDIA_PATH.test(url.pathname)) return json(res, 404, { error: 'not found' })
  const headers = {}
  if (req.headers.range) headers.Range = req.headers.range
  const up = await fetch(OPENGYM_WEB + url.pathname, { headers, signal: AbortSignal.timeout(20000) })
  // openGym's nginx answers a missing file with its app page; that is not a picture.
  if (!up.ok || /text\/html/.test(up.headers.get('content-type') || '')) { up.body?.cancel(); return json(res, 404, { error: 'not found' }) }
  const out = {}
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = up.headers.get(h)
    if (v) out[h] = v
  }
  out['cache-control'] = 'public, max-age=86400'
  res.writeHead(up.status, out)
  Readable.fromWeb(up.body).pipe(res)
}

/* ---------- the iPad app's files ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}
async function staticFile(res, url) {
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'not found' })
  let st = await fsp.stat(file).catch(() => null)
  // Anything that is not a file is the app itself.
  if (!st || !st.isFile()) { file = path.join(PUBLIC_DIR, 'index.html'); st = await fsp.stat(file).catch(() => null) }
  if (!st) return json(res, 503, { error: 'the app has not been built' })
  const immutable = rel.startsWith('/assets/')
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

/* ---------- routing ---------- */

async function route(req, res) {
  const url = new URL(req.url, 'http://kiosk')
  const p = url.pathname
  const m = req.method

  if (p === '/health') return json(res, 200, { ok: true })
  if (p === '/enroll' && m === 'GET') return enroll(req, res, url)
  if (p === '/enroll/code' && m === 'POST') return enrollWithCode(req, res)
  // The page's own error reporter (index.html): a wall iPad has no console to look at. Open to a
  // device that is not enrolled yet, since that is when it is most needed; it only writes one
  // short line to the log.
  if (p === '/client-error' && m === 'POST') {
    const { message, ua, path: where } = await readJson(req, 16 * 1024)
    console.error(`client error on ${String(where).slice(0, 100)} (${String(ua).slice(0, 300)}):\n${String(message).slice(0, 2000)}`)
    return json(res, 200, { ok: true })
  }

  if (p.startsWith('/sensor/')) {
    if (!sensorAuthorized(req)) return json(res, 401, { error: 'bad sensor token' })
    if (p === '/sensor/rep' && m === 'POST') return sensorRep(req, res)
    if (p === '/sensor/hello' && m === 'POST') { await readBody(req); sensorSeen(); return json(res, 200, { ok: true }) }
    return json(res, 404, { error: 'not found' })
  }

  if (p.startsWith('/k/') || p.startsWith('/exercise-media/')) {
    if (!enrolled(req)) return json(res, 401, { error: 'not-enrolled' })
    if (p.startsWith('/exercise-media/')) return media(req, res, url)

    if (p === '/k/whoami') return json(res, 200, { enrolled: true })
    if (p === '/k/devices/code' && m === 'POST') return json(res, 200, { code: newDeviceCode(), expiresIn: 600 })
    if (p === '/k/events' && m === 'GET') return events(req, res)
    if (p === '/k/status' && m === 'GET') {
      let ttsOnline = true
      try { await voices() } catch { ttsOnline = false }
      return json(res, 200, { sensor: { online: sensorOnline(), lastSeen: sensor.lastSeen || null }, tts: { online: ttsOnline } })
    }
    // The simulated sensor: the same event the rep sensor sends, from a button on the page.
    if (p === '/k/sim/rep' && m === 'POST') { broadcast({ type: 'rep', source: 'sim', at: Date.now() }); return json(res, 200, { ok: true }) }

    if (p === '/k/voices' && m === 'GET') {
      try { return json(res, 200, { voices: await voices(), default: TTS_DEFAULT_VOICE, online: true }) } catch {
        return json(res, 200, { voices: [], default: TTS_DEFAULT_VOICE, online: false })
      }
    }
    if (p === '/k/tts' && m === 'GET') return tts(res, url)

    if (p === '/k/profiles' && m === 'GET') return json(res, 200, { profiles: profiles.map(publicProfile) })
    if (p === '/k/profiles/pair' && m === 'POST') return pair(req, res)
    const pm = p.match(/^\/k\/profiles\/([^/]+)(\/data)?$/)
    if (pm) {
      const prof = profileById(decodeURIComponent(pm[1]))
      if (!prof) return json(res, 404, { error: 'no such profile' })
      if (pm[2]) {
        if (m === 'GET') return getData(res, prof)
        if (m === 'PUT') return putData(req, res, prof)
      } else {
        if (m === 'PATCH') {
          const { voice } = await readJson(req)
          if (typeof voice !== 'string' || !voice || voice.length > 80) return json(res, 400, { error: 'voice must be a name' })
          prof.voice = voice
          saveProfiles()
          return json(res, 200, { profile: publicProfile(prof) })
        }
        if (m === 'DELETE') {
          profiles = profiles.filter(x => x !== prof)
          saveProfiles()
          return json(res, 200, { ok: true })
        }
      }
    }
    return json(res, 404, { error: 'not found' })
  }

  if (m === 'GET' || m === 'HEAD') return staticFile(res, url)
  json(res, 405, { error: 'method not allowed' })
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    if (!e.status) console.error(req.method, req.url.split('?')[0], e)
    if (res.headersSent) return res.end()
    json(res, e.status || 502, { error: e.status ? e.message : 'upstream-failed', message: e.message })
  })
})
server.listen(PORT, () => console.log(`gym-kiosk on :${PORT} (openGym ${OPENGYM_API}, speech ${TTS_URL} ${TTS_MODEL}, ${profiles.length} profiles)`))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); for (const r of listeners) r.end(); process.exit(0) })
