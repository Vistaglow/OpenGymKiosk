// Run with `node --test` from web/ once src/og holds openGym's lib (the Docker build does this).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startSession, completeSet, setWeight, nextSet, progressOf, finishSession, todayPlan, exerciseName } from './session.js'
import { repLine, setIntro, restLine, fixedLines } from './lines.js'

// A small profile in openGym's shape: one routine with bench press (id 0025) twice a week.
const profile = () => ({
  unit: 'kg', restSec: 90, exWeights: {}, workouts: [], customEx: [],
  routines: [{ id: 'r1', name: 'Push Day', emoji: '', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }],
  week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' },
})

test('today is the routine openGym schedules for it', () => {
  const plan = todayPlan(profile())
  assert.deepEqual(plan.routines.map(r => r.name), ['Push Day'])
  assert.equal(plan.doneIds.size, 0)
})

test('a session starts with the prescribed sets', () => {
  const a = startSession(profile(), ['r1'])
  assert.equal(a.name, 'Push Day')
  assert.equal(a.entries.length, 1)
  assert.equal(a.entries[0].sets.length, 3)
  assert.equal(a.entries[0].sets[0].w, 60)
  assert.equal(a.entries[0].sets[0].r, 5)
  assert.deepEqual(nextSet(a), { ei: 0, si: 0 })
  assert.equal(exerciseName('0025'), 'Barbell Bench Press')
})

test('ticking a set logs the counted reps and leaves the original alone', () => {
  const a = startSession(profile(), ['r1'])
  const b = completeSet(a, 0, 0, { r: 7 }, 1000)
  assert.equal(a.entries[0].sets[0].done, false)
  assert.deepEqual({ ...b.entries[0].sets[0] }, { ...a.entries[0].sets[0], done: true, at: 1000, r: 7 })
  assert.deepEqual(nextSet(b), { ei: 0, si: 1 })
  assert.deepEqual(progressOf(b), { done: 1, total: 3 })
})

test('a weight change carries to the later sets that had the same weight', () => {
  const a = completeSet(startSession(profile(), ['r1']), 0, 0, { r: 5 })
  const b = setWeight(a, 0, 1, 62.5)
  assert.deepEqual(b.entries[0].sets.map(s => s.w), [60, 62.5, 62.5])
})

test('finishing saves the workout the way openGym does, with a first-time record', () => {
  const S = profile()
  let a = startSession(S, ['r1'], 1000)
  for (let i = 0; i < 3; i++) a = completeSet(a, 0, i, { r: 5 }, 2000 + i * 60000)
  const { state, workout, prs } = finishSession(S, a, 300000)
  assert.equal(S.workouts.length, 0, 'the profile passed in is untouched')
  assert.equal(state.workouts.length, 1)
  assert.equal(state.active, null)
  assert.equal(workout.name, 'Push Day')
  assert.equal(workout.entries[0].sets.filter(s => s.done).length, 3)
  assert.ok(workout.vol > 0)
  assert.deepEqual(prs, ['0025'])
  assert.equal(state.exWeights['0025'].w, 60)
})

test('the next session starts from what the last one did', () => {
  const S = profile()
  let a = startSession(S, ['r1'], 1000)
  for (let i = 0; i < 3; i++) a = completeSet(a, 0, i, { r: 5 }, 2000 + i * 60000)
  const after = finishSession(S, a, 300000).state
  const next = startSession(after, ['r1'], Date.now())
  assert.ok(next.entries[0].sets[0].w >= 60, 'progression never goes down after a full session')
})

test('the coach counts, then counts down the last three', () => {
  const one = () => 0
  assert.equal(repLine(1, 8, one), 'One')
  assert.equal(repLine(5, 8, one), 'Three more!')
  assert.equal(repLine(7, 8, one), 'Last one!')
  assert.equal(repLine(8, 8, one), 'Done! Great set.')
  assert.equal(repLine(9, 8, one), 'Bonus rep!')
  assert.equal(setIntro({ setNo: 2, sets: 4, reps: 8, w: 40, unit: 'lb' }), 'Set two of four. Eight reps at 40 pounds.')
  assert.equal(restLine(90), 'Rest 90 seconds.')
  assert.equal(restLine(120), 'Rest two minutes.')
  assert.ok(fixedLines().length > 30)
})
