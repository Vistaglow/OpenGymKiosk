// What the voice coach says. Pure: each function returns the words, and the page decides when
// to say them. Every fixed line is listed in fixedLines() so the server can have them all
// spoken and cached before the first set, and a count never waits for phonon.

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const word = n => (n >= 0 && n < NUM.length ? NUM[n] : String(n))
const Cap = s => s.charAt(0).toUpperCase() + s.slice(1)

const POOLS = {
  three: ['Three more!', 'Three to go!', 'Three left, stay tight!'],
  two: ['Two more!', 'Two to go!', 'Two left, drive it!'],
  last: ['Last one!', 'Last one, push!', 'One more, make it count!'],
  done: ['Done! Great set.', 'Done! Nice work.', 'That’s the set. Well done!'],
  bonus: ['Bonus rep!', 'Extra credit!'],
  go: ['Let’s go!', 'Back to it!', 'Time to work!'],
}
const pick = (pool, rnd = Math.random) => pool[Math.floor(rnd() * pool.length) % pool.length]

const units = (w, unit) => `${w % 1 ? w : Math.round(w)} ${unit === 'lb' ? (w === 1 ? 'pound' : 'pounds') : (w === 1 ? 'kilo' : 'kilos')}`

/** The line for the rep just counted. Counting down the last three, the number before that. */
export function repLine(count, target, rnd) {
  if (!target || count < target - 3) return Cap(word(count))
  const left = target - count
  if (left === 3) return pick(POOLS.three, rnd)
  if (left === 2) return pick(POOLS.two, rnd)
  if (left === 1) return pick(POOLS.last, rnd)
  if (left === 0) return pick(POOLS.done, rnd)
  return pick(POOLS.bonus, rnd)
}

export function setIntro({ setNo, sets, reps, w, unit, warmup }) {
  const what = reps ? `${word(reps)} reps` : 'your set'
  const load = w > 0 ? ` at ${units(w, unit)}` : ''
  return `${warmup ? 'Warm-up' : `Set ${word(setNo)} of ${word(sets)}`}. ${Cap(what)}${load}.`
}

export function exerciseIntro({ name, sets, reps }) {
  return `Next up, ${name}. ${Cap(word(sets))} ${sets === 1 ? 'set' : 'sets'}${reps ? ` of ${word(reps)}` : ''}.`
}

export const restLine = sec => `Rest ${sec >= 60 && sec % 60 === 0 ? `${word(sec / 60)} ${sec === 60 ? 'minute' : 'minutes'}` : `${word(sec)} seconds`}.`
export const tenSeconds = () => 'Ten seconds.'
export const goLine = rnd => pick(POOLS.go, rnd)

export function welcome(name, routineName) {
  return routineName ? `Hey ${name}! Today is ${routineName}.` : `Hey ${name}! Pick a workout.`
}

export function finishLine(name, prNames) {
  const pr = prNames.length === 1 ? ` New personal best on ${prNames[0]}!`
    : prNames.length > 1 ? ` ${Cap(word(prNames.length))} new personal bests!` : ''
  return `Workout saved. Great job, ${name}!${pr}`
}

/** Every line that does not depend on the workout, for the cache. */
export function fixedLines(maxCount = 20) {
  const out = []
  for (let n = 1; n <= maxCount; n++) out.push(Cap(word(n)))
  for (const pool of Object.values(POOLS)) out.push(...pool)
  out.push(tenSeconds())
  return out
}
