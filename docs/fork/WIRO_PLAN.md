# Wiro + Claude aboneliği entegrasyon planı (Mac fork)

Kaynak: 2026-10-27 plan ajanı (Opus 5.5), upstream v0.1.3 (c9fe7de) üzerinde. Dosya yolları o sürüme göre; uygulamadan önce doğrula.

## Kararlar (Efe, 2026-10-27)

- Fork: `SelcukOzbilgi/banana-studio` (public). `upstream` remote'una push kapalı.
- Wiro doğrulama modu: **Signature** (en güvenlisi). `WIRO_API_KEY` + `WIRO_API_SECRET` Keychain'de; her istekte `x-api-key`, `x-nonce`, `x-signature = HMAC-SHA256(key=API_KEY, msg=API_SECRET+NONCE)`. Secret ağa hiç gitmez.
- Sağlayıcı sırası: **Wiro önde, diğerleri yedek** (Auto'da ilk sırada Wiro).
- Metin özellikleri (Enhance, Brainstorm, varyasyon, brief): **API ücreti olmadan, Efe'nin kendi Claude aboneliğiyle**. Aşağıdaki "Claude CLI sağlayıcısı" bölümüne bak.
- Kullanım senaryoları henüz netleşmedi; Efe brainstorm yapmak istiyor.

## Wiro API özeti

- Run: `POST https://api.wiro.ai/v1/Run/{owner}/{model}` (JSON veya multipart) → `{result, taskid, socketaccesstoken}`. `…/sync` sonucu Task/Detail biçiminde bekler (40 dk'da keser, görev sürer).
- Dosya girdisi: URL'ler public olmalı; `127.0.0.1` reddedilir. Multipart dosya ya da önce `POST /File/Upload` (≤100 MB) → public `url`.
- Durum: `POST /Task/Detail {taskid|tasktoken}` → `tasklist[0]`: `status`, `pexit`, `outputs`, `totalcost`, `debugerror`. Başarı `pexit == "0"`. Son durumlar: `task_postprocess_end`, `task_cancel`. `task_error` ara durum.
- İptal: `POST /Task/Cancel` (kuyrukta), `POST /Task/Kill` (çalışırken).
- Fiyat: `Tool/Detail`; gerçek ücret `totalcost`; yalnız başarılı görev ücretlenir.
- LLM gateway: `https://llm.wiro.ai/v1` (OpenAI uyumlu). Claude CLI yolu kullanılacağı için şimdilik gerek yok.
- **Doğrulanmadı:** `outputs[]` içinde URL alanının tam yeri ve CDN host'u. Adım 0 bunu çözer.

## Model eşlemesi

| Uygulama modeli | Wiro slug | Not |
|---|---|---|
| `gpt-image-2.5-sunburst` | `openai/gpt-image-2-5-sunburst` | `inputImage` ≤16, `resolution`, `ratio`, `quality`, `samples` |
| Sunburst korumalı düzenleme / kesin boyut | `openai/gpt-image-2-5-sunburst-custom` | `width`/`height` 480–3840 |
| `gemini-nano-banana-2.1` | `google/nano-banana-2-1` | `inputImage` ≤14, `resolution`, `aspectRatio` |
| `gemini-3-pro-image-preview` | `google/nano-banana-pro` | `inputImage` ≤14 |
| `seedance-2.0` | `bytedance/seedance-2-0` | ilk/son kare, referans ≤9, ses, 4–15 sn |
| `seedance-2.5` | `bytedance/seedance-2-5` | ilk/son kare, referans ≤30, 4–30 sn, ≤1080p |
| `minimax-h3` | `minimax/h3` | 4–15 sn, 768P/2K |

Wiro'da yok: Claude Opus 5.5 (Claude CLI ile çözülüyor), düz `seedance-2-5`'te video/ses referansı ve Edit/Extend, fal'a özel H3 Max seçenekleri, YouTube.

## Tasarım

Wiro, `MODEL_ROUTES` içindeki mevcut modellerin arkasına yeni sağlayıcı olarak eklenir (yeni model ya da genel slug adaptörü değil).
Tüm görsel istekleri `openai-image-enqueue → runImageJob → executeOpenAIImage → requestImage` yolundan geçer; Wiro görsel desteği `requestImage` içinde tek dal.
Piksel koruması uygulama tarafında (`compositeProtectedEdit`); sağlayıcının aynı tuval boyutunu döndürmesi yeterli → korumalı düzenleme `-custom` slug'ına gider.

## Claude CLI sağlayıcısı (abonelikle metin, API ücreti yok)

- Yalnız masaüstü. `desktop/server` kullanıcının yerelde kurulu ve giriş yapılmış `claude` CLI'ını headless modda çağırır (`claude -p`, JSON çıktı, araçlar kapalı; referans görseller gerekiyorsa yalnız geçici bir klasörde `Read`). Bayrakları uygulamadan önce `claude --help` ile doğrula. Bu makinede: `~/.local/bin/claude`, 2.1.311.
- API anahtarı yok, OAuth token'ı CLI dışına çıkarılmaz/kopyalanmaz. Kişisel kullanım içindir; başkalarına "Claude ile giriş" özelliği olarak dağıtılmaz.
- Gecikme ve abonelik kullanım limitleri var; hata ve zaman aşımı açıkça gösterilmeli. CLI bulunamazsa diğer metin sağlayıcılarına düşülür.
- Bağlantı noktaları: `src/services/geminiClient.ts` (metin endpoint seçimi), `api/openrouter-text-generate.ts` (örnek handler), `desktop/server/main.mjs` routes, `src/lib/providers.ts` metin rotaları.

## Aşamalar

**Aşama 0 — fork hijyeni ve indirilebilir build** (yapıldı, `efe/fork-setup`)
- Görünen ad ve veri klasörü upstream ile aynı kalır: `Banana Studio.app`, `~/Library/Application Support/Banana Studio` (Efe'nin Mac'inde upstream kurulu değil). Görünmeyen ayrım: bundle ID `io.github.selcukozbilgi.bananastudio` (`scripts/package-macos.mjs`), Keychain servisi `io.github.selcukozbilgi.bananastudio.provider-keys` (`KeyVault.service`). Windows'a dokunulmadı.
- Node 24.22.1 (`desktop/node-runtime.json`, CI `node-version`). Arşiv hash'leri resmi `SHASUMS256.txt` ile eşleşti; `binarySha256`/`licenseSha256` arşivler açılıp hesaplandı. `SHASUMS256.txt.sig` GPG ile doğrulanmadı (makinede gpg yok).
- Güncellemeler: Efe'nin build'leri `--development`. Bu modda `BananaDevelopmentBuild=true`, `SUEnableAutomaticChecks=false` ve `App.swift` Sparkle updater'ını hiç başlatmaz. İkinci katman: `SUFeedURL` ve imza/appcast linkleri fork'a bakar (`scripts/fork-identity.mjs`). Üçüncü katman: `--community` ya da notarize build, `SparklePublicKey.txt` hâlâ upstream anahtarıysa açık bir hatayla durur (`assertForkUpdateChannel`, `tests/fork-identity.test.mjs`). Fork'a Sparkle güncellemesi istenirse: yeni anahtar üret, açık yarısını `SparklePublicKey.txt`'ye koy, `sign-macos-release.mjs` akışını izle.
- `verify.yml` macOS işi artık `--community --prepare` paketlemez (kapı onu bilerek reddeder); yerine development app'i arşivler.
- CI: `.github/workflows/efe-macos-build.yml` (`workflow_dispatch`, main'e açılan PR ve `efe-v*` tag; dispatch dosya main'e girince çalışır). arm64 `--development` build, `Banana Studio.app` → `ditto --norsrc` zip, artifact `banana-studio-macos-arm64`; `efe-v*` tag'inde fork'ta prerelease'e eklenir.

**Aşama 1 — görsel**
0. Wiro konsolunda tek ucuz görsel; `outputs` yapısı ve CDN host'unu not et.
1. Önce hata: `desktop/server/main.mjs` `wake()` catch'i hataları yutuyor → deneme sayacı + `failed`.
2. `src/lib/providers.ts`: `'wiro'` sağlayıcısı, `WIRO_API_KEY`/`WIRO_API_SECRET`, `WIRO_MODELS`, rotalarda ilk sıra.
3. `api/_lib/imageProviders.ts`: `requestImage` wiro dalı (imzalı istek, multipart `inputImage`, `/sync`, `pexit`, indirme izin listesi, `taskid` → `x-request-id`, maliyet `totalcost`).
4. Anahtarlar: `desktop/server/main.mjs` `KEY_NAMES`; `desktop/macos/.../KeyVault.swift` `ProviderKey`; `App.swift` metni.
5. Testler: `tests/provider-routing.test.mjs`, sahte Wiro yanıtıyla `requestImage` testi, imza testi.

**Aşama 1 — yapılanlar (`efe/wiro-images`, 2026-10-27)**
- Kuyruk hatası (Y1/Y2): `desktop/server/jobLoop.mjs` + store `record_image_job_failure`. Beklenmeyen hata loglanır (yalnız mesaj), deneme sayısı SQLite'taki iş kaydında tutulur, 5 sn'den başlayan üstel bekleme; 5 denemede iş `failed` olur ve galeride görünür mesaj çıkar (dispatch öncesi: "No provider request was sent"; sonrası: "It was not resubmitted" + görev kimliği). Dispatch edilmiş iş yalnız `observe` edilir, sağlayıcıya yeniden gönderilmez.
- Sağlayıcı: `src/lib/providers.ts` `'wiro'`, üç görsel modelinde Auto'da ilk sırada; diğerleri yedek. Uygunluk için `WIRO_API_KEY` ve `WIRO_API_SECRET` ikisi de gerekir (`PROVIDER_SECRET_KEYS`). Video/metin rotaları değişmedi.
- İstek: `api/_lib/wiro.ts` (imza, Run, Task/Detail, indirme) + `requestImage` Wiro dalı. Yerel referanslar multipart dosya olarak gider (loopback URL gönderilmez). Sunburst ön ayar boyutları `openai/gpt-image-2-5-sunburst` (`resolution` 1k/2k/4k, `ratio`); özel boyut ve korumalı düzenleme `-custom` (`width/height` 480–3840, dışı dispatch öncesi 400). Wiro'da `auto` kalite yok, `auto` → `low` (şema varsayılanı). Nano Banana 2.1 → `google/nano-banana-2-1` (`outputFormat: png`), Pro → `google/nano-banana-pro`. Korumalı düzenleme uygulama tarafında `compositeProtectedEdit` ile kalır.
- İndirme: yalnız `https`, host `wiro.ai`/`*.wiro.ai`, port/kimlik bilgisi yok, `redirect:'error'`, ≤50 MB (başlık + gövde), yalnız png/jpeg/webp.
- Kurtarma: Run'dan dönen `taskid` yoklamadan önce işe yazılır (`record_image_job_task`, satırda `providerTaskId`). Her deneme 240 sn yoklar; bitmezse iş `dispatched` kalır, kuyruk aynı görevi `Task/Detail` ile sürdürür (Run yok). 30 dk sonra görev kimliğiyle `failed`.
- Maliyet: `totalcost` → `generationCost {usd, source:'provider_actual'}` ("Actual Cost"). Wiro yalnız başarılı görevi ücretlendirir; başarısız görevde Wiro'nun hata metni gösterilir.
- Anahtarlar: `KEY_NAMES`, `ProviderKey.wiroKey/.wiroSecret` (listede ilk), Provider keys penceresi metni ve yüksekliği. Secret yalnız HMAC'e girer; ağa, loga, WebView'a gitmez.
- Görünürlük: AI settings → Provider routing'de "Wiro · configured / key and secret missing" satırı ve her görsel modelinde "Auto · Wiro"; seçicinin yanında "Provider Auto · Wiro"; üret düğmesinde Wiro liste fiyatı (ör. "~$0.006 · Wiro") ya da "Wiro · billed at finish"; görsel ayrıntılarında Provider Wiro, Wiro slug'ı, "Wiro task <id>", "Actual Cost".

**Model kataloğu kararı (Efe: "seçili liste + katalogdan ekle")**
- Seçici kullanıcının seçili Wiro modellerini gösterir; varsayılan üç model mevcut uygulama kimlikleriyle eşleşir (eski sıra korunur), böylece yedek sağlayıcılar çalışmaya devam eder. Wiro anahtarı yokken seçici ve tüm akışlar eskisi gibidir.
- Katalogdan eklenen modeller `wiro:<owner>/<model>` kimliği alır ve yalnız Wiro'ya gider.
- AI settings → "Wiro image models": arama (Tool/List, kategoriler `text-to-image`, `image-to-image`, `image-editing`; VEYA ile çalışır), ekle/çıkar, Refresh (Tool/Detail; kaybolan model "missing", fiyat/girdi değişimi "changed"). Tüm Wiro çağrıları masaüstü sunucusunda imzalanır (`desktop/server/wiroCatalog.mjs`, route `wiro-models`); WebView yalnız arama metni ya da slug gönderir. Seçim yerel depoda (`settings.wiroModels`) saklanır; kontroller sunucuda Tool/Detail'den üretilir.
- Şema → kontrol eşlemesi (`src/lib/wiro/catalog.ts` `mapWiroSchema`): `prompt`, görsel dosya girdisi (maske hariç, `maxinputlenght`), `ratio`/`aspectRatio`, `resolution`, `quality`, `samples` (hep 1), sayısal `width/height` (uygulamanın oran + 1K/2K seçimiyle; seçilmezse modelin varsayılanı). Diğer opsiyonel alanlar gizli ve Wiro varsayılanında. Uygulamanın dolduramayacağı zorunlu bir girdi varsa model "desteklenmiyor" olur.
- Fiyat: Tool/Detail `dynamicprice`. Yalnız `cpr`/`cpo` satırları sabit fiyat sayılır; `cp-readoutput`, `cp-pixel` vb. için "From $X · varies with size" ya da "Price computed when the task finishes" gösterilir, asla $0 gösterilmez.

**Efe için uygulama içi uçtan uca test (ücretli, ≤ $0.01)**
Bu oturumda Erişilebilirlik, Ekran Kaydı ve olay gönderme izinleri kapalı olduğu için uygulama arayüzü sürülemedi; ücretli görev oluşturulmadı. Adımlar:
1. `open '.build/staging/Banana Studio.app'` (worktree'de; aynı anda tek örnek açılabilir).
2. Provider keys → "Wiro API key" ve "Wiro API secret" alanlarına `.env`'deki değerleri yapıştır → Save.
3. AI settings → Provider routing'de "Wiro · configured" ve GPT Image 2.5 için "Auto · Wiro" görünmeli. "Wiro image models" fiyatları yükler.
4. Seçicide GPT Image 2.5, oran 1:1, çözünürlük 1K, kalite **Low** (ya da Auto; Wiro'da low'a gider). Düğmede "~$0.006 · Wiro" görünmeli.
5. İstem yaz → Generate image (tek görsel). ~20 sn sonra galeride; ayrıntılarda Provider Wiro, "Wiro task <id>", Actual Cost $0.0060.

**Aşama 2 — metin (Claude CLI) ve video**
- Claude CLI metin sağlayıcısı (yukarıda).
- Video hataları önce: `App.tsx:941` `task_id` kontrolsüz, `App.tsx:948` oturum kontrolü sırası, `storageService.ts:1656` `updateVideoStatus`.
- `desktop/server/uploads.mjs` → Wiro `/File/Upload`; `api/seedance-video.ts` Run + Task/Detail; `seedanceProviders.ts` kısıtlar; `providerTasks.ts` `Provider` tipi; `bs_wiro_` öneki (`App.tsx`, `runwayService.ts`, `Controls.tsx` maliyet).

**Aşama 3 — cilalama**
Wiro görev kurtarma (Task/Detail), iptal (`Task/Kill`), dokümantasyon.

## Build komutları (docs/en/development.md)

```sh
npm ci
npm run typecheck && npm test && npm run build && npm run build:desktop
swift build --package-path desktop/macos -c release
node scripts/fetch-node-runtime.mjs
BANANA_NODE_RUNTIME="$PWD/.build/node-runtime/bin/node" node scripts/package-macos.mjs --development
node scripts/test-local-generation.mjs '.build/staging/Banana Studio.app'
open '.build/staging/Banana Studio.app'
```
Packager temiz bir git commit ister.

## Riskler

- Doğrulanmadı: birden çok referansın aynı `inputImage` alanında multipart dosya olarak kabulü, `-custom` slug'ı / korumalı düzenleme ve Nano modelleri Wiro üzerinden (ücretli çalıştırma yapılmadı), fiyat değişikliğinin gerçek bir değişimle tespiti.
- Kurtarmada (`observe` + `providerTask`) referanslar yeniden okunur; referans silindiyse korumalı düzenleme kurtarılamaz ve iş deneme sınırında `failed` olur (görev kimliği mesajda).
- 250 sn sınırı aşılırsa ücretlenmiş Wiro görevi kaybolabilir (Aşama 3 kurtarma).
- Nano Banana korumalı düzenlemede desteklenmeyen oranlarda tuval tutmayabilir.
- Fiyatı "$0 model-reported" görünen modellerde tahmin yok; ücret iş bitince `totalcost`'tan.
