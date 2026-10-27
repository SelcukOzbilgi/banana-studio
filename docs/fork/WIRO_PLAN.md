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

- `outputs` biçimi doğrulanmadı.
- 250 sn sınırı aşılırsa ücretlenmiş Wiro görevi kaybolabilir (Aşama 3 kurtarma).
- Nano Banana korumalı düzenlemede desteklenmeyen oranlarda tuval tutmayabilir.
- Fiyatı "$0 model-reported" görünen modellerde tahmin yok; ücret iş bitince `totalcost`'tan.
