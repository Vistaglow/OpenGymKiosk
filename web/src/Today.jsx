import { useMemo } from 'react'
import { todayPlan, startSession, exerciseName, unitOf, progressOf, isWarmup } from './session.js'
import { Avatar } from './Profiles.jsx'
import { routineEmoji } from './glyphs.js'

// What a routine will be today, with openGym's prescription applied: "Bench Press · 4 × 8 · 42.5 lb".
function preview(S, routine) {
  const s = startSession(S, [routine.id])
  return s.entries.map(e => {
    const work = e.sets.filter(x => !isWarmup(x))
    const top = work.reduce((m, x) => Math.max(m, x.w || 0), 0)
    return { id: e.id, name: exerciseName(e.id), sets: work.length, reps: work[0]?.r, w: top }
  })
}

export default function Today({ profile, data, loading, error, saved, onStart, onResume, onDiscardSaved, onBack, onRetry }) {
  const S = data?.state
  const plan = useMemo(() => (S ? todayPlan(S) : null), [S])
  const unit = unitOf(S)
  const others = plan ? plan.all.filter(r => !plan.routineIds.includes(r.id)) : []

  return (
    <div className="screen">
      <header className="bar">
        <button className="btn ghost" onClick={onBack}>‹ Back</button>
        <div className="bar-title">
          <Avatar profile={profile} size="sm" />
          <h1>{profile.name}</h1>
        </div>
        <div />
      </header>

      {loading && <div className="center grow"><div className="spinner" /></div>}
      {error && (
        <div className="center grow">
          <div className="card narrow">
            <h2>Couldn’t load {profile.name}’s workouts</h2>
            <p className="muted">{error}</p>
            <button className="btn primary" onClick={onRetry}>Try again</button>
          </div>
        </div>
      )}
      {!loading && !error && data && !S && (
        <div className="center grow">
          <div className="card narrow"><h2>Nothing in openGym yet</h2><p className="muted">Set up a routine in openGym first, then come back.</p></div>
        </div>
      )}

      {plan && (
        <div className="today scroll">
          {saved && (
            <div className="card resume">
              <div>
                <h2>Pick up where you left off</h2>
                <div className="muted">{saved.name} · {progressOf(saved).done} of {progressOf(saved).total} sets done</div>
              </div>
              <div className="row">
                <button className="btn danger" onClick={onDiscardSaved}>Discard</button>
                <button className="btn primary big" onClick={onResume}>Resume</button>
              </div>
            </div>
          )}

          <h2 className="section">Today</h2>
          {plan.routines.length === 0 && <p className="muted">Rest day in openGym. Pick any routine below to train anyway.</p>}
          <div className="routines">
            {plan.routines.map(r => (
              <RoutineCard key={r.id} S={S} routine={r} unit={unit} done={plan.doneIds.has(r.id)} onStart={() => onStart(startSession(S, [r.id]))} featured />
            ))}
          </div>
          {plan.routines.length > 1 && (
            <button className="btn primary big wide" onClick={() => onStart(startSession(S, plan.routineIds))}>Start all of today</button>
          )}

          {others.length > 0 && (
            <>
              <h2 className="section">Other routines</h2>
              <div className="routines small">
                {others.map(r => (
                  <RoutineCard key={r.id} S={S} routine={r} unit={unit} done={plan.doneIds.has(r.id)} onStart={() => onStart(startSession(S, [r.id]))} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function RoutineCard({ S, routine, unit, done, onStart, featured }) {
  const items = useMemo(() => preview(S, routine), [S, routine])
  return (
    <div className={'card routine' + (featured ? ' featured' : '')}>
      <div className="routine-head">
        <h3>{routineEmoji(routine) ? routineEmoji(routine) + ' ' : ''}{routine.name}</h3>
        {done && <span className="badge">Done today ✓</span>}
      </div>
      {featured && (
        <ul className="ex-list">
          {items.map((x, i) => (
            <li key={i}>
              <span>{x.name}</span>
              <span className="muted">{x.sets} × {x.reps ?? '—'}{x.w ? ` · ${x.w} ${unit}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {!featured && <div className="muted small">{items.length} exercises</div>}
      <button className={'btn ' + (featured ? 'primary big' : 'blue')} onClick={onStart}>{done ? 'Train again' : 'Start'}</button>
    </div>
  )
}
