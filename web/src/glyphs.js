// A routine's icon. openGym stores an icon key in `routine.emoji` ('barbell', 'legs', …) and draws
// its own SVG for it (openGym's lib/glyphs.js and components/Icon.jsx); routines from before
// that store a real emoji. The kiosk shows an emoji for each key, which every iPad can draw.

const EMOJI = {
  figureStrength: '🏋️', arm: '💪', abs: '🔥', legs: '🦵', pullup: '🧗',
  dumbbell: '🏋️', barbell: '🏋️', kettlebell: '🏋️', plate: '🏋️', machine: '⚙️',
  figureRun: '🏃', bike: '🚴', swim: '🏊', boxing: '🥊', timer: '⏱️',
  stretch: '🧘', moon: '🌙', heart: '❤️', flame: '🔥', bolt: '⚡',
  trophy: '🏆', medal: '🥇', crown: '👑', flag: '🚩', star: '⭐', target: '🎯', shield: '🛡️',
}

/** The emoji for a routine, or '' when it has none or an unknown key. */
export function routineEmoji(routine) {
  const v = routine?.emoji
  if (!v || typeof v !== 'string') return ''
  if (EMOJI[v]) return EMOJI[v]
  // A legacy routine's own emoji: anything that is not a plain word.
  return /^[\w-]+$/.test(v) ? '' : v
}
