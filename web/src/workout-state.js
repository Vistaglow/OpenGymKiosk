// The workout screen's state machine, kept pure so it can be tested without a browser.
//
//   ready ──rep──▶ lifting ──complete──▶ rest ──time up / skip──▶ ready
//                     ▲                    │
//                     └──────── rep ───────┘   (a rep during rest starts the next set early)
//
// After the last set the phase is 'done'. Anything the coach should say is a `cue`, numbered so
// the screen speaks each one once; the words themselves come from lines.js.

import { completeSet, setWeight, nextSet, setDone, entryMode } from './session.js'

// Seconds after the last rep, once the target is reached, before the set ticks itself off.
export const AUTO_COMPLETE_MS = 6000

/** The set being worked: the first undone one of the exercise in focus, else the first undone. */
export function currentPos(active, focus) {
  if (focus != null) {
    const si = (active.entries[focus]?.sets || []).findIndex(s => !setDone(s))
    if (si >= 0) return { ei: focus, si }
  }
  return nextSet(active)
}

export function initialState(active) {
  return {
    active, focus: null,
    phase: nextSet(active) ? 'ready' : 'done',
    count: 0, lastRepAt: null, restEnd: null, rest10: false,
    cue: { kind: 'intro', n: 1 },
  }
}

export function reducer(st, a) {
  const pos = currentPos(st.active, st.focus)
  const cue = (kind, extra = {}) => ({ kind, n: (st.cue?.n || 0) + 1, ...extra })
  switch (a.type) {
    case 'rep': {
      if (!pos || st.phase === 'done') return st
      const e = st.active.entries[pos.ei]
      if (entryMode(e) !== 'reps') return st
      const count = (st.phase === 'rest' ? 0 : st.count) + 1
      return { ...st, phase: 'lifting', count, lastRepAt: a.now, restEnd: null, cue: cue('rep', { count, target: e.sets[pos.si].r || 0 }) }
    }
    case 'adjust': {
      if (!pos || st.phase === 'done') return st
      const count = Math.max(0, st.count + a.delta)
      return { ...st, count, phase: count ? 'lifting' : 'ready', restEnd: null, lastRepAt: a.now ?? st.lastRepAt }
    }
    case 'complete': {
      if (!pos) return st
      const e = st.active.entries[pos.ei]
      const r = entryMode(e) === 'reps' && st.count > 0 ? st.count : undefined
      const active = completeSet(st.active, pos.ei, pos.si, { r }, a.now)
      const next = currentPos(active, st.focus)
      const focus = next && next.ei === pos.ei ? st.focus : null
      const base = { ...st, active, focus, count: 0, lastRepAt: null, rest10: false }
      if (!next) return { ...base, phase: 'done', restEnd: null, cue: cue('allDone') }
      return { ...base, phase: 'rest', restEnd: a.now + a.restSec * 1000, cue: cue('rest', { sec: a.restSec }) }
    }
    case 'tick': {
      if (st.phase !== 'rest') return st
      const left = st.restEnd - a.now
      if (left <= 0) return { ...st, phase: 'ready', restEnd: null, cue: cue('go') }
      if (left <= 10000 && !st.rest10) return { ...st, rest10: true, cue: cue('ten') }
      return st
    }
    case 'skipRest':
      return st.phase === 'rest' ? { ...st, phase: 'ready', restEnd: null, cue: cue('go') } : st
    case 'addRest':
      return st.phase === 'rest' ? { ...st, restEnd: st.restEnd + a.sec * 1000, rest10: st.rest10 && st.restEnd + a.sec * 1000 - a.now <= 10000 } : st
    case 'weight':
      return pos ? { ...st, active: setWeight(st.active, pos.ei, pos.si, a.w) } : st
    case 'focus': {
      if (a.ei === pos?.ei) return st
      const has = (st.active.entries[a.ei]?.sets || []).some(s => !setDone(s))
      if (!has) return st
      return { ...st, focus: a.ei, count: 0, lastRepAt: null, phase: 'ready', restEnd: null, cue: cue('intro') }
    }
    default:
      return st
  }
}

/** When the current set should tick itself off, or null: once the target is reached and the bar is still. */
export function autoCompleteAt(st) {
  if (st.phase !== 'lifting' || !st.lastRepAt) return null
  const pos = currentPos(st.active, st.focus)
  const target = pos ? st.active.entries[pos.ei].sets[pos.si].r : 0
  return target > 0 && st.count >= target ? st.lastRepAt + AUTO_COMPLETE_MS : null
}
