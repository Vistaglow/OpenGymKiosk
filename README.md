# Gym kiosk

A wall-mounted iPad app for openGym. Someone walks up, taps their name, and gets today's workout
from openGym with the weights openGym prescribes. A sensor over the home gym's weight stack
counts their reps, a phonon voice counts down the last few and calls the rests, and the
finished workout is saved back into openGym as if it had been logged on their phone.

```
 iPad (Safari, home-screen app)
   │  http://192.168.1.138:8090
   ▼
 gym-kiosk container ──── api:3000  openGym API   (pairing, read & save each person's data)
   │  ▲                ── web:80    openGym web   (exercise animations)
   │  └─ POST /sensor/rep  ESP32 + VL53L1X over the weight stack
   └──── host.docker.internal:11434  Ollama / phonon (speech, cached in data/tts-cache)
```

openGym is not changed. The kiosk joins openGym's Docker network and uses openGym's own
pairing, the way the openGym phone app does. To start and finish a workout it imports openGym's
own code (`opengym/frontend/src/lib`), so prescriptions, records and progression match what the
app would do. The build runs the kiosk's tests against that code, so an openGym update that
breaks something fails the build instead of failing on the wall.

## Run it

```bash
cd ~/docker/hawser-stacks/gym-kiosk
cp .env.example .env    # then set KIOSK_KEY and SENSOR_TOKEN (openssl rand -hex 24)
docker compose up -d --build
```

openGym must already be running, because the kiosk joins its `opengym_default` network. Ollama
must be running on the Mac for the phonon voice. Without it, the iPad's own voice takes over.

After you `git pull` openGym, run `docker compose up -d --build` here as well, so the kiosk
picks up openGym's latest training logic.

## Set up the iPad

1. **Enrol Safari.** In Safari, open `http://192.168.1.138:8090/enroll?key=<KIOSK_KEY>` once.
   Changing `KIOSK_KEY` signs every device out.
2. **Add to Home Screen** (Share → Add to Home Screen) and open the kiosk from that icon from
   now on: it runs full screen. iOS gives a Home Screen app its own sign-in, separate from
   Safari's, so it asks to be set up again: in Safari, open **Setup → Add a device** and type
   the 6-digit code into the icon's screen. Codes work once, for 10 minutes; the full key works
   in that field too. Another screen is set up the same way.
3. **Keep the screen on.** Settings → Display & Brightness → Auto-Lock → **Never**. The app
   asks for a wake lock too, but Safari only grants one over HTTPS.
4. **Lock it to the app.** Settings → Accessibility → Guided Access → On, then triple-click
   the side button inside the app.
5. **Turn the volume up.** iOS plays sound only after a tap; tapping a profile counts.

## Add people

Each person pairs once:

1. On their phone or computer, open openGym → **Settings → Account → Pair the mobile app**.
2. On the kiosk: **Setup → Add a person** and type the 8-letter code (it lasts 5 minutes).
3. Pick their coach voice and tap **Hear it**. phonon has 38 voices, from *Captain Silas
   Blackwater* to *Grub the Ogre*.

Each person's openGym token is kept in `data/profiles.json` on the Mac (readable by the owner
only) and never reaches the iPad. Remove someone in Setup. Signing out everywhere in openGym
(Settings → Account) also cuts the kiosk off for that person.

## During a workout

- **Counting:** each rep from the sensor counts up. The voice says the number, then "three
  more", "two more", "last one", and "done". Once the target is reached and the stack has
  been still for 6 seconds, the set saves itself and the rest timer starts.
- **Off the machine:** dumbbells, free plates and bodyweight exercises don't move the stack,
  so nothing is counted. Use **+ rep / − rep** and **Done set**.
- **Below the target:** tap **Done set** to log what was counted. Use **+ rep / − rep** to
  correct a miscount and **− / +** to change the weight. A weight change carries over to the
  remaining sets that had the same weight.
- **Rest:** the voice calls the rest, warns at ten seconds, and introduces the next set. A rep
  during rest ends it and starts the next set.
- **Exercises:** tap any exercise in the left-hand list to do it next.
- **Finish & save:** saves the workout to openGym. If someone's phone saved to openGym in the
  meantime, the kiosk merges onto that newer copy, so neither change is lost. Until the save
  succeeds, the workout is kept on the iPad.
- **Exit → Keep for later:** keeps the workout on this iPad to resume from that person's screen.
- **Timed and cardio exercises** have no rep counting. Tap **Done set** when finished.

## No sensor yet: the simulated sensor

**Setup → Rep sensor** has a switch for a **Fake rep** button on the workout screen (on by
default). A fake rep goes to the kiosk server and comes back over the same live connection a
real rep uses, so it tests the whole path. From the Mac:

```bash
scripts/sim-sensor.sh          # 8 reps, 2 s apart
scripts/sim-sensor.sh 5 1.5    # 5 reps, 1.5 s apart
```

On a computer, the space bar is also one rep.

## The rep sensor

Built for a multi-station home gym with one weight stack: every station (press arm, pulldown,
low row, leg extension and so on) lifts the same stack, so one sensor over it counts reps for all
of them. `firmware/rep_counter/` targets an ESP32 dev board with a VL53L1X distance sensor
(about $15–25 together):

| VL53L1X | ESP32   |
|---------|---------|
| VIN     | 3V3     |
| GND     | GND     |
| SDA     | GPIO 21 |
| SCL     | GPIO 22 |

**Mounting.** Put the sensor at the top of the stack's frame, pointing straight down at the top
plate, beside the cable and the guide rods rather than on them. 0.5–2 m above the plate at rest
is fine. Screw or clamp it and route the cable away from moving parts: it sits above people.

**Flashing.** Fill in Wi-Fi, `KIOSK_URL` and `SENSOR_TOKEN` (from `.env`) at the top of
`rep_counter.ino`. Install the Pololu **VL53L1X** library, then flash with the board set to
"ESP32 Dev Module". Keep `rep_detector.h` in the same folder.

**How a rep is counted** (`rep_detector.h`): the stack going up at least 5 cm and coming back
down at least 5 cm, wherever it turns around. So a rep counts whether or not the plates touch
down between reps, and short-travel stations count too (a 2:1 pulley moves the stack half as far
as the handle). There is nothing to calibrate. Not counted: movement under 5 cm, a bump faster
than 0.4 s, and a swing over 80 cm (a hand or a head in the beam). Settings at the top of the
sketch:

- `STACK_MOVE_MM`: lower it if a short-travel station misses reps, raise it if small jiggles count.
- `VIEW_SIZE`: narrows the sensor's view (8 = about 15°) so it sees the plate, not the frame.
  Go lower if readings jump around while the stack is still.

The board checks in every 10 s; the green dot on the kiosk shows it is connected. A rep that
does not get through is retried with the same id, so it is never counted twice. Open the
Arduino Serial Monitor at 115200 to see each rep as it is counted.

To test the counting on a computer:

```bash
cd firmware/rep_counter && c++ -std=c++11 -o /tmp/rep_test rep_detector_test.cpp && /tmp/rep_test
```

## Files

| Path | What it is |
|------|------------|
| `server/server.js` | The kiosk server: enrolment, pairing, openGym proxy, speech, rep relay. No dependencies. |
| `server/wav.js` | Fixes the sizes in phonon's streamed WAV header, which Safari would refuse. |
| `firmware/rep_counter/` | The ESP32 sketch, its rep counting (`rep_detector.h`) and that code's tests. |
| `web/src/session.js` | Start and finish a workout with openGym's code (mirrors openGym's `beginWorkout` / `doFinishWorkout`). |
| `web/src/workout-state.js` | The workout screen's state machine: counting, auto-save, rest. |
| `web/src/lines.js` | What the coach says. |
| `web/src/voice.js` | Plays phonon clips through Web Audio, with the iPad's own voice as the fallback. |
| `data/` | `profiles.json` (pairing tokens) and `tts-cache/`. Not in git; back it up if you like. |

Tests: `npm test` in `web/` (needs `web/src/og`, a copy of `opengym/frontend/src/lib`) and in
`server/`. The Docker build runs both.

## Notes

- **Plain HTTP on the LAN.** Tokens never leave the Mac, but the kiosk cookie and workout data
  cross your Wi-Fi unencrypted. To add HTTPS, put the kiosk behind the Synology reverse proxy
  with a certificate. The cookie switches to Secure on its own, and the screen wake lock starts
  working.
- **Dockhand.** This stack is not managed by Dockhand; it runs with `docker compose` from this
  folder. To adopt it in Dockhand later, point a stack at this folder's `docker-compose.yml`.
- **Speech cache.** About 0.3 s to make a line the first time, then instant. The common lines
  for a person's voice are made when they tap their profile. Up to 4000 clips are kept.
