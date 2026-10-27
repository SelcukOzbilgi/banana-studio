@AGENTS.md

# Efe'nin Banana Studio fork'u

Upstream `orkunisitmak/banana-studio` (MIT) üzerinden kişisel Mac uygulaması. Hedef: görsel/video için **Wiro** (Signature modu), metin özellikleri için **Efe'nin kendi Claude aboneliği** (yerel `claude` CLI, API ücreti yok).

## Repo ve remote'lar

- `origin` = `SelcukOzbilgi/banana-studio` (fork, public). `gh` varsayılanı bu repo.
- `upstream` = `orkunisitmak/banana-studio`; push kapalı. Upstream'e PR açma.
- PR'lar her zaman `--repo SelcukOzbilgi/banana-studio --base main` ile.
- Çalışma dalları `efe/<konu>`.

## Belgeler

- `docs/fork/WIRO_PLAN.md`: kararlar, Wiro API özeti, model eşlemesi, aşamalar, build komutları, riskler.
- `docs/fork/REVIEW.md`: upstream v0.1.3 inceleme raporu (bilinen hatalar ve öncelikleri).

## Kurallar

- Yalnız Mac masaüstü hedef; web/Supabase/Vercel tarafına gerekmedikçe dokunma.
- Bilinen hatalar Wiro yolunu etkiliyorsa önce onları düzelt (REVIEW.md "Mac fork için öncelik sırası").
- Anahtarlar Keychain'de; koda, loga, commit'e girmez. Claude OAuth token'ı CLI dışına çıkarılmaz.
- Ücretli Wiro çağrısını yalnız Efe onaylarsa yap; testlerde sahte yanıt kullan.
- Değişiklikten sonra `npm run typecheck` ve `npm test`; Swift değiştiyse `npm run test:macos`.
