import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!await requireUser(req, res)) return;

  // Fork: report which source serves YouTube lookups (Apify token first, Google key as fallback).
  const source = process.env.APIFY_TOKEN?.trim() ? 'apify' : process.env.YOUTUBE_API_KEY ? 'google' : null;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ configured: source !== null, source });
}
