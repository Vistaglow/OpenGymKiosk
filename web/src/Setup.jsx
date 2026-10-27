import { useEffect, useState } from 'react'
import { api } from './api.js'
import { unlockAudio, say } from './voice.js'
import { setSimEnabled } from './store.js'
import { Avatar } from './Profiles.jsx'

// A code for setting up another screen, or this iPad's Home Screen app, which keeps its own
// cookies apart from Safari's.
function DeviceCode() {
  const [code, setCode] = useState(null)
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!code) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [code])

  async function make() {
    setErr(null)
    try {
      const r = await api.deviceCode()
      setCode(r.code)
      setUntil(Date.now() + r.expiresIn * 1000)
      setNow(Date.now())
    } catch (e) {
      setErr(e.message)
    }
  }

  const left = Math.max(0, Math.round((until - now) / 1000))
  return (
    <section className="card">
      <h2>Add a device</h2>
      <p className="muted">
        For another screen, or for this iPad’s Home Screen icon: it keeps its own sign-in, separate from Safari’s.
        Open the kiosk there and type this code.
      </p>
      {code && left > 0 ? (
        <div className="row">
          <div className="device-code">{code.slice(0, 3)} {code.slice(3)}</div>
          <div className="muted">Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more</div>
        </div>
      ) : (
        <div className="row"><button className="btn primary big" onClick={make}>Get a code</button></div>
      )}
      {err && <p className="err">{err}</p>}
    </section>
  )
}

export default function Setup({ profiles, reload, sim, setSim, sensorOnline, onBack }) {
  const [voices, setVoices] = useState({ voices: [], online: true })
  const [status, setStatus] = useState(null)
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [removing, setRemoving] = useState(null)

  useEffect(() => {
    // A refused sign-in is not the speech model being down; the page handles that on its own.
    api.voices().then(setVoices).catch(e => { if (e.status !== 401) setVoices({ voices: [], online: false }) })
    api.status().then(setStatus).catch(() => {})
  }, [])

  async function pair(e) {
    e.preventDefault()
    setPairing(true); setMsg(null)
    try {
      const p = await api.pair(code)
      setCode('')
      setMsg({ ok: true, text: `${p.name} is paired.` })
      reload()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setPairing(false)
    }
  }

  async function changeVoice(p, voice) {
    await api.setVoice(p.id, voice).catch(err => setMsg({ ok: false, text: err.message }))
    reload()
    preview({ ...p, voice })
  }

  function preview(p) {
    unlockAudio()
    say(`Hey ${p.name}! Three more, you’ve got this!`, p.voice)
  }

  async function remove(p) {
    await api.remove(p.id).catch(err => setMsg({ ok: false, text: err.message }))
    setRemoving(null)
    reload()
  }

  const toggleSim = () => { setSimEnabled(!sim); setSim(!sim) }
  const voiceList = voices.voices.length ? voices.voices : [...new Set(profiles.map(p => p.voice))]

  return (
    <div className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={onBack}>‹ Done</button>
        <h1>Setup</h1>
        <div />
      </header>

      <div className="setup scroll">
        <section className="card">
          <h2>Add a person</h2>
          <ol className="muted steps">
            <li>On their phone or computer, open openGym and sign in.</li>
            <li>Go to <b>Settings → Account → Pair the mobile app</b>.</li>
            <li>Type the 8-letter code here. It works once, for 5 minutes.</li>
          </ol>
          <form className="row" onSubmit={pair}>
            <input
              className="code" value={code} maxLength={8} placeholder="K7WQ2MZP" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn primary big" disabled={code.length < 8 || pairing}>{pairing ? 'Pairing…' : 'Pair'}</button>
          </form>
          {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
        </section>

        <section className="card">
          <h2>People</h2>
          {!voices.online && <p className="err">Can’t reach the speech model. The coach will use the iPad’s own voice until it’s back.</p>}
          {profiles.length === 0 && <p className="muted">No one paired yet.</p>}
          {profiles.map(p => (
            <div key={p.id} className="person">
              <Avatar profile={p} size="sm" />
              <div className="person-name">{p.name}</div>
              <select value={p.voice} onChange={e => changeVoice(p, e.target.value)}>
                {(voiceList.includes(p.voice) ? voiceList : [p.voice, ...voiceList]).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <button className="btn violet" onClick={() => preview(p)}>▶ Hear it</button>
              {removing === p.id
                ? <button className="btn danger" onClick={() => remove(p)}>Really remove</button>
                : <button className="btn danger" onClick={() => setRemoving(p.id)}>Remove</button>}
            </div>
          ))}
        </section>

        <DeviceCode />

        <section className="card">
          <h2>Rep sensor</h2>
          <p>
            <span className={'dot ' + (sensorOnline ? 'on' : 'off')} />{' '}
            {sensorOnline ? 'Connected' : 'Not connected'}
            {status?.sensor?.lastSeen ? <span className="muted small"> · last heard {new Date(status.sensor.lastSeen).toLocaleTimeString()}</span> : null}
          </p>
          <label className="switch">
            <input type="checkbox" checked={sim} onChange={toggleSim} />
            <span>Show the <b>Fake rep</b> button during workouts (simulated sensor)</span>
          </label>
          <div className="row">
            <button className="btn violet" onClick={() => api.simRep()}>Send one fake rep</button>
          </div>
          <p className="muted small">A fake rep travels the same way a real one does: to the kiosk server, then back to every open kiosk screen.</p>
        </section>
      </div>
    </div>
  )
}
