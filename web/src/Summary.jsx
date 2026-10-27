import { exerciseName, unitOf } from './session.js'
import { Avatar } from './Profiles.jsx'

const minutes = ms => Math.max(1, Math.round(ms / 60000))

export default function Summary({ profile, S, result, onRetry, onDone }) {
  const unit = unitOf(S)
  if (!result || result.saving) {
    return <div className="screen center column gap"><div className="spinner" /><div className="muted">Saving to openGym…</div></div>
  }
  if (result.error) {
    return (
      <div className="screen center">
        <div className="card narrow">
          <h2>Couldn’t save the workout</h2>
          <p className="muted">{result.error}</p>
          <p className="muted small">It is kept on this iPad, so nothing is lost. Try again, or come back to it from {profile.name}’s screen.</p>
          <div className="row">
            <button className="btn ghost big" onClick={onDone}>Later</button>
            <button className="btn primary big" onClick={onRetry}>Try again</button>
          </div>
        </div>
      </div>
    )
  }
  const w = result.workout
  const sets = w.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)
  // An exercise in a routine twice is a record twice in openGym's list; once is enough here.
  const prs = [...new Set(result.prs)]
  const e1prs = result.e1prs.filter((r, i, all) => all.findIndex(x => x.id === r.id) === i)
  return (
    <div className="screen center">
      <div className="card summary">
        <Avatar profile={profile} />
        <h1>Nice work, {profile.name}!</h1>
        <div className="muted">{w.name} · saved to openGym</div>
        <div className="stats">
          <div><div className="stat">{minutes(w.end - w.start)}</div><div className="muted small">{minutes(w.end - w.start) === 1 ? 'minute' : 'minutes'}</div></div>
          <div><div className="stat">{sets}</div><div className="muted small">{sets === 1 ? 'set' : 'sets'}</div></div>
          <div><div className="stat">{Math.round(w.vol || 0).toLocaleString()}</div><div className="muted small">{unit} lifted</div></div>
        </div>
        {(prs.length > 0 || e1prs.length > 0) && (
          <div className="prs">
            {prs.map(id => <div key={id} className="pr">🏆 New best weight: {exerciseName(id)}</div>)}
            {e1prs.map(r => <div key={r.id} className="pr">📈 New best estimated 1RM: {exerciseName(r.id)}</div>)}
          </div>
        )}
        <button className="btn primary big wide" onClick={onDone}>Done</button>
      </div>
    </div>
  )
}
