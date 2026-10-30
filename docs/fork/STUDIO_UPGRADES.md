# Studio upgrades (Mac fork, 2026-10-30)

Dal: `efe/studio-upgrades`. Tümü eklemeli; upstream şablonları yeniden yazılmadı. Fork kuralları tek dosyada toplanır ve mevcut `.join('\n\n')` noktalarına eklenir (`youtubeCameraGaze.ts` deseni).

## Kaynak ve atıf

- Prompt craft kuralları (Türkçe harf harf yazım, 2–4 kelimelik başlık, tek vurgu rengi, sağ alt köşe, hex palet, duyguya göre vurgu rengi, negatif alan) **Avenox**'un MIT lisanslı `avenoxskills` deposundaki fikirlerden uyarlandı: <https://github.com/avenoxai/avenoxskills> — Copyright (c) 2026 Avenox, MIT License. Metin bu uygulama için yeniden yazıldı.
- Ürün çekimi mod sınıflandırması ve klasör "style lock" fikri **higgsfield-studio**'dan (<https://github.com/avenoxai/higgsfield-studio>) yalnız **ilham** olarak alındı. O deponun lisans dosyası yok (tüm hakları saklı); hiçbir metni kopyalanmadı, tüm cümleler bizim.

## 1. Prompt craft kuralları (arayüz yok)

- Kod: `src/lib/prompts/craftRules.ts`, giriş noktası `src/lib/prompts/forkGuidance.ts`.
- Metin modeli yönergesi: `runImagePromptTask` (Sunburst Enhance/Brainstorm/Variation) ve Nano Banana Brainstorm'un `guidance` birleşimi. Son görsel istemi: `composeSunburstGenerationPrompt` (her iki dal), yani sunucuda kuyruklanan tüm görseller.
- **Türkçe metin:** tırnak içindeki (`"…"`, `“…”`, `«…»`) ve Türkçe/ASCII dışı harf içeren her metin `spellExactText` ile harf harf yazılır (`"ŞAŞIRTICI" = Ş-A-Ş-I-R-T-I-C-I`), karışan çiftler (İ/I, ı/i, Ş/S, Ğ/G, Ç/C, Ö/O, Ü/U) ve metindeki harflerin notu eklenir. Kullanıcının metni değiştirilmez; blok sona eklenir. Tek tırnak bilerek atlanır ("İstanbul'da"). En çok 8 metin.
- **Yazılı tasarım düzeni** (YouTube, sosyal medya, metin isteyen Simple): 2–4 kelime, beyaz + tek vurgu kelimesi, kalın kontur, metin bir yanda / özne öbür yanda, en çok 3 ana öğe, tek odak; YouTube 16:9'da sağ alt boş; video başlığını aynen tekrar etme. Kullanıcının tam metni ve "yazısız" isteği her zaman önce gelir.
- **Renk ve alan:** renk önemliyse hex palet, duyguya göre tek vurgu (kırmızı aciliyet, yeşil başarı/para, mavi teknoloji, mor otomasyon, altın değer), yazının geleceği yere sakin negatif alan.
- Yerel düzenlemede (Edit area) yalnız harf koruması uygulanır.

## 2. Ürün çekimi modları

- Brainstorm'a **Product** kategorisi ve **Mode** seçicisi eklendi (`src/lib/prompts/productShotModes.ts`). Varsayılan **Standard** = bugünkü davranış, hiçbir şey eklenmez.
- Modlar: Studio / catalog, Lifestyle scene, Close-up with hands/person, Hero banner (wide), Pinterest pin (vertical 2:3), Conceptual / CGI, Restyle existing image. Her biri kısa bir fotoğraf/kompozisyon bloğu ekler; önerilen oran yalnız tavsiyedir, seçili tuval değişmez.
- Seçim `localStorage` `banana-product-shot-mode` anahtarında (yalnız arayüz tercihi). Upstream'de olduğu gibi Product için en az bir referans görsel gerekir.

## 3. Klasör style lock

- Klasör kartındaki ve galeri başlığındaki dişli → **Folder settings**: Style lock aç/kapa, "Style paragraph" (≤2000), "Never" (satır başına bir madde, ≤20 × 160).
- Saklama: yerel SQLite `settings.folderStyleLocks` (klasör satırları upstream biçiminde kalır). RPC'ler `get_folder_style_locks` (silinmiş klasörleri süzer) ve `save_folder_style_lock` (klasör var mı kontrol eder, değerleri sınırlar, boş kilit siler) — `desktop/server/store.mjs`. Yalnız Mac çalışma alanında görünür.
- Uygulama: hedef klasörün kilidi açıksa metin modeli yönergesine ve son görsel istemine `FOLDER STYLE LOCK · <klasör>` + paragraf (aynen) + `NEVER: …` eklenir. Kilit gönderim anındaki haliyle iş yüküne yazılır (`styleLock`, sunucuda yeniden sınırlanır) ve her denemede aynı istem kurulur. Yerel düzenlemelere uygulanmaz.
- Görünürlük: oluşturma çubuğunda "Style lock: <klasör>" etiketi; görsel ayrıntılarında "Style lock applied · <klasör>" (`metadata.styleLock`).

## 4. Wiro video

Ayrıntı: `WIRO_PLAN.md` → "Aşama 2 — video (yapıldı)".

## 5. YouTube verisi: Apify

- Anahtar: Provider keys → **YouTube · Apify** (`APIFY_TOKEN`, Keychain). Token varsa tüm YouTube aramaları Apify'dan; yoksa eski "YouTube Data API" anahtarı (`YOUTUBE_API_KEY`) aynen çalışır. `/api/youtube-status` artık `{ configured, source: 'apify' | 'google' | null }` döner.
- Aktör: **`streamers/youtube-scraper`** (Apify'ın kendi "streamers" ekibi; mağazada en çok kullanılan YouTube aktörü, ~192 bin kullanıcı, 30 milyondan fazla çalıştırma; son build 2026-10-26).
- Çağrı: `POST https://api.apify.com/v2/acts/streamers~youtube-scraper/run-sync-get-dataset-items?timeout=150&maxItems=N&maxTotalChargeUsd=…`, token yalnız `Authorization: Bearer` başlığında (URL'de değil), `redirect:'error'`, 170 sn istemci sınırı. Shorts ve canlı yayınlar kapalı (`maxResultsShorts: 0`, `maxResultStreams: 0`); tarih filtresi eklentisi (ek ücretli) kullanılmaz, 365 gün süzmesi istemcide.
- Adaptör `api/_lib/apifyYouTube.ts` dört v3 uç noktasını taklit eder: `channels` (id/handle/kullanıcı adı → kanal sayfası, yükleme listesi `UU…`), `playlistItems` (önbellekten sayfalama, `nextPageToken = apify:<n>`), `videos` (önbellekte olmayan kimlikler için tek çalıştırma), `search` (yalnız `type=channel`, ilk sonucun kanalı). Süre `HH:MM:SS` → `PT#H#M#S`.
- Önbellek: bellek içi, 30 dk, en çok 40 kanal / 5000 kayıt. Bir kanal çalıştırması (en yeni 50 normal video) aynı kanal için sonraki liste ve video isteklerini ücretsiz karşılar. Bulunamayan kanal/video/arama da önbelleğe yazılır (aynı boş sonuç için ikinci ücretli çalıştırma yok).
- Harcama sınırı: uygulama süreci başına saatte en çok 500 ücretli video (`APIFY_HOURLY_ITEM_BUDGET`, FREE kademede ~$2); her çalıştırmada ayrıca `maxItems` ve `maxTotalChargeUsd` Apify tarafında üst sınır koyar.

**Fiyat (PAY_PER_EVENT, video başına, 2026-10-30 mağaza verisi):** FREE $0.004 · BRONZE $0.003 · SILVER $0.0026 · GOLD $0.0024 · PLATINUM $0.0015 · DIAMOND $0.001. Ek olaylar (tarih filtresi, AI özet, transkript) kullanılmıyor.

| Uygulama işlemi | Apify çalıştırması | Yaklaşık ücret (FREE kademe) |
|---|---|---|
| Kanal çöz (URL/handle) | 1 çalıştırma, ≤50 video | ≤ $0.20 |
| Aynı kanalda Top / Latest listesi (30 dk içinde) | yok (önbellek) | $0 |
| Tek video bilgisi (önbellekte değilse) | 1 çalıştırma, 1 video | $0.004 |
| Kanal araması (handle bulunamazsa) | 1 çalıştırma, 1 sonuç | $0.004 |

Not: Google API ile "Latest" en çok 500 video tarayabiliyordu; Apify yolunda kanal başına en yeni 50 normal video gelir (maliyet sınırı, `APIFY_CHANNEL_VIDEOS`). Kanal araması video aramasıyla yapılır; ilk videonun kanalı döner.

## Testler

`tests/prompt-craft.test.mjs`, `tests/style-lock.test.mjs`, `tests/wiro-video.test.mjs`, `tests/apify-youtube.test.mjs`, ayrıca `tests/wiro-provider.test.mjs` içinde style lock + Türkçe harflerin Wiro Run istemine ulaştığı uçtan uca test. Tüm ağ çağrıları sahte; ücretli Wiro/Apify çağrısı yok.
