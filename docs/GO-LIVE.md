# Go-live checklist — Demo vs Live / خطة التشغيل — تجريبي وحقيقي

---

## English

### Mode A — Bench demo (no hardware data, zero setup)
- [ ] Open the dashboard URL — it runs on simulated data (orange DEMO DATA badge)
- [ ] Move the fan/pump sliders and show they affect the simulated temperatures
- [ ] Toggle عربي/EN

### Mode B — Live demo (hardware connected, local network)
1. **Broker**
   - [ ] `broker/README.md` step 1: create accounts (`backend`, `esp32-01`)
   - [ ] step 2: generate the CA + broker cert (or use your own CA)
   - [ ] `MQTT_PASSWORD=... OPERATOR_TOKEN=... COMMAND_KEY=... docker compose up`
   - [ ] For a quick bench run without TLS, uncomment the 1883 listener in
         `broker/mosquitto.conf` — trusted network only
2. **ESP32**
   - [ ] Flash `firmware/solar_cooling_esp32.ino` with WiFi credentials,
         broker host, device account (`esp32-01` + password), `COMMAND_KEY`
         matching the backend, and `MQTT_VERIFY_SERVER 1` with the CA cert
         pasted in (production) or `0` (bench)
   - [ ] Serial monitor shows `MQTT...connected` and `Published: W ... A ... N ...`
   - [ ] Broker shows the device as `solarcool/esp32-01/status = online`
3. **Backend**
   - [ ] `GET /api/health` → `{"ok":true,"mqtt":true}`
   - [ ] `GET /api/latest?deviceId=esp32-01` returns real readings
4. **Dashboard**
   - [ ] Fill `BACKEND.restUrl`, `BACKEND.wsUrl`, `BACKEND.operatorToken` in
         `index.html` and push — badge turns teal `LIVE · MQTT`
   - [ ] Move a slider → fan/pump reacts within a second
   - [ ] Negative test: remove the operator token → sliders get 401, hardware
         does not move; send a command without the key → ESP32 logs
         "Command rejected: bad key"

### Mode C — Public deployment (for the defense)
- [ ] Backend on Render (blueprint in `render.yaml`) with `OPERATOR_TOKEN`,
      `COMMAND_KEY`, and managed-broker credentials set as env vars
- [ ] Broker: HiveMQ Cloud / EMQX Serverless free tier with TLS (8883) and
      per-device credentials — never the public anonymous test broker
- [ ] Dashboard `restUrl`/`wsUrl` point at the Render URL (wss://)
- [ ] Rehearse the failure story: unplug the ESP32 → status goes `offline`
      (LWT), dashboard badge flips to RECONNECTING, readings resume on reconnect

### Security invariants (already built in — verify, don't rebuild)
- Broker: anonymous access off, per-device ACLs (`broker/acl`) — a device can
  only publish its own readings and read its own commands
- Command route: `POST /api/commands` requires the operator bearer token
- Device interlock: hardware ignores commands without `COMMAND_KEY`, and
  clamps outputs to `FAN_MAX_PCT` / `PUMP_MAX_PCT`
- Read-only endpoints stay open so examiners can watch without any credential

---

## بالعربي

### وضع أ — عرض تجريبي (من غير هاردوير، صفر إعداد)
- [ ] افتح لينك الداشبورد — شغالة ببيانات محاكاة (علامة برتقالي DEMO DATA)
- [ ] حرك سلايدرز المروحة والطلمبة ووري إنها بتأثر في الحرارة
- [ ] جرب زرار عربي/EN

### وضع ب — عرض لايف (الهاردوير متوصل، شبكة محلية)
1. **الوسيط (Broker)**
   - [ ] نفذ خطوة 1 من `broker/README.md`: اعمل حسابات (`backend` و`esp32-01`)
   - [ ] خطوة 2: اعمل شهادة CA وشهادة الوسيط
   - [ ] شغّل: `MQTT_PASSWORD=... OPERATOR_TOKEN=... COMMAND_KEY=... docker compose up`
   - [ ] للتجربة السريعة من غير TLS، فعّل مستمع 1883 في
         `broker/mosquitto.conf` — على شبكة موثوقة بس
2. **الـ ESP32**
   - [ ] ارفع الفيرموير بعد ما تملى: الواي فاي، عنوان الوسيط، حساب الجهاز،
         و `COMMAND_KEY` نفس اللي في الباك اند، و `MQTT_VERIFY_SERVER 1`
         مع شهادة الCA (للتشغيل الحقيقي) أو `0` (للمعمل)
   - [ ] السيريال يطبع `MQTT...connected` وبعدها `Published: W ... A ... N ...`
   - [ ] حالة الجهاز على الوسيط `online`
3. **الباك اند**
   - [ ] `GET /api/health` ترجع `{"ok":true,"mqtt":true}`
   - [ ] `GET /api/latest?deviceId=esp32-01` ترجع قراءات حقيقية
4. **الداشبورد**
   - [ ] املى `restUrl` و `wsUrl` و `operatorToken` في `index.html` واعمل push —
         العلامة تبقى تيل `LIVE · MQTT`
   - [ ] حرك سلايدر ← المروحة/الطلمبة تستجيب في ثانية
   - [ ] اختبار الأمان: شيل التوكن ← السلايدرز تاخد 401 والهاردوير ميتحركش

### وضع ج — نشر عام (يوم المناقشة)
- [ ] الباك اند على Render (البلوبرنت جاهز في `render.yaml`) مع التوكن والمفتاح
- [ ] وسيط سحابي مجاني بTLS وحساب لكل جهاز — أبدًا مش الوسيط العام المفتوح
- [ ] `restUrl`/`wsUrl` يشاوروا على لينك Render (wss://)
- [ ] اتمرن على سيناريو العطل: افصل الـ ESP32 ← الحالة `offline` والداشبورد
      تكتب "بيحاول يتوصل"، ويرجع لوحه لما يتوصل تاني

### ثوابت الأمان (مبنية وجاهزة — اتأكد منها بس)
- الوسيط: مفيش دخول مجهول، وصلاحيات لكل جهاز — الجهاز يقدر ينشر قراءاته بس
  ويقرا أوامره بس
- مسار الأوامر: محتاج توكن المشغّل
- قفل الأمان في الجهاز: أي أمر من غير `COMMAND_KEY` يتجاهل، والمخرجات
  متظبوطة على حد أقصى (`FAN_MAX_PCT` / `PUMP_MAX_PCT`)
