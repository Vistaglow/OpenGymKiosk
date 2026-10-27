// The wall's home screen: one big tile per person.

const HUES = [78, 200, 330, 28, 160, 260, 0, 120]
export const hueOf = id => HUES[[...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]

export function Avatar({ profile, size = 'lg' }) {
  return (
    <div className={'avatar ' + size} style={{ '--hue': hueOf(profile.id) }}>
      {(profile.name || '?').trim().charAt(0).toUpperCase()}
    </div>
  )
}

export default function Profiles({ profiles, onChoose, onSetup, sensorOnline }) {
  const now = new Date()
  return (
    <div className="screen">
      <header className="bar">
        <div>
          <h1>Who’s training?</h1>
          <div className="muted">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <div className="bar-right">
          <span className={'dot ' + (sensorOnline ? 'on' : 'off')} title={sensorOnline ? 'Rep sensor connected' : 'Rep sensor not connected'} />
          <span className="muted small">{sensorOnline ? 'Sensor on' : 'Sensor off'}</span>
          <button className="btn ghost" onClick={onSetup} aria-label="Setup">⚙︎ Setup</button>
        </div>
      </header>

      {profiles.length === 0 ? (
        <div className="center grow">
          <div className="card narrow">
            <h2>No one here yet</h2>
            <p className="muted">Open Setup and pair each person with a code from openGym.</p>
            <button className="btn primary" onClick={onSetup}>Open Setup</button>
          </div>
        </div>
      ) : (
        <div className="tiles">
          {profiles.map(p => (
            <button key={p.id} className="tile" onClick={() => onChoose(p)}>
              <Avatar profile={p} />
              <div className="tile-name">{p.name}</div>
              <div className="muted small">{p.voice}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
