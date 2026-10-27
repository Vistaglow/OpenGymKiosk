// Per-device conveniences in localStorage: a workout in progress (so a reload or a crash on the
// iPad does not lose it) and the simulated-sensor switch. Every access is guarded: Safari can
// refuse storage, and the kiosk must work without it.

const read = key => { try { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v) } catch { return null } }
const write = (key, v) => { try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage refused */ } }

export const savedActive = pid => read('gk.active.' + pid)
export const saveActive = (pid, active) => write('gk.active.' + pid, active)

export const simEnabled = () => read('gk.sim') !== false
export const setSimEnabled = on => write('gk.sim', on)
