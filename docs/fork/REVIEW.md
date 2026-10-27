# Banana Studio v0.1.3 (c9fe7de) — birleşik inceleme raporu

Tarih: 2026-10-27. Kaynak: 4 alt ajan (Opus 5.5) — REA JS haritası, güvenlik, REA release artefaktları, kod kalitesi/test.
Hiçbir repo kodu, betiği ya da uygulama çalıştırılmadı. `tsc` ve `npm audit` ayrı bir kopyada (`qa-copy/`, `--ignore-scripts`) koşuldu.

"Mac fork" sütunu: kişisel Mac uygulamasını etkiliyor mu?

## Yüksek

| # | Bulgu | Yer | Mac fork |
|---|---|---|---|
| Y1 | Sürekli hata veren görsel işi hiçbir zaman `failed` olmuyor; deneme sayacı yok, `maxDeliveries:10000`, sweep yeniden yayınlıyor | `api/image-job-worker.ts:10`, `imageJobRunner.ts:63`, `vercel.json`, baseline migration | Evet |
| Y2 | Masaüstü kuyruğu `wake()` içinde `ImageJobWait` dışındaki her hatayı yutuyor; 5 sn'de bir sonsuz tekrar, log yok | `desktop/server/main.mjs` | Evet |
| Y3 | Masaüstü `claim_image_job` emülasyonu SQL'den sapmış: eşzamanlılık sınırı, cooldown, yetki kontrolü, eski audit kapatma yok; lease 60 sn (SQL 120) | `desktop/server/store.mjs:139-145` | Evet |
| Y4 | Ücreti ödenmiş video görevi kaybolabiliyor: `updateVideoStatus` DB hatasını yutup metadata'yı siliyor; EvoLink/OpenRouter `task_id` yazımı kontrol edilmiyor; oturum kontrolü görev oluşturulduktan sonra | `storageService.ts:1656-1666`, `App.tsx:941`, `App.tsx:948` | Evet |
| Y5 | Paketlenmiş Node 24.19.0, 21 Ekim 2026 güvenlik sürümünün gerisinde (zlib/Brotli bellek bozulması, TLS hostname bypass) → 24.22.1 | `desktop/node-runtime.json` | Evet |

## Orta

| # | Bulgu | Yer | Mac fork |
|---|---|---|---|
| O1 | fal/EvoLink/Gemini/Seedance rotalarında kullanıcı başına harcama limiti yok (yalnız OpenAI/OpenRouter'da var) | `api/_lib/openaiGuard.ts:17-20` ve ilgili handler'lar | Hayır (web) |
| O2 | Seedance: sağlayıcı kabul ettikten sonra `registerProviderTask` başarısız olursa task ID kayboluyor | `api/seedance-video.ts:34-43` | Evet |
| O3 | Watchdog `setState` updater'ı içinde ağ yazıyor; fal `pollImageTask` sınırsız dönüyor | `App.tsx:347-376`, `falImageService.ts:159` | Evet |
| O4 | Frontend fiilen tipsiz: `@types/react` yok; `--strict` ile 4676 hata; 227 `any` | — | Evet |
| O5 | `api/` altındaki hiçbir modül test edilmiyor (faturalama, kuyruk, paylaşım, auth) | `tests/` | Kısmen |
| O6 | macOS ad-hoc imzalı, notarize değil; sessiz otomatik güncelleme, tek koruma Sparkle EdDSA anahtarı | `sign-macos-release.mjs:43`, Info.plist | Fork'ta kendi anahtarın gerekli |
| O7 | Windows imzasız, güncelleme doğrulaması yok | `desktop/windows/Program.cs:46` | Hayır |
| O8 | `claim_image_job` aynı migration'da 3 kez tanımlı; preview ortamında kuyruk sonsuz döngü | baseline migration, `imageJobRunner.ts:57` | Hayır |

## Düşük

- Paylaşım token'ı DB'de düz metin (`folder-share.ts:27`) — web.
- fal ham hata/yanıtı istemciye dönüyor (`fal-image-generate.ts:149,156`).
- YouTube proxy tüm parametreleri geçiriyor, kota tüketilebilir (`api/youtube.ts:43-46`).
- `res.json()` başarısızsa `res.text()` boş döner, tanı kaybolur (`falImageService.ts:132,172`).
- `reconcileH3Usage` negatif timeout (`h3Usage.ts:134`).
- Masaüstü upload `response.ok` kontrol etmiyor (`desktop/shared/browserClient.ts:21-22`).
- Büyük dosyalar: `Gallery.tsx` 3482, `Controls.tsx` 2974, `storageService.ts` 2538, `App.tsx` 1791 satır; kopya yardımcılar, dağınık fal allowlist'i ve fiyat tablosu (`authService.ts` içinde).
- `npm audit`: 3 yüksek, hepsi `@vercel/queue → zod 4.1.11` zinciri, muhtemelen dolaylı.
- Paket şişkinliği: Node 120 MB (%93); Sparkle Headers; Windows'ta gereksiz WPF assembly'leri.
- README indirme bağlantıları v0.1.2'yi gösteriyor.

## İyi yapılmış

- `requireUser` JWT'yi doğruluyor, kimlik hep token'dan; RLS RESTRICTIVE + DEFINER fonksiyonlarında `search_path=''`.
- Paylaşım: 256 bit token URL fragment'ında, 60 sn imzalı URL, sıkı CSP.
- SSRF yok: sabit hostlar, `redirect:'error'`.
- Masaüstü sunucusu: `127.0.0.1` + rastgele port, Host/Origin kontrolü, HttpOnly cookie, path traversal koruması; anahtarlar stdin ile, WebView'a gitmiyor; Keychain `WhenUnlockedThisDeviceOnly`.
- Görsel kuyruğu dispatch sonrası sağlayıcıyı yeniden çağırmıyor (çift ücret yok); outbox + idempotency.
- Paketler kaynakla uyumlu: ekstra kod/telemetri/anahtar/source map yok; `server.mjs` üç platformda byte byte aynı; Sparkle feed ve arşiv imzaları geçerli.
- Testler gerçek davranış testi (provider routing 32 kombinasyon, piksel düzenleme, loopback auth, path traversal, release imzaları).

## REA değerlendirmesi

- Release artefaktlarında işe yaradı: arşiv envanteri, çıkarma, imza, plist, managed (.NET) analizi.
- TypeScript kaynağında zayıf kaldı: 417 göreli importun 331'ini çözemedi (`./x.js` → `x.ts`), feature trace'ler 10 MB sınırına takıldı, `compare_source_to_bundle` girdi formatı üretilemedi. Bu kısımlar Read/Grep ile doğrulandı.

## Mac fork için öncelik sırası

1. Y2 + Y1 (kuyruk hatalarını görünür yap, deneme sınırı ekle) ve Y3.
2. Y4 + O2 + O3 (video/polling yolu — yeni sağlayıcı da buradan geçecek).
3. Y5: Node'u 24.22.1'e yükselt.
4. Kendi Sparkle anahtarı/appcast'i, bundle ID ve Keychain servis adı (O6).

Artefaktlar: `artifacts/v0.1.3/`, açılmış paketler `artifacts/extracted-*`, REA dışa aktarımı `rea-out/bundle.json`.
