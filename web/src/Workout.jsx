import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer, currentPos, autoCompleteAt } from './workout-state.js'
import { exerciseName, mediaFor, unitOf, weightStep, restSecOf, entryMode, setDone, isWarmup, progressOf } from './session.js'
import { repLine, setIntro, exerciseIntro, restLine, tenSeconds, goLine } from './lines.js'
import { say, prewarm, setMuted, isMuted } from './voice.js'
import { api } from './api.js'

const workSets = e => e.sets.filter(s => !isWarmup(s))
const fmtW = w => (w % 1 ? w.toFixed(1).replace(/\.0$/, '') : String(w))
const clock = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function setLabel(e, s) {
  if (isWarmup(s)) return 'Warm-up'
  const work = workSets(e)
  return `Set ${work.indexOf(s) + 1} of ${work.length}`
}
function setIntroFor(active, p, unit) {
  const e = active.entries[p.ei]
  const s = e.sets[p.si]
  const work = workSets(e)
  return setIntro({ setNo: work.indexOf(s) + 1, sets: work.length, reps: entryMode(e) === 'reps' ? s.r : 0, w: s.w || 0, unit, warmup: isWarmup(s) })
}
function exerciseIntroFor(active, p) {
  const e = active.entries[p.ei]
  const work = workSets(e)
  return exerciseIntro({ name: exerciseName(e.id), sets: work.length, reps: entryMode(e) === 'reps' ? work[0]?.r : 0 })
}

export default function Workout({ profile, S, initial, sim, sensorOnline, repHandler, onChange, onFinish, onDiscard, onKeep }) {
  const [st, dispatch] = useReducer(reducer, initial, initialState)
  const [now, setNow] = useState(Date.now())
  const [muted, setMutedState] = useState(isMuted())
  const [confirm, setConfirm] = useState(null) // 'finish' | 'exit'
  const introducedEi = useRef(null)
  const unit = unitOf(S)
  const step = weightStep(S)
  const restSec = restSecOf(S)
  const voice = profile.voice

  const pos = currentPos(st.active, st.focus)
  const entry = pos ? st.active.entries[pos.ei] : null
  const set = pos ? entry.sets[pos.si] : null
  const mode = entry ? entryMode(entry) : null
  const target = mode === 'reps' ? set?.r || 0 : 0
  const prog = progressOf(st.active)

  // A rep from the weight-stack sensor, the simulated sensor or the space bar.
  useEffect(() => {
    repHandler.current = () => dispatch({ type: 'rep', now: Date.now() })
    const key = e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); dispatch({ type: 'rep', now: Date.now() }) } }
    window.addEventListener('keydown', key)
    return () => { repHandler.current = null; window.removeEventListener('keydown', key) }
  }, [repHandler])

  useEffect(() => {
    const t = setInterval(() => { const n = Date.now(); setNow(n); dispatch({ type: 'tick', now: n }) }, 250)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { onChange(st.active) }, [st.active]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoAt = autoCompleteAt(st)
  useEffect(() => {
    if (!autoAt) return
    const t = setTimeout(() => dispatch({ type: 'complete', now: Date.now(), restSec }), Math.max(0, autoAt - Date.now()))
    return () => clearTimeout(t)
  }, [autoAt, restSec])

  // What the coach says, once per cue.
  useEffect(() => {
    const c = st.cue
    if (!c) return
    const p = currentPos(st.active, st.focus)
    const introduce = () => {
      if (!p) return
      if (introducedEi.current !== p.ei) { introducedEi.current = p.ei; say(exerciseIntroFor(st.active, p), voice, { interrupt: false }) }
      say(setIntroFor(st.active, p, unit), voice, { interrupt: false })
    }
    switch (c.kind) {
      case 'intro': introducedEi.current = null; introduce(); break
      case 'rep': say(repLine(c.count, c.target), voice); break
      case 'rest':
        say(restLine(c.sec), voice, { interrupt: false })
        if (p) prewarm(voice, [setIntroFor(st.active, p, unit), exerciseIntroFor(st.active, p)])
        break
      case 'ten': say(tenSeconds(), voice); break
      case 'go': say(goLine(), voice); introduce(); break
      case 'allDone': say('That’s everything! Tap finish to save your workout.', voice, { interrupt: false }); break
      default: break
    }
  }, [st.cue?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const complete = () => dispatch({ type: 'complete', now: Date.now(), restSec })
  const toggleMute = () => { setMuted(!muted); setMutedState(!muted) }
  const media = entry ? mediaFor(S, entry.id) : null

  return (
    <div className="workout">
      <header className="bar">
        <button className="btn ghost" onClick={() => setConfirm('exit')}>‹ Exit</button>
        <div className="bar-title column">
          <h1>{st.active.name}</h1>
          <div className="muted small">{profile.name} · {clock(now - st.active.start)} · {prog.done}/{prog.total} sets</div>
        </div>
        <div className="bar-right">
          <span className={'dot ' + (sensorOnline ? 'on' : 'off')} title={sensorOnline ? 'Sensor connected' : 'Sensor not connected'} />
          <button className="btn ghost" onClick={toggleMute} aria-label={muted ? 'Unmute coach' : 'Mute coach'}>{muted ? '🔇' : '🔊'}</button>
          <button className="btn primary" onClick={() => setConfirm('finish')}>Finish</button>
        </div>
      </header>

      <div className="workout-body">
        <aside className="rail scroll">
          {st.active.entries.map((e, ei) => {
            const left = e.sets.filter(s => !setDone(s)).length
            return (
              <button key={ei} className={'rail-item' + (pos?.ei === ei ? ' current' : '') + (left === 0 ? ' finished' : '')} onClick={() => dispatch({ type: 'focus', ei })}>
                <div className="rail-name">{exerciseName(e.id)}</div>
                <div className="pips">{e.sets.map((s, i) => <span key={i} className={'pip' + (setDone(s) ? ' done' : '') + (isWarmup(s) ? ' warm' : '')} />)}</div>
              </button>
            )
          })}
        </aside>

        <main className="stage">
          {st.phase === 'done' && (
            <div className="center grow column gap">
              <div className="huge">🎉</div>
              <h2>All sets done</h2>
              <button className="btn primary huge-btn" onClick={() => onFinish(st.active)}>Finish &amp; save</button>
            </div>
          )}

          {st.phase === 'rest' && pos && (
            <div className="center grow column gap rest">
              <div className="muted">Rest</div>
              <div className="countdown">{clock(st.restEnd - now)}</div>
              <div className="next">Next: {exerciseName(entry.id)} · {setLabel(entry, set)}{target ? ` · ${target} reps` : ''}{set.w ? ` · ${fmtW(set.w)} ${unit}` : ''}</div>
              <div className="row">
                <button className="btn blue big" onClick={() => dispatch({ type: 'addRest', sec: 30, now: Date.now() })}>+30 s</button>
                <button className="btn primary big" onClick={() => dispatch({ type: 'skipRest' })}>Skip rest</button>
              </div>
              <div className="muted small">Start lifting any time: the first rep ends the rest.</div>
            </div>
          )}

          {(st.phase === 'ready' || st.phase === 'lifting') && pos && (
            <div className="set-view">
              <div className="set-head">
                <h2>{exerciseName(entry.id)}</h2>
                <div className="muted">{setLabel(entry, set)}</div>
              </div>
              <div className="set-main">
                <div className="media">
                  {media ? <video key={media.clip} src={media.clip} poster={media.still} autoPlay loop muted playsInline /> : <div className="media-empty">No animation</div>}
                </div>
                <div className="counter-wrap">
                  {mode === 'reps' ? (
                    <Counter count={st.count} target={target} />
                  ) : (
                    <div className="timed">
                      <div className="huge">⏱</div>
                      <div className="muted">{mode === 'time' ? 'Timed set' : 'Cardio'}: tap Done when you finish.</div>
                    </div>
                  )}
                  <div className="status">
                    {mode !== 'reps' ? '' : st.phase === 'ready' ? (sensorOnline || sim ? 'Waiting for your first rep…' : 'Count with + and −, then tap Done') : st.count >= target && target ? 'Target reached! The set saves itself in a few seconds' : 'Keep going!'}
                  </div>
                </div>
              </div>
              <div className="controls">
                {mode === 'reps' && (
                  <div className="stepper">
                    <button className="btn blue big" onClick={() => dispatch({ type: 'adjust', delta: -1, now: Date.now() })}>− rep</button>
                    <button className="btn blue big" onClick={() => dispatch({ type: 'adjust', delta: 1, now: Date.now() })}>+ rep</button>
                  </div>
                )}
                <div className="stepper weight">
                  <button className="btn amber big" onClick={() => dispatch({ type: 'weight', w: Math.max(0, (set.w || 0) - step) })}>−</button>
                  <div className="weight-value">{set.w ? `${fmtW(set.w)} ${unit}` : 'Body weight'}</div>
                  <button className="btn amber big" onClick={() => dispatch({ type: 'weight', w: (set.w || 0) + step })}>+</button>
                </div>
                {sim && <button className="btn violet big" onClick={() => api.simRep().catch(() => {})}>Fake rep</button>}
                <button className="btn primary big" onClick={complete}>Done set</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {confirm === 'finish' && (
        <Sheet onClose={() => setConfirm(null)}>
          <h2>{prog.done < prog.total ? 'Finish early?' : 'Finish workout?'}</h2>
          {prog.done < prog.total && <p className="muted">{prog.total - prog.done} {prog.total - prog.done === 1 ? 'set is' : 'sets are'} still open. They won’t be logged.</p>}
          <div className="row">
            <button className="btn blue big" onClick={() => setConfirm(null)}>Keep going</button>
            <button className="btn primary big" onClick={() => onFinish(st.active)}>Finish &amp; save</button>
          </div>
        </Sheet>
      )}
      {confirm === 'exit' && (
        <Sheet onClose={() => setConfirm(null)}>
          <h2>Leave this workout?</h2>
          <p className="muted">Keep it to pick it up later on this iPad, or throw it away.</p>
          <div className="row">
            <button className="btn danger big" onClick={onDiscard}>Discard</button>
            <button className="btn ghost big" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary big" onClick={() => onKeep(st.active)}>Keep for later</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function Counter({ count, target }) {
  const r = 92
  const c = 2 * Math.PI * r
  const frac = target ? Math.min(1, count / target) : 0
  return (
    <div className={'counter' + (target && count >= target ? ' hit' : '')}>
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r={r} className="ring-bg" />
        <circle cx="110" cy="110" r={r} className="ring" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className="counter-text">
        <div className="count">{count}</div>
        {target > 0 && <div className="target">of {target}</div>}
      </div>
    </div>
  )
}

export function Sheet({ children, onClose }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  )
}
