// Weight-stack rep counter for the gym kiosk.
//
// For a multi-station home gym with one weight stack: every station lifts the same stack, so one
// sensor over it counts reps for all of them.
//
// Hardware: an ESP32 dev board and a VL53L1X time-of-flight distance sensor (I2C).
//   VL53L1X VIN -> 3V3, GND -> GND, SDA -> GPIO 21, SCL -> GPIO 22
// Mount the sensor at the top of the stack's frame, pointing straight down at the top plate, beside
// the cable and the guide rods rather than on them. Screw or clamp it: it sits above people.
//
// Libraries (Arduino IDE -> Library Manager): "VL53L1X" by Pololu.
// Board: "ESP32 Dev Module" (Espressif's esp32 board package).
//
// The counting itself is in rep_detector.h (tested by rep_detector_test.cpp): one rep is the stack
// going up and coming back down, wherever it turns around, so reps count whether or not the plates
// touch down between them. Each rep is sent to the kiosk at once; the kiosk counts per set.

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <VL53L1X.h>
#include "rep_detector.h"

// ---- fill these in ---------------------------------------------------------
const char* WIFI_SSID    = "your-wifi";
const char* WIFI_PASS    = "your-wifi-password";
const char* KIOSK_URL    = "http://192.168.1.138:8090";   // the Mac running the kiosk
const char* SENSOR_TOKEN = "paste SENSOR_TOKEN from the kiosk's .env";
// ---------------------------------------------------------------------------

// Tuning. The defaults suit a stack 0.5–2 m below the sensor.
const float STACK_MOVE_MM  = 50;    // how far the stack must go up, and back down, to be a rep
const float MAX_TRAVEL_MM  = 800;   // a bigger swing is not the stack (a hand or a head in the beam)
const int   MIN_RANGE_MM   = 100;   // closer than this is something touching the sensor
const int   MAX_RANGE_MM   = 2500;  // farther than this is not the stack
// Narrows the sensor's view from about 27 degrees to about 15, so it sees the top plate and not
// the frame or the guide rods. 16 is the full view; 8 is a good start; go lower if the readings
// jump around at rest.
const int   VIEW_SIZE      = 8;
const unsigned long LOST_RESET_MS = 1500; // no good reading for this long: start over
const int   LED_PIN        = 2;

VL53L1X sensor;
RepDetector reps;
unsigned long lastGood = 0;
unsigned long lastHello = 0;
unsigned long seq = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(250);
  Serial.println(WiFi.status() == WL_CONNECTED ? "wifi: " + WiFi.localIP().toString() : "wifi: not connected");
}

// POST to the kiosk. Returns true when the kiosk answered 200.
bool post(const char* path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(1500);
  http.begin(String(KIOSK_URL) + path);
  http.addHeader("Authorization", String("Bearer ") + SENSOR_TOKEN);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  return code == 200;
}

void sendRep() {
  // The same seq on a retry lets the kiosk drop the duplicate if the first one did arrive.
  String body = String("{\"seq\":\"") + String((uint32_t)ESP.getEfuseMac(), HEX) + "-" + String(++seq) + "\"}";
  for (int attempt = 0; attempt < 3; attempt++) {
    if (post("/sensor/rep", body)) return;
    connectWifi();
  }
  Serial.println("rep not delivered");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Wire.begin(21, 22);
  Wire.setClock(400000);
  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.println("VL53L1X not found: check the wiring");
    while (true) { digitalWrite(LED_PIN, !digitalRead(LED_PIN)); delay(150); }
  }
  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setMeasurementTimingBudget(50000);
  sensor.setROISize(VIEW_SIZE, VIEW_SIZE);
  sensor.startContinuous(50);

  reps.moveMm = STACK_MOVE_MM;
  reps.maxTravelMm = MAX_TRAVEL_MM;
  connectWifi();
}

void loop() {
  unsigned long now = millis();
  if (now - lastHello > 10000) { lastHello = now; connectWifi(); post("/sensor/hello", "{}"); }

  sensor.read();
  bool good = !sensor.timeoutOccurred() && sensor.ranging_data.range_status == VL53L1X::RangeValid;
  int mm = sensor.ranging_data.range_mm;
  if (!good || mm < MIN_RANGE_MM || mm > MAX_RANGE_MM) {
    // Lost the stack for a while: whatever was in progress is not a rep.
    if (lastGood && now - lastGood > LOST_RESET_MS) { reps.reset(); lastGood = 0; }
    return;
  }
  lastGood = now;

  // The sensor looks down, so the stack going up means the distance getting shorter.
  if (reps.update(-mm, now)) {
    digitalWrite(LED_PIN, HIGH);
    Serial.printf("rep at %d mm\n", mm);
    sendRep();
    digitalWrite(LED_PIN, LOW);
  }
}
