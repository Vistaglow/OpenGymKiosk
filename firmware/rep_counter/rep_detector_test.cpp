// Tests for rep_detector.h with simulated stack movements. Run on a computer:
//   c++ -std=c++11 -o /tmp/rep_test rep_detector_test.cpp && /tmp/rep_test

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include "rep_detector.h"

static int failures = 0;
static void expect(const char* name, int got, int want) {
  std::printf("%-58s %s (got %d, want %d)\n", name, got == want ? "ok  " : "FAIL", got, want);
  if (got != want) failures++;
}

// The stack's height over time, sampled every 50 ms (the sensor's rate), with optional noise.
// Each rep: `up` ms rising by `travel` mm, `down` ms lowering to `bottom` mm, then `pause` ms.
static int run(int reps, float travel, int up, int down, int pause, float bottom = 0,
               float noise = 0, RepDetector d = RepDetector()) {
  std::srand(7);
  int counted = 0;
  unsigned long t = 0;
  auto feed = [&](float h) {
    float n = noise ? noise * ((std::rand() % 2001) / 1000.0f - 1) : 0;
    if (d.update(h + n, t)) counted++;
    t += 50;
  };
  for (int i = 0; i < 20; i++) feed(0);  // at rest before the set
  for (int r = 0; r < reps; r++) {
    float from = r == 0 ? 0 : bottom;
    for (int ms = 0; ms < up; ms += 50) feed(from + (travel - from) * ms / up);
    for (int ms = 0; ms < down; ms += 50) feed(travel - (travel - bottom) * ms / down);
    for (int ms = 0; ms < pause; ms += 50) feed(bottom);
  }
  for (int ms = 0; ms < 2000; ms += 50) feed(0);  // set down after the set
  return counted;
}

int main() {
  expect("10 reps, 40 cm, touching down", run(10, 400, 1000, 1500, 300), 10);
  expect("8 reps, never touching down (stays 15 cm up)", run(8, 400, 900, 1200, 0, 150), 8);
  expect("12 reps, short travel 12 cm (2:1 pulley)", run(12, 120, 700, 900, 100), 12);
  expect("10 reps with +-8 mm sensor noise", run(10, 300, 1000, 1200, 200, 0, 8), 10);
  expect("fast reps, 0.4 s up / 0.4 s down", run(10, 250, 400, 400, 0), 10);
  expect("partial reps under 5 cm are not counted", run(6, 35, 600, 600, 200), 0);
  expect("noise alone (+-15 mm at rest) is not a rep", run(0, 0, 0, 0, 0, 0, 15), 0);

  // A hand in the beam: the reading jumps a metre up and back.
  {
    RepDetector d;
    int counted = 0;
    unsigned long t = 0;
    for (int i = 0; i < 20; i++, t += 50) counted += d.update(0, t);
    for (int i = 0; i < 20; i++, t += 50) counted += d.update(1000, t);
    for (int i = 0; i < 20; i++, t += 50) counted += d.update(0, t);
    expect("a hand in the beam (1 m jump) is not a rep", counted, 0);
  }
  // A bump: up and down 8 cm in a quarter of a second.
  {
    RepDetector d;
    int counted = 0;
    unsigned long t = 0;
    for (int i = 0; i < 20; i++, t += 50) counted += d.update(0, t);
    counted += d.update(80, t); t += 50;
    counted += d.update(80, t); t += 50;
    for (int i = 0; i < 20; i++, t += 50) counted += d.update(0, t);
    expect("a quick bump (0.1 s, 8 cm) is not a rep", counted, 0);
  }

  std::printf(failures ? "\n%d FAILED\n" : "\nall passed\n", failures);
  return failures ? 1 : 0;
}
