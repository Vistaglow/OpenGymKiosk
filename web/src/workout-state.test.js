import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startSession } from './session.js'
import { initialState, reducer, autoCompleteAt, currentPos, AUTO_COMPLETE_MS } from './workout-state.js'

const profile = () => ({
  unit: 'kg', restSec: 90, workouts: [],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 2, reps: 3, weight: 50 }, { id: '0025', sets: 1, reps: 3, weight: 40 }] }],
})
const run = (st, ...actions) => actions.reduce(reducer, st)

test('reps count up and the set ticks itself off once the target is reached', () => {
  let st = initialState(startSession(profile(), ['r1']))
  st = run(st, { type: 'rep', now: 1000 }, { type: 'rep', now: 2000 }, { type: 'rep', now: 3000 })
  assert.equal(st.phase, 'lifting')
  assert.equal(st.count, 3)
  assert.equal(st.cue.kind, 'rep')
  assert.equal(autoCompleteAt(st), 3000 + AUTO_COMPLETE_MS)
  st = reducer(st, { type: 'complete', now: 9000, restSec: 90 })
  assert.equal(st.phase, 'rest')
  assert.equal(st.active.entries[0].sets[0].r, 3)
  assert.equal(st.active.entries[0].sets[0].done, true)
  assert.deepEqual(currentPos(st.active, st.focus), { ei: 0, si: 1 })
})

test('no auto tick below the target', () => {
  let st = initialState(startSession(profile(), ['r1']))
  st = run(st, { type: 'rep', now: 1000 })
  assert.equal(autoCompleteAt(st), null)
})

test('rest counts down, warns at ten seconds, then the next set is ready', () => {
  let st = initialState(startSession(profile(), ['r1']))
  st = run(st, { type: 'complete', now: 0, restSec: 30 })
  assert.equal(st.active.entries[0].sets[0].r, 3, 'a set ticked with no reps counted keeps the prescription')
  st = reducer(st, { type: 'tick', now: 10000 })
  assert.equal(st.cue.kind, 'rest')
  st = reducer(st, { type: 'tick', now: 21000 })
  assert.equal(st.cue.kind, 'ten')
  st = reducer(st, { type: 'tick', now: 30000 })
  assert.equal(st.phase, 'ready')
  assert.equal(st.cue.kind, 'go')
})

test('a rep during rest starts the next set', () => {
  let st = initialState(startSession(profile(), ['r1']))
  st = run(st, { type: 'complete', now: 0, restSec: 90 }, { type: 'rep', now: 5000 })
  assert.equal(st.phase, 'lifting')
  assert.equal(st.count, 1)
  assert.equal(st.restEnd, null)
})

test('the last set ends the session', () => {
  let st = initialState(startSession(profile(), ['r1']))
  for (let i = 0; i < 3; i++) st = reducer(st, { type: 'complete', now: i, restSec: 90 })
  assert.equal(st.phase, 'done')
  assert.equal(st.cue.kind, 'allDone')
})

test('jumping to another exercise works its first open set', () => {
  let st = initialState(startSession(profile(), ['r1']))
  st = reducer(st, { type: 'focus', ei: 1 })
  assert.deepEqual(currentPos(st.active, st.focus), { ei: 1, si: 0 })
  st = reducer(st, { type: 'complete', now: 0, restSec: 90 })
  assert.deepEqual(currentPos(st.active, st.focus), { ei: 0, si: 0 }, 'back to the first open set after it')
})
