// Fork identity. Update feeds and release links point at this fork, never at
// upstream, and a release build cannot embed upstream's Sparkle public key.
export const FORK_REPOSITORY='SelcukOzbilgi/banana-studio';
export const UPSTREAM_SPARKLE_PUBLIC_KEY='tCeaGJqr03Z9mjsD6S0SJjmfINWOkfFr2bIwgk2khpU=';
export const feedUrl=architecture=>`https://github.com/${FORK_REPOSITORY}/releases/latest/download/appcast-${architecture}.xml`;
export function assertForkUpdateChannel({development,publicKey}) {
 if(!development&&publicKey.trim()===UPSTREAM_SPARKLE_PUBLIC_KEY)throw new Error('This fork has no Sparkle signing key of its own yet. Build with --development, or generate a fork key, commit its public half to desktop/macos/Resources/SparklePublicKey.txt and then package a release.');
}
