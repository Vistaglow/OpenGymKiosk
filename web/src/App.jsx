import { useCallback, useEffect, useRef, useState } from 'react'
import { api, listen, saveSession, onNotEnrolled } from './api.js'
import { prepare, todayPlan, exerciseName } from './session.js'
import { fixedLines, welcome, finishLine } from './lines.js'
import { unlockAudio, prewarm, say } from './voice.js'
import { saveActive, savedActive, simEnabled } from './store.js'
import Profiles from './Profiles.jsx'
import Today from './Today.jsx'
import Workout from './Workout.jsx'
import Summary from './Summary.jsx'
import Setup from './Setup.jsx'

// Back to the profile picker after this long untouched, unless a workout is running.
const IDLE_MS = 3 * 60 * 1000

export default function App() {
  const [enrolled, setEnrolled] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [view, setView] = useState('profiles')
  const [profile, setProfile] = useState(null)
  const [data, setData] = useState(null) // { state, rev } for the chosen profile
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(null)
  const [result, setResult] = useState(null) // { saving, error, workout, prs, e1prs }
  const [sensorOnline, setSensorOnline] = useState(false)
  const [sim, setSim] = useState(simEnabled())
  const repHandler = useRef(null)

  const loadProfiles = useCallback(() => api.profiles().then(setProfiles).catch(e => setError(e.message)), [])

  useEffect(() => {
    // Any request refused for the device cookie (KIOSK_KEY changed since) goes back to set-up.
    // A workout in progress stays in this iPad's storage and can be resumed after.
    onNotEnrolled(() => setEnrolled(false))
    api.whoami().then(() => { setEnrolled(true); loadProfiles() }).catch(e => setEnrolled(e.status === 401 ? false : true))
  }, [loadProfiles])

  // One connection for the whole page; the workout screen registers what a rep does.
  useEffect(() => {
    if (!enrolled) return
    return listen(ev => {
      if (ev.type === 'sensor') setSensorOnline(!!ev.online)
      if (ev.type === 'rep') repHandler.current?.(ev)
    })
  }, [enrolled])

  // Keep the screen on during a workout where the browser allows it (it needs HTTPS).
  useEffect(() => {
    if (view !== 'workout' || !navigator.wakeLock) return
    let lock = null
    const take = () => navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    take()
    const again = () => { if (document.visibilityState === 'visible') take() }
    document.addEventListener('visibilitychange', again)
    return () => { document.removeEventListener('visibilitychange', again); lock?.release().catch(() => {}) }
  }, [view])

  const home = useCallback(() => {
    setView('profiles'); setProfile(null); setData(null); setActive(null); setResult(null); setError(null)
    loadProfiles()
  }, [loadProfiles])

  useEffect(() => {
    if (view === 'profiles' || view === 'workout') return
    let t = setTimeout(home, IDLE_MS)
    const poke = () => { clearTimeout(t); t = setTimeout(home, IDLE_MS) }
    window.addEventListener('pointerdown', poke)
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', poke) }
  }, [view, home])

  async function choose(p) {
    unlockAudio()
    setProfile(p); setView('today'); setLoading(true); setError(null); setData(null)
    prewarm(p.voice, fixedLines())
    try {
      const d = await api.getData(p.id)
      if (d.state) prepare(d.state)
      setData(d)
      const today = d.state ? todayPlan(d.state).routines : []
      say(welcome(p.name, today.map(r => r.name).join(' and ')), p.voice)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function begin(session) {
    saveActive(profile.id, session)
    setActive(session)
    setView('workout')
  }

  async function finish(session) {
    saveActive(profile.id, session)
    setActive(session)
    setView('summary')
    setResult({ saving: true })
    try {
      const r = await saveSession(profile.id, session)
      saveActive(profile.id, null)
      setResult({ saving: false, ...r })
      setData({ state: r.state, rev: r.rev })
      say(finishLine(profile.name, [...new Set(r.prs)].map(exerciseName)), profile.voice)
    } catch (e) {
      setResult({ saving: false, error: e.message })
    }
  }

  function discard() {
    saveActive(profile.id, null)
    setActive(null)
    setView('today')
  }

  if (enrolled === null) return <div className="screen center"><div className="spinner" /></div>
  if (enrolled === false) return <NotEnrolled onEnrolled={() => { setEnrolled(true); loadProfiles() }} />

  return (
    <div className="app">
      {view === 'profiles' && <Profiles profiles={profiles} onChoose={choose} onSetup={() => setView('setup')} sensorOnline={sensorOnline} />}
      {view === 'today' && (
        <Today
          profile={profile} data={data} loading={loading} error={error}
          saved={profile && savedActive(profile.id)}
          onStart={begin} onResume={() => begin(savedActive(profile.id))}
          onDiscardSaved={() => { saveActive(profile.id, null); setActive(null); setData(d => ({ ...d })) }}
          onBack={home} onRetry={() => choose(profile)}
        />
      )}
      {view === 'workout' && active && (
        <Workout
          profile={profile} S={data.state} initial={active} sim={sim} sensorOnline={sensorOnline}
          repHandler={repHandler}
          onChange={s => saveActive(profile.id, s)}
          onFinish={finish} onDiscard={discard}
          onKeep={s => { saveActive(profile.id, s); setActive(null); setView('today') }}
        />
      )}
      {view === 'summary' && <Summary profile={profile} S={data?.state} result={result} onRetry={() => finish(active)} onDone={home} />}
      {view === 'setup' && <Setup profiles={profiles} reload={loadProfiles} sim={sim} setSim={setSim} sensorOnline={sensorOnline} onBack={home} />}
    </div>
  )
}

// A Home Screen app keeps its own cookies, apart from Safari's, and has no address bar: so this
// screen takes a 6-digit code from an enrolled screen (or the full KIOSK_KEY) typed in.
function NotEnrolled({ onEnrolled }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.enrollWithCode(code.trim())
      onEnrolled()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen center">
      <div className="card narrow">
        <h1>Set up this screen</h1>
        <p className="muted">
          On a screen that already shows the kiosk (Safari on this iPad works), open <b>Setup → Add a device</b> and
          type the 6-digit code here.
        </p>
        <form className="row" onSubmit={submit}>
          <input
            className="code" value={code} placeholder="123456" inputMode="numeric" autoComplete="off" autoCorrect="off" spellCheck={false}
            onChange={e => setCode(e.target.value.replace(/\s/g, ''))}
          />
          <button className="btn primary big" disabled={code.length < 6 || busy}>{busy ? 'Checking…' : 'Set up'}</button>
        </form>
        {err && <p className="err">{err}</p>}
        <p className="muted small">The kiosk key from the <code>.env</code> file works here too.</p>
      </div>
    </div>
  )
}
