/*
 * SolarCool — ESP32 firmware for the PV cooling comparison project
 * ================================================================
 * Reads 3 solar panels (water-cooled / air-cooled / uncooled), the battery
 * and the ambient temperature, pushes everything to Firebase Realtime
 * Database, and drives the air fan + water pump from the dashboard's
 * /controls values.
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
 * Arduino IDE libraries to install:
 *   - "Firebase ESP Client" by Mobizt (Firebase_ESP_Client)
 *   - OneWire, DallasTemperature
 *   - Adafruit INA219
 *   - DHT sensor library + Adafruit Unified Sensor
 *   Board: ESP32 Dev Module
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <DHT.h>

// Helper files that ship with the Firebase library
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

/* ============ 1) EDIT THIS CONFIG SECTION ============ */
#define WIFI_SSID      "YOUR_WIFI_NAME"
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"

// From Firebase console -> Project settings -> Web app
#define API_KEY        "YOUR_FIREBASE_API_KEY"
#define DATABASE_URL   "https://YOUR-PROJECT-default-rtdb.firebaseio.com/"

// Anonymous email/password account created in Firebase Auth for the ESP32
// (Authentication -> Sign-in method -> enable Email/Password -> add user)
#define USER_EMAIL     "esp32@yourproject.com"
#define USER_PASSWORD  "esp32-secret-password"

#define PUBLISH_INTERVAL_MS 2000   // how often sensor data is pushed
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
const float BAT_FULL_V  = 12.6f;   // 100%
const float BAT_EMPTY_V = 10.8f;   // 0%

// PWM (ESP32 LEDC)
const int FAN_CH = 0, PUMP_CH = 1;
const int PWM_FREQ = 25000, PWM_RES = 8;   // 25 kHz, 8-bit

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_INA219 inaWater(0x40), inaAir(0x41), inaNone(0x44);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig fbConfig;

// Which DS18B20 index belongs to which panel.
// Determined once at boot by probing; print addresses over Serial to map them.
int idxWater = 0, idxAir = 1, idxNone = 2;

unsigned long lastPublish = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("\nSolarCool ESP32 booting...");

  // Sensors
  tempSensors.begin();
  dht.begin();
  Wire.begin(21, 22);
  inaWater.begin(); inaAir.begin(); inaNone.begin();
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // PWM outputs
  ledcSetup(FAN_CH, PWM_FREQ, PWM_RES);
  ledcAttachPin(FAN_PIN, FAN_CH);
  ledcSetup(PUMP_CH, PWM_FREQ, PWM_RES);
  ledcAttachPin(PUMP_PIN, PUMP_CH);
  ledcWrite(FAN_CH, 179);   // 70%
  ledcWrite(PUMP_CH, 153);  // 60%

  Serial.printf("Found %d DS18B20 sensor(s)\n", tempSensors.getDeviceCount());

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { Serial.print('.'); delay(300); }
  Serial.printf("\nConnected: %s\n", WiFi.localIP().toString().c_str());

  // Firebase
  fbConfig.api_key = API_KEY;
  fbConfig.database_url = DATABASE_URL;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  fbConfig.token_status_callback = tokenStatusCallback;  // from TokenHelper.h
  Firebase.begin(&fbConfig, &auth);
  Firebase.reconnectWiFi(true);
  fbdo.setBSSLBufferSize(4096, 1024);
  Serial.println("Firebase ready.");
}

float readBatteryVoltage() {
  uint32_t raw = 0;
  for (int i = 0; i < 16; i++) { raw += analogRead(BAT_ADC_PIN); delay(2); }
  float vAdc = (raw / 16.0f) * 3.3f / 4095.0f;
  return vAdc * BAT_DIVIDER;
}

float batteryPercent(float v) {
  float pct = (v - BAT_EMPTY_V) / (BAT_FULL_V - BAT_EMPTY_V) * 100.0f;
  return constrain(pct, 0.0f, 100.0f);
}

void publishPanel(const char* name, float tempC, Adafruit_INA219& ina) {
  float busV   = ina.getBusVoltage_V();
  float curA   = ina.getCurrent_mA() / 1000.0f;
  float powerW = busV * curA;

  FirebaseJson j;
  j.set("temperature", tempC);
  j.set("voltage", busV);
  j.set("current", curA);
  j.set("power", powerW);

  String path = String("panels/") + name;
  if (!Firebase.RTDB.setJSON(&fbdo, path.c_str(), &j)) {
    Serial.printf("Push failed (%s): %s\n", name, fbdo.errorReason().c_str());
  }
}

void applyControls() {
  if (Firebase.RTDB.getInt(&fbdo, "controls/fan")) {
    int fan = constrain(fbdo.intData(), 0, 100);
    ledcWrite(FAN_CH, fan * 255 / 100);
  }
  if (Firebase.RTDB.getInt(&fbdo, "controls/pump")) {
    int pump = constrain(fbdo.intData(), 0, 100);
    ledcWrite(PUMP_CH, pump * 255 / 100);
  }
}

void loop() {
  if (millis() - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = millis();

  tempSensors.requestTemperatures();
  float tWater = tempSensors.getTempCByIndex(idxWater);
  float tAir   = tempSensors.getTempCByIndex(idxAir);
  float tNone  = tempSensors.getTempCByIndex(idxNone);
  float tAmb   = dht.readTemperature();

  publishPanel("water", tWater, inaWater);
  publishPanel("air",   tAir,   inaAir);
  publishPanel("none",  tNone,  inaNone);

  if (!isnan(tAmb)) {
    Firebase.RTDB.setFloat(&fbdo, "ambient/temperature", tAmb);
  }

  float batV = readBatteryVoltage();
  FirebaseJson jb;
  jb.set("voltage", batV);
  jb.set("percentage", batteryPercent(batV));
  Firebase.RTDB.setJSON(&fbdo, "battery", &jb);

  applyControls();

  Serial.printf("W %.1fC | A %.1fC | N %.1fC | amb %.1fC | bat %.2fV\n",
                tWater, tAir, tNone, tAmb, batV);
}
