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

**Durum: yapıldı** (`efe/claude-cli-text`, 2026-10-27). CLI 2.1.311 ile doğrulandı.

**Politika:** yalnız kişisel kullanım; kendi Claude aboneliğin, yalnız resmi `claude` CLI üzerinden. Uygulama Claude OAuth token'ını ya da `~/.claude` kimlik dosyalarını hiç okumaz, kopyalamaz, iletmez; giriş tamamen CLI'da kalır. Başkalarına "Claude ile giriş" özelliği olarak dağıtılmaz.

- Sağlayıcı `claude-cli`, etiket "Claude (abonelik)". Yalnız `anthropic/claude-opus-5.5` rotasında, ilk sırada: `['claude-cli', 'openrouter']`. Auto, CLI bulunursa onu seçer, bulunmazsa OpenRouter'a geçer (gönderimden önce; istek başarısız olursa başka sağlayıcıya tekrar gönderilmez).
- Yalnız masaüstü: `providerAvailability()` `claude-cli`'ı yalnız `BANANA_RUNTIME=local` iken ve masaüstü sunucusu `BANANA_CLAUDE_CLI` değişkenine doğrulanmış yolu yazdığında açık sayar. Web/Vercel'de route yok, seçenek ayarlarda gizli.
- Kod: `desktop/server/claudeCli.mjs` (bulma, argümanlar, ortam, çalıştırma, sonuç yorumu), `desktop/server/claudeText.mjs` (`/api/claude-cli-text-generate` ve `/api/claude-cli-status`), `desktop/server/main.mjs` (route'lar; `gemini-status` her GET'te CLI'ı yeniden arar). `api/` altına dosya eklenmedi.
- Çağrı: `claude -p --input-format stream-json --output-format stream-json --verbose --model claude-opus-5-5 --effort <low|medium|high|xhigh|max> --tools "" --strict-mcp-config --safe-mode --disable-slash-commands --permission-prompts none --no-session-persistence --system-prompt <sabit talimat> [--json-schema <şema>]`. Prompt ve görseller stdin'den tek bir user mesajı olarak gider (argv'de değil). `--bare` kullanılmaz (OAuth'u kapatır), `--fallback-model` kullanılmaz (sessiz model değişimi olurdu).
- Görseller: JPEG/PNG/WebP referansları stdin mesajında base64 `image` bloğu olarak gider; araç ya da geçici dosya gerekmez (`--tools ""`). YouTube görüntüsü (`fileData`) reddedilir; o iş Gemini'de kalır.
- Yapılandırılmış çıktı: Brainstorm ve video analizi şemaları `--json-schema` ile verilir (`$defs/$ref` dahil doğrulandı), `structured_output` okunur ve mevcut `normalizeBrainstormOutput`/analiz kontrolünden geçer. Yanıt biçimi OpenRouter handler'ı ile aynı (`text`, `provider: 'claude-cli'`, `providerModel`, NDJSON `status/heartbeat/result/error`).
- Çocuk süreç: boş geçici çalışma klasörü (iş bitince silinir), sıfırdan kurulan ortam: `PATH` (CLI klasörü + sistem), `HOME`, `USER`, `TMPDIR`, `LANG`, `DISABLE_AUTOUPDATER=1`. Sağlayıcı anahtarları ve `ANTHROPIC_API_KEY` çocuğa geçmez. `USER` şart: `env -i` denemelerinde `USER` yokken CLI her seferinde "Not logged in" dedi (Swift kabuğu Node'u yalnız `PATH/HOME/TMPDIR` ile başlatıyor; Swift değişmedi, ortam Node tarafında kuruluyor). init olayında `apiKeySource` bir API anahtarını gösterirse istek durdurulur.
- Sınırlar: 240 sn zaman aşımı (SIGTERM, 3 sn sonra SIGKILL), 8 MB stdout sınırı, tarayıcı isteği kapanırsa süreç öldürülür, referanslar en çok ~4,1 MB (diğer handler'larla aynı).
- Bulma: ayarlarda girilen yol (varsa tek aday; bozuksa açık hata, başka kuruluma sessizce geçilmez), yoksa `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.claude/local/claude`, `~/.npm-global/bin`, `~/.volta/bin`, `~/.bun/bin`, `~/.nvm/versions/node/*/bin`. Her aday `claude --version` çıktısında "(Claude Code)" ile doğrulanır. Ayar: AI ayarları → Provider routing → "Claude (abonelik) · Claude Code CLI" (yalnız Mac).
- Hatalar arayüzde açık: CLI bulunamadı (503), oturum açık değil (401, `/login` ipucu), abonelik limiti (429, `rate_limit_event.resetsAt` ile sıfırlanma saati), zaman aşımı (504), API anahtarı kullanımı (409), diğerleri CLI mesajıyla (502).
- Gerçek sağlayıcı görünür: Enhance sırasında "Claude Opus 5.5 · Claude (abonelik)"; Enhance/Variation/Brainstorm sonuçlarında `promptPreparation.provider` kaydedilir ve ayrıntılarda "Provider" satırı gösterilir. Kullanım `usage_logs`'a `estimated_cost: 0` ile yazılır.
- Gecikme (bu Mac, medium effort): kısa Enhance uçtan uca 3,6 sn (CLI 2,6 sn); görselli 2 fikirlik Brainstorm 5,8 sn. Uzun Enhance yönergeleri ve yüksek effort ile daha uzun sürer.
- Bilinen sınırlar: abonelik 5 saatlik/haftalık kullanım limitleri; denemeler sırasında aynı ortamla bir kez geçici "Not logged in" görüldü (tekrar denenince geçti) — otomatik tekrar yok, hata açıkça gösterilir. Yalnız Opus 5.5 rotası; GPT-6.1 Sol ve Gemini 3.8 Flash değişmedi.

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

**Aşama 2 — video (yapıldı, `efe/studio-upgrades`, 2026-10-30)**
- Şemalar ücretsiz `get_model_schema` ile okundu (Run yok). `bytedance/seedance-2-0`: `prompt`, `inputImage` (ilk kare), `inputImageLast`, `inputImageReference` (1–9, istemde `[Image 1]`), `inputAudio` (1–3; en az bir referans görsel ister, ilk/son kareyle birleşmez), `resolution` 480p/720p/1080p/4k, `ratio` (adaptive dahil), `duration` "4"–"15", `generateAudio` "true"/"false". `bytedance/seedance-2-5`: aynı, ses referansı yok, `duration` "4"–"30", ≤1080p. İkisinde de video girdisi, Edit ve Extend yok.
- Rota: `seedance-2.0` ve `seedance-2.5` → `['wiro','evolink','fal','openrouter']` (Wiro anahtarları varsa Auto'da ilk). `minimax-h3` **değişmedi** (fal; H3 Max seçenekleri fal'a özel). Wiro `minimax/h3` şeması (ilk/son kare, 4–15 sn, 768P/2K) belgelendi; bağlanması açık iş.
- Doğrulama (`seedanceProviderError`, Wiro dalı): video referansı/Edit/Extend/Ref Edit, Auto süre, 2.5'te ses, kare + ses ya da görselsiz ses → gönderimden önce açık hata (OpenRouter dalı gibi).
- Girdi: masaüstünde `uploads.mjs` Wiro dalı yerel görsel (≤20 MB) ve sesi (MP3/WAV ≤15 MB) data URL yapar; `api/_lib/wiroVideo.ts` bunları multipart Run'a dosya olarak koyar (loopback URL hiç gönderilmez, ön yükleme yok). Video referansı reddedilir. İstemdeki `@IMAGE_n` → `[Image n]`.
- Gönderim (`POST /api/seedance-video`, provider `wiro`): istek kaydedilmiş, kullanıcıya ait bir generation (`generationId`) ister, yoksa Run'dan önce 400. Aynı anda en çok 2 Wiro videosu (`processing` + `bs_wiro_` task, son 2 saat) — fazlası 429, istek gönderilmez. Tek imzalı Run → `taskid`; kayıt `provider_tasks`'a (`wiro`) ve **yanıt dönmeden önce** generation satırına yazılır (`task_id = bs_wiro_<model>_<taskid>`, `status: processing`, `metadata.providerTaskId/providerModel/generationProvider`). Run reddi → "No Wiro video was started"; bağlantı kopması → "Check Wiro usage before submitting again" (tekrar gönderilmez).
- Durum (`GET`): her çağrı tek `Task/Detail`. `task_postprocess_end` + `pexit "0"` → çıktı (`outputs[]` içinde `video/*` ya da `.mp4/.mov`, yalnız `*.wiro.ai` HTTPS) sunucuda indirilir (`redirect:'error'`, ≤256 MB) ve yerel depoya `…/wiro-video/<taskid>.mp4` olarak kopyalanır (Wiro CDN CORS'una güvenilmez; ikinci kontrol kopyayı yeniden kullanır). Başarısız/iptal → kalıcı FAILED ("Wiro does not bill failed tasks"). Gerçek ücret `totalcost` → `actualCostUsd` → ayrıntılarda "Actual Cost". Ayrıntılarda Provider Wiro, slug ve "Wiro task <id>".
- Yoklama sınırı: istemci `bs_wiro_` görevlerini 45 dk yoklar, sonra `RecoverableVideoTaskError` (görev kayıtlı kalır, yenilemede devam eder, yeniden gönderilmez). Uygulama yeniden açılınca `processing` + `task_id` satırları otomatik sürdürülür; Run çağrılmaz.
- REVIEW Y4 (bu yol): `updateVideoStatus` artık okuma/yazma hatasını yutmaz (metadata okunamazsa üzerine yazmaz, `false` döner); App'teki `task_id` yazımı ve durum güncellemesi başarısızsa kullanıcıya uyarı gösterilir. Fonksiyon hâlâ fırlatmaz (diğer çağıranlar buna göre yazılmış).
- Arayüz ipucu (Wiro seçiliyken): başlangıç karesi varsa yalnız hareketi anlat; döngü için sabit kamera; 5 sn / 720p en ucuz; aynı anda 2 Wiro videosu; başarısız görev ücretlenmez. Wiro video fiyatı (şema: 2.0 $0.28–11.66, 2.5 $0.42–17.06 istek başına) değişken olduğu için düğmede tahmin yok; "Billed at finish".
- Testler: `tests/wiro-video.test.mjs` (doğrulama, alan eşlemesi, data URL girdileri, tek Run + kayıt, eşzamanlılık sınırı, reddedilen Run, RUNNING → yeniden başlatma → SUCCEEDED + yerel kopya + gerçek ücret, FAILED, yabancı/bilinmeyen görev).
- Doğrulanmadı (ücretli çalıştırma yapılmadı): video `outputs[]` alan adları ve içerik tipi, aynı alanda birden çok `inputImageReference` dosyası, Task/Detail ara durum adları (ilerleme yüzdesi kaba).

**Aşama 2 — metin (Claude CLI) ve video**
- Claude CLI metin sağlayıcısı (yukarıda) — yapıldı.
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
