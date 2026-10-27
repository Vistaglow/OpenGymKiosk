// Counts reps from the height of a weight stack. Plain C++ with no Arduino calls, so the same
// code runs on the ESP32 and in rep_detector_test.cpp on a computer.
//
// A rep is one up-and-down: the stack rises at least `moveMm` from its lowest point, then comes
// back down at least `moveMm` from its highest. It is counted on the way down, wherever the stack
// turns around, so a rep counts whether or not the plates touch down in between, and on short-travel
// stations too (a 2:1 pulley moves the stack half as far as the handle).
//
// Not reps: a swing smaller than `moveMm` (sensor noise, a bumped cable), anything faster than
// `minRepMs` up and down, and a swing bigger than `maxTravelMm`, which no stack makes (a hand or a
// head in the beam).

#ifndef REP_DETECTOR_H
#define REP_DETECTOR_H

struct RepDetector {
  float moveMm = 50;               // how far the stack must move each way
  float maxTravelMm = 800;         // more than this is not the stack
  unsigned long minRepMs = 400;    // a full up-and-down faster than this is noise
  float smoothing = 0.5f;          // 0..1: how quickly the smoothed height follows a reading

  // Feed one height reading in mm (bigger = stack higher). True when a rep has just completed.
  bool update(float heightMm, unsigned long nowMs) {
    if (!started) {
      started = true;
      smoothed = low = high = heightMm;
      return false;
    }
    smoothed += smoothing * (heightMm - smoothed);
    if (!rising) {
      if (smoothed < low) low = smoothed;
      if (smoothed - low >= moveMm) {
        rising = true;
        high = smoothed;
        riseFrom = low;
        riseAt = nowMs;
      }
      return false;
    }
    if (smoothed > high) high = smoothed;
    if (high - smoothed < moveMm) return false;
    // Turned around and came back down far enough: one up-and-down.
    rising = false;
    low = smoothed;
    float travel = high - riseFrom;
    return travel <= maxTravelMm && nowMs - riseAt >= minRepMs;
  }

  // Forget the movement in progress (the sensor lost the stack for a while).
  void reset() { started = false; rising = false; }

  bool lifting() const { return rising; }

 private:
  bool started = false;
  bool rising = false;
  float smoothed = 0, low = 0, high = 0, riseFrom = 0;
  unsigned long riseAt = 0;
};

#endif
