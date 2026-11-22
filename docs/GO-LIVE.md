# Go-live gate: demo vs live / بوابة التشغيل

## English

### Public website: monitoring only
- Demo mode uses simulated readings and simulated sliders. It does not move hardware.
- For real readings, set only BACKEND.restUrl, BACKEND.wsUrl and deviceId in index.html. Use HTTPS/WSS.
- Public live mode is read-only, with disabled fan/pump sliders and no command sender.
- NEVER put OPERATOR_TOKEN, COMMAND_KEY, broker passwords or any other secret in HTML, JavaScript, GitHub, screenshots or chat. Browser source and public Git history are visible to everyone.
- Before exposing the backend, deny POST /api/commands at the public reverse proxy/firewall. A CORS setting is not an access-control boundary. Publish only intended monitoring endpoints.

### Hardware control: local/private only for now
- No authenticated operator web interface has been implemented. Do not enable remote public control on the strength of a hidden button or a source-code token.
- Use a trusted local terminal or private operator interface on the same machine, or on a private network/VPN with an access policy. Bind/restrict its command endpoint so it is not internet-reachable.
- Keep OPERATOR_TOKEN in the backend's private environment or secret store, not in frontend source. The local operator supplies the bearer token privately at runtime from a secure store. Do not paste it into URLs, commit it or leave it in shell history.
- An unset OPERATOR_TOKEN now disables commands, rather than allowing anonymous commands. Missing/wrong tokens must return 401 when configured. Authorized requests can still fail if MQTT is unavailable; acceptance is not proof of hardware movement.
- Keep MQTT private: authenticated TLS, validated CA/hostname, one account per device, ACLs preventing devices from publishing commands. Configure actual secrets outside the repository.
- Set up the real sensor mapping, motor drivers, power limits, safe startup/shutdown and loss-of-network behavior with the hardware team. The existing firmware is a starting point, not certified hardware safety. Do not energize outputs until bench-tested.
- For an eventual public operator UI, first implement real server-side authentication and authorization (protected sessions, HTTPS, CSRF protection where applicable, rate limiting and audit logs), then test it separately. This is not implemented in the current dashboard.

### Tests required before the gate passes
- [ ] Public source and deployed assets contain no credentials. Public live sliders are disabled and cannot send command requests.
- [ ] Public POST /api/commands is denied at the network/proxy boundary, including direct requests outside the browser.
- [ ] Private route rejects missing/wrong credentials and refuses all commands when OPERATOR_TOKEN is unset.
- [ ] Private broker rejects anonymous access, invalid certificates and cross-device topic access.
- [ ] Invalid command keys do not change outputs; test first with motors disconnected. Verify the actual firmware, wiring and output limits before connecting loads.
- [ ] Readings are real, recent and correctly mapped; test offline/reconnect without confusing a connected WebSocket with a healthy ESP32.
- [ ] Confirm persistent storage, backups and provider limits. Do not assume a sleeping backend recovers missed MQTT readings or that any cloud plan is free indefinitely.

### If a credential was committed
Stop using it, revoke/rotate it at its issuer, replace private copies, and inspect access logs. Removing it from the latest file is not enough: Git history, caches and forks may retain it. Request history cleanup after revocation. Never post the replacement in this repo.

## بالعربي

### الموقع العام: متابعة بس
- وضع الديمو فيه قراءات وسلايدرز محاكاة، ومبيحركش هاردوير.
- للقراءات الحقيقية املى restUrl وwsUrl وdeviceId بس في index.html مع HTTPS/WSS.
- وضع اللايف العام للقراءة فقط: السلايدرز مقفولة ومفيش إرسال أوامر.
- ممنوع تحط توكن المشغل أو COMMAND_KEY أو باسورد الوسيط في HTML أو JavaScript أو GitHub أو صور أو شات. الكود وتاريخ الريبو العام متاحين لأي حد.
- قبل نشر الباك اند امنع POST /api/commands من الإنترنت بالفايروول أو reverse proxy. إعداد CORS لوحده مش حماية. افتح مسارات المتابعة المقصودة بس.

### التحكم الحقيقي: محلي أو خاص حاليًا
- واجهة مشغل بتسجيل دخول حقيقي لسه مش متنفذة. زرار مخفي أو توكن جوه كود الواجهة مش بديل لتسجيل الدخول.
- التحكم من ترمينال محلي موثوق أو واجهة خاصة على نفس الجهاز، أو شبكة خاصة/VPN بصلاحيات محددة. مسار الأوامر مينفعش يكون مفتوح للإنترنت.
- OPERATOR_TOKEN مكانه بيئة الخادم الخاصة أو مخزن أسرار، مش كود الواجهة. المشغل المحلي يستخدمه وقت التشغيل بشكل خاص، من غير URL أو كوميت أو تسجيله في تاريخ الأوامر.
- لو OPERATOR_TOKEN مش متحدد، الأوامر بتتقفل. لو متحدد، الطلب من غيره أو بتوكن غلط لازم يرجع 401. قبول الطلب مش دليل إن الموتور اتحرك، ممكن الوسيط يكون مفصول.
- الوسيط خاص: TLS بشهادة متحققة، حساب لكل جهاز وصلاحيات تمنعه يكتب أوامر. الأسرار الحقيقية برا الريبو.
- اتفق مع فريق الهاردوير على الحساسات والتوصيلات ودرايفرات الموتور وحدود التشغيل وحالة بدء التشغيل وفقد الشبكة. الفيرموير الحالي نقطة بداية، مش ضمان أمان. ممنوع تشغيل الأحمال قبل اختبار المعمل.
- لو هنعمل واجهة تحكم عامة بعدين، لازم تسجيل دخول وصلاحيات من الخادم، جلسات محمية وHTTPS وحماية CSRF حسب الحاجة وتحديد معدل الطلبات وسجل أوامر. ده لسه مش مبني في الداشبورد الحالية.

### شروط اجتياز بوابة التشغيل
- [ ] مفيش أسرار في الكود العام أو النسخة المنشورة، والسلايدرز العامة مش بتبعت أوامر.
- [ ] مسار الأوامر ممنوع من الإنترنت حتى بطلب مباشر من غير متصفح.
- [ ] المسار الخاص بيرفض التوكن الناقص والغلط، وبيتقفل لو التوكن مش متحدد.
- [ ] الوسيط بيرفض الدخول المجهول والشهادات الغلط والوصول لمواضيع جهاز تاني.
- [ ] الأمر بمفتاح غلط ميغيرش المخارج. الاختبار الأول والموتور مفصول، وبعده مراجعة فعلية للتوصيلات والحدود قبل توصيل الأحمال.
- [ ] القراءات حقيقية وحديثة ومربوطة بالحساس الصح، واختبر فصل وإعادة توصيل الجهاز.
- [ ] اتأكد من استمرارية التخزين والنسخ الاحتياطي وحدود الاستضافة. متفترضش إن الباك اند وهو نايم هيستعيد القراءات اللي فاتته أو إن أي خطة هتفضل مجانية.

### لو سر اتعمله كوميت
وقف استخدامه والغيه أو غيره من مصدره، وحدث النسخ الخاصة وراجع سجلات الدخول. مسحه من آخر نسخة مش كفاية لأن تاريخ Git والكاش والنسخ التانية ممكن تحتفظ بيه. تنظيف التاريخ ييجي بعد إلغاء السر. البديل الجديد مينفعش ينزل هنا.
