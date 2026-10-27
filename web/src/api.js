// The only place the page talks to the kiosk server. The server adds each person's openGym token;
// the page never sees one.
import { finishSession } from './session.js'

// A screen whose device cookie stopped working (KIOSK_KEY changed) is told once, so the page
// can go back to the set-up screen instead of failing request by request.
let notEnrolled = () => {}
export const onNotEnrolled = fn => { notEnrolled = fn }

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    // Older Safari sent no cookies with fetch unless asked, and the device cookie is the way in.
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* an empty or non-JSON answer */ }
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'not-enrolled') notEnrolled()
    const e = new Error(data?.message || data?.error || `The kiosk server answered ${res.status}`)
    e.status = res.status
    e.data = data
    throw e
  }
  return data
}

const pid = id => encodeURIComponent(id)

export const api = {
  whoami: () => call('/k/whoami'),
  enrollWithCode: code => call('/enroll/code', { method: 'POST', body: { code } }),
  deviceCode: () => call('/k/devices/code', { method: 'POST' }),
  profiles: () => call('/k/profiles').then(r => r.profiles),
  pair: code => call('/k/profiles/pair', { method: 'POST', body: { code } }).then(r => r.profile),
  setVoice: (id, voice) => call(`/k/profiles/${pid(id)}`, { method: 'PATCH', body: { voice } }).then(r => r.profile),
  remove: id => call(`/k/profiles/${pid(id)}`, { method: 'DELETE' }),
  voices: () => call('/k/voices'),
  status: () => call('/k/status'),
  simRep: () => call('/k/sim/rep', { method: 'POST' }),
  getData: id => call(`/k/profiles/${pid(id)}/data`),
  putData: (id, body) => call(`/k/profiles/${pid(id)}/data`, { method: 'PUT', body }),
}

/**
 * Save a finished session into openGym. It reads the profile fresh, finishes the session on that
 * copy and writes it back over the revision it read. If another device wrote in between, openGym
 * answers 409 with its newer copy, and the session is finished again on that one.
 */
export async function saveSession(id, active) {
  let { state, rev } = await api.getData(id)
  if (!state) throw new Error('This profile has no openGym data yet. Open openGym once on a phone first.')
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = finishSession(state, active)
    const body = { state: result.state, baseRev: rev }
    if (typeof state._wid === 'string') body.baseWid = state._wid
    try {
      const r = await api.putData(id, body)
      return { ...result, rev: r?.rev }
    } catch (e) {
      if (e.status === 409 && e.data?.state) { state = e.data.state; rev = e.data.rev || 0; continue }
      throw e
    }
  }
  throw new Error('openGym kept changing while saving. Try again.')
}

/** The server's live events: reps from the weight-stack sensor (or the simulated sensor) and sensor status. */
export function listen(onEvent) {
  const es = new EventSource('/k/events')
  es.onmessage = m => {
    try { onEvent(JSON.parse(m.data)) } catch { /* a malformed event is skipped */ }
  }
  return () => es.close()
}
