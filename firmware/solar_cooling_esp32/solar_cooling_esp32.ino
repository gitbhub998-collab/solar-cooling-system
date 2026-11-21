/*
 * SolarCool — ESP32 firmware (MQTT edition)
 * =========================================
 * Reads 3 solar panels (water-cooled / air-cooled / uncooled), the battery
 * and ambient temperature, publishes one JSON snapshot to the MQTT broker
 * every PUBLISH_INTERVAL_MS, and applies fan/pump setpoints received from
 * the backend (retained commands, so they survive reboots).
 *
 * Topic layout (TOPIC_PREFIX + DEVICE_ID):
 *   solarcool/esp32-01/readings   -> this device publishes the JSON snapshot
 *   solarcool/esp32-01/status     -> "online" / "offline" (Last Will)
 *   solarcool/esp32-01/commands   <- this device subscribes: {"fan":0-100,"pump":0-100}
 *
 * Hardware (defaults, all changeable below):
 *   - 3x DS18B20 panel temperature sensors on ONE OneWire bus (GPIO 4)
 *   - 1x DHT22 ambient sensor (GPIO 15)
 *   - 3x INA219 power monitors on I2C (GPIO 21 SDA / 22 SCL),
 *     addresses 0x40 (water), 0x41 (air), 0x44 (none)  — set with A0/A1 jumpers
 *   - Battery voltage divider on ADC GPIO 34 (R1=100k top, R2=27k bottom)
 *   - Air fan  PWM on GPIO 25 (through a MOSFET, e.g. IRLZ44N)
 *   - Water pump PWM on GPIO 26 (through a MOSFET)
 *
 * Arduino IDE libraries (Library Manager):
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson by Benoit Blanchon (v7)
 *   - OneWire, DallasTemperature
 *   - Adafruit INA219
 *   - DHT sensor library + Adafruit Unified Sensor
 *   Board: ESP32 Dev Module
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <DHT.h>

/* ============ 1) EDIT THIS CONFIG SECTION ============ */
#define WIFI_SSID      "YOUR_WIFI_NAME"
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"

// Broker. Production: TLS on 8883 with per-device credentials (see broker/README.md).
#define MQTT_HOST      "your-broker-hostname"   // e.g. the Pi or your HiveMQ Cloud cluster
#define MQTT_PORT      8883
#define MQTT_USER      "esp32-01"               // this device's own broker account
#define MQTT_PASS      "CHANGE_ME_DEVICE_PASSWORD"

// Set 1 to verify the broker against CA_CERT below (production).
// Set 0 only on a trusted bench network (accepts any cert).
#define MQTT_VERIFY_SERVER 0

// Paste broker/certs/ca.crt here when MQTT_VERIFY_SERVER is 1.
const char CA_CERT[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)EOF";

// Command-path interlock: the ESP32 ignores any command that does not carry
// this key, so even someone who reaches the command topic cannot move the
// hardware. Must match COMMAND_KEY in the backend's environment.
#define COMMAND_KEY    "CHANGE_ME_COMMAND_KEY"

// Hardware interlocks: outputs can never exceed these, whatever arrives.
#define FAN_MAX_PCT    100
#define PUMP_MAX_PCT   85      // keep the pump below its thermal limit

#define DEVICE_ID      "esp32-01"
#define TOPIC_PREFIX   "solarcool"

#define PUBLISH_INTERVAL_MS 2000
/* ===================================================== */

// Pins
#define ONE_WIRE_BUS   4
#define DHT_PIN        15
#define DHT_TYPE       DHT22
#define BAT_ADC_PIN    34
#define FAN_PIN        25
#define PUMP_PIN       26

// Battery divider: Vbat = Vadc * (R1+R2)/R2
const float BAT_DIVIDER = (100000.0f + 27000.0f) / 27000.0f;  // 4.7037
const float BAT_FULL_V  = 12.6f;
const float BAT_EMPTY_V = 10.8f;

// PWM (ESP32 LEDC)
const int FAN_CH = 0, PUMP_CH = 1;
const int PWM_FREQ = 25000, PWM_RES = 8;

char topicReadings[64], topicStatus[64], topicCommands[64], clientId[32];

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_INA219 inaWater(0x40), inaAir(0x41), inaNone(0x44);

WiFiClientSecure net;
PubSubClient mqtt(net);

// Which DS18B20 index belongs to which panel (print addresses once over Serial to map).
int idxWater = 0, idxAir = 1, idxNone = 2;

unsigned long lastPublish = 0;

/* ---------------- outputs ---------------- */
void setFan(int pct)  { ledcWrite(FAN_CH, constrain(pct, 0, 100) * 255 / 100); }
void setPump(int pct) { ledcWrite(PUMP_CH, constrain(pct, 0, 100) * 255 / 100); }

/* ---------------- MQTT ---------------- */
bool validKey(JsonDocument& doc) {
  return doc["key"].is<const char*>() && strcmp(doc["key"], COMMAND_KEY) == 0;
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  // Interlock 1: no valid key -> ignore the command entirely.
  if (!validKey(doc)) { Serial.println("Command rejected: bad key"); return; }
  // Interlock 2: clamp to hardware limits, whatever was requested.
  if (doc["fan"].is<int>())  setFan(min(doc["fan"].as<int>(),  FAN_MAX_PCT));
  if (doc["pump"].is<int>()) setPump(min(doc["pump"].as<int>(), PUMP_MAX_PCT));
  Serial.printf("Command applied: fan=%d pump=%d\n",
                doc["fan"].is<int>() ? doc["fan"].as<int>() : -1,
                doc["pump"].is<int>() ? doc["pump"].as<int>() : -1);
}

void ensureMqtt() {
  while (!mqtt.connected()) {
    Serial.print("MQTT...");
    const char* user = strlen(MQTT_USER) ? MQTT_USER : nullptr;
    const char* pass = strlen(MQTT_PASS) ? MQTT_PASS : nullptr;
    // Last Will marks the device offline if it drops.
    if (mqtt.connect(clientId, user, pass, topicStatus, 1, true, "offline")) {
      Serial.println("connected");
      mqtt.publish(topicStatus, "online", true);
      mqtt.subscribe(topicCommands, 1);
    } else {
      Serial.printf("failed rc=%d, retry in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

/* ---------------- sensors ---------------- */
float readBatteryVoltage() {
  uint32_t raw = 0;
  for (int i = 0; i < 16; i++) { raw += analogRead(BAT_ADC_PIN); delay(2); }
  return (raw / 16.0f) * 3.3f / 4095.0f * BAT_DIVIDER;
}

float batteryPercent(float v) {
  return constrain((v - BAT_EMPTY_V) / (BAT_FULL_V - BAT_EMPTY_V) * 100.0f, 0.0f, 100.0f);
}

void addPanel(JsonObject panels, const char* name, float tempC, Adafruit_INA219& ina) {
  float busV = ina.getBusVoltage_V();
  float curA = ina.getCurrent_mA() / 1000.0f;
  JsonObject p = panels[name].to<JsonObject>();
  p["temperature"] = tempC;
  p["voltage"]     = busV;
  p["current"]     = curA;
  p["power"]       = busV * curA;
}

/* ---------------- Arduino ---------------- */
void setup() {
  Serial.begin(115200);
  Serial.println("\nSolarCool ESP32 (MQTT) booting...");

  snprintf(topicReadings, sizeof(topicReadings), "%s/%s/readings", TOPIC_PREFIX, DEVICE_ID);
  snprintf(topicStatus,   sizeof(topicStatus),   "%s/%s/status",   TOPIC_PREFIX, DEVICE_ID);
  snprintf(topicCommands, sizeof(topicCommands), "%s/%s/commands", TOPIC_PREFIX, DEVICE_ID);
  snprintf(clientId,      sizeof(clientId),      "solarcool-%s",   DEVICE_ID);

  tempSensors.begin();
  dht.begin();
  Wire.begin(21, 22);
  inaWater.begin(); inaAir.begin(); inaNone.begin();
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  ledcSetup(FAN_CH, PWM_FREQ, PWM_RES);
  ledcAttachPin(FAN_PIN, FAN_CH);
  ledcSetup(PUMP_CH, PWM_FREQ, PWM_RES);
  ledcAttachPin(PUMP_PIN, PUMP_CH);
  setFan(70); setPump(60);   // safe defaults until a retained command arrives

  Serial.printf("Found %d DS18B20 sensor(s)\n", tempSensors.getDeviceCount());

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { Serial.print('.'); delay(300); }
  Serial.printf("\nConnected: %s\n", WiFi.localIP().toString().c_str());

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);          // JSON snapshot is bigger than the 256B default
  mqtt.setCallback(onMessage);
  mqtt.setKeepAlive(30);
#if MQTT_VERIFY_SERVER
  net.setCACert(CA_CERT);
#else
  net.setInsecure();   // bench only: skip server verification
#endif
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(1000); return; }
  if (!mqtt.connected()) ensureMqtt();
  mqtt.loop();

  if (millis() - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = millis();

  tempSensors.requestTemperatures();
  float tWater = tempSensors.getTempCByIndex(idxWater);
  float tAir   = tempSensors.getTempCByIndex(idxAir);
  float tNone  = tempSensors.getTempCByIndex(idxNone);
  float tAmb   = dht.readTemperature();
  float batV   = readBatteryVoltage();

  JsonDocument doc;
  doc["ts"] = 0;  // server stamps the time; the ESP32 has no RTC
  JsonObject panels = doc["panels"].to<JsonObject>();
  addPanel(panels, "water", tWater, inaWater);
  addPanel(panels, "air",   tAir,   inaAir);
  addPanel(panels, "none",  tNone,  inaNone);
  if (!isnan(tAmb)) doc["ambient"]["temperature"] = tAmb;
  doc["battery"]["voltage"]    = batV;
  doc["battery"]["percentage"] = batteryPercent(batV);

  char buf[600];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  if (mqtt.publish(topicReadings, buf, n)) {
    Serial.printf("Published: W %.1fC | A %.1fC | N %.1fC | bat %.2fV\n",
                  tWater, tAir, tNone, batV);
  } else {
    Serial.println("Publish failed");
  }
}
