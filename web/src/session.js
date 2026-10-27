// The kiosk's workout logic: a thin layer over openGym's own helpers (./og is openGym's
// frontend/src/lib, copied in at build time), so a session started and finished here is the one
// openGym would have made. Starting mirrors beginWorkout and finishing mirrors doFinishWorkout,
// both in openGym's frontend/src/sheets.jsx. Pure functions only: nothing here touches the page.

import { todayISO, uid } from './og/format.js'
import { effectiveRoutines, effectiveRoutineIds, bestWeightFor, bestWeightForEntry, workoutVolume, modeOf } from './og/history.js'
import { buildCombinedEntries, deriveSessionName } from './og/session-merge.js'
import { buildCompletedWorkout, sessionEnd } from './og/finish-workout.js'
import { EXIDX, registerCustom, isCustomEx, beatsWeight, betterWeight, gifSrc, imgSrc, figureOf } from './og/exercises.js'
import { exerciseMuscleSnapshot } from './og/muscles.js'
import { is1RMRecord } from './og/onerm.js'
import { entryDbLoad } from './og/dumbbells.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './og/workout-model.js'
import { refillAfter } from './og/rotation.js'

// openGym reads a profile through its defaults (DEF in its store/useStore.js), and its helpers
// count on the containers being there. These are the empty ones of those defaults; settings are
// read through the helpers below, each with openGym's default.
const EMPTY = { bodyweight: [], routines: [], week: {}, dayPlan: {}, dayNotes: {}, exWeights: {}, workouts: [], customEx: [], hints: {} }

// openGym registers a profile's custom exercises before reading anything; so does the kiosk,
// every time it switches person. Fills in missing containers in place.
export function prepare(S) {
  for (const [k, v] of Object.entries(EMPTY)) if (S[k] == null) S[k] = structuredClone(v)
  registerCustom(S.customEx)
  return S
}

const cap = s => s.replace(/\b\p{L}/gu, c => c.toUpperCase())
export const exerciseName = id => cap(EXIDX[id]?.n || 'Exercise')

// The animation and still for a built-in exercise, served through the kiosk from openGym's web
// container. A custom exercise's own photos live behind openGym's media API; none in v1.
export function mediaFor(S, id) {
  const ex = EXIDX[id]
  if (!ex || isCustomEx(ex) || !ex.gif) return null
  const fig = figureOf(S)
  return { clip: '/' + gifSrc(ex, fig), still: '/' + imgSrc(ex, fig) }
}

export const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg')
export const weightStep = S => (unitOf(S) === 'lb' ? 5 : 2.5)
export const restSecOf = S => (Number(S?.restSec) > 0 ? Number(S.restSec) : 90)

/** What today holds: openGym's own pick for the day, which of it is done, and every routine. */
export function todayPlan(S, iso = todayISO()) {
  prepare(S)
  const routines = effectiveRoutines(S, iso)
  const routineIds = effectiveRoutineIds(S, iso)
  const logged = (S.workouts || []).filter(w => w.d === iso)
  const doneIds = new Set(logged.flatMap(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId])).filter(Boolean))
  return { routines, routineIds, doneIds, all: S.routines || [] }
}

/** A new session from routines, prescription applied, as openGym's beginWorkout builds it. */
export function startSession(S, routineIds, now = Date.now()) {
  prepare(S)
  const { entries, routineIds: rids, routines } = buildCombinedEntries(S, routineIds)
  return {
    id: uid(), d: todayISO(), start: now, routineIds: rids,
    name: routines.length ? deriveSessionName(routines.map(r => r.name)) : 'Freestyle',
    bw: null, cur: 0, entries,
    workoutView: S.workoutView || 'cards',
  }
}

/** 'reps', 'time' or 'cardio'. Only reps are counted by the sensor. */
export const entryMode = e => modeOf(e?.target || e)

export const setDone = s => (isSideSet(s) ? s.sides.L.done === true && s.sides.R.done === true : s.done === true)
export const isWarmup = isWarmupRow

/** The first set not yet done, or null when the session is complete. */
export function nextSet(active) {
  for (let ei = 0; ei < active.entries.length; ei++) {
    const sets = active.entries[ei].sets || []
    for (let si = 0; si < sets.length; si++) if (!setDone(sets[si])) return { ei, si }
  }
  return null
}

/** How many sets are done and how many there are. */
export function progressOf(active) {
  let done = 0, total = 0
  for (const e of active.entries) for (const s of e.sets || []) { total++; if (setDone(s)) done++ }
  return { done, total }
}

/**
 * Tick one set off. `r` and `w` are what was lifted; left out, the set keeps what was prescribed.
 * Returns a new session; the one passed in is not changed. A one-side-at-a-time set is ticked on
 * both sides with the same numbers.
 */
export function completeSet(active, ei, si, { r, w } = {}, now = Date.now()) {
  const a = structuredClone(active)
  const s = a.entries[ei].sets[si]
  const lifted = { done: true, at: now, ...(Number.isFinite(r) ? { r } : {}), ...(Number.isFinite(w) ? { w } : {}) }
  if (isSideSet(s)) {
    s.sides.L = { ...s.sides.L, ...lifted }
    s.sides.R = { ...s.sides.R, ...lifted }
    a.entries[ei].sets[si] = syncSideAggregate(s)
  } else Object.assign(s, lifted)
  a.cur = ei
  return a
}

/** Change the weight of a set not yet done, and of the sets after it that had the same weight. */
export function setWeight(active, ei, si, w) {
  const a = structuredClone(active)
  const sets = a.entries[ei].sets
  const from = sets[si].w
  for (let i = si; i < sets.length; i++) {
    if (setDone(sets[i]) || isWarmupRow(sets[i]) !== isWarmupRow(sets[si])) continue
    if (i > si && sets[i].w !== from) break
    sets[i] = isSideSet(sets[i])
      ? syncSideAggregate({ ...sets[i], sides: { L: { ...sets[i].sides.L, w }, R: { ...sets[i].sides.R, w } } })
      : { ...sets[i], w }
  }
  return a
}

/**
 * The profile with this session saved into it, as openGym's doFinishWorkout saves it: records
 * held against the history before it, the completed workout appended, best weights moved on,
 * and a rotation's next pass started. Pure, so after a 409 it is simply run again on the
 * server's newer copy.
 */
export function finishSession(S0, active, now = Date.now()) {
  const st = prepare(structuredClone(S0))
  const A = structuredClone(active)
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const loads = e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w).filter(w => w > 0)
    const mx = loads.length ? loads.reduce((a, b) => betterWeight(e.id, a, b)) : 0
    if (beatsWeight(e.id, mx, bestWeightFor(st, e.id, entryDbLoad(e)))) prs.push(e.id)
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = buildCompletedWorkout(A, {
    end: sessionEnd(A, now),
    prs,
    snapshotFor: e => (isCustomEx(EXIDX[e.id]) ? exerciseMuscleSnapshot(EXIDX[e.id]) : null),
  })
  w.vol = workoutVolume(w)
  st.exWeights = st.exWeights || {}
  w.entries.forEach(e => {
    const mx = bestWeightForEntry(e)
    if (mx > 0 && beatsWeight(e.id, mx, (st.exWeights[e.id] || {}).w || 0)) st.exWeights[e.id] = { w: mx, d: w.d }
  })
  st.workouts = [...(st.workouts || []), w]
  st.active = null
  refillAfter(st, w, todayISO(), now)
  return { state: st, workout: w, prs, e1prs }
}
