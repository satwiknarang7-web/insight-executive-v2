/**
 * Narration audio for the presentation.
 *
 * GET reports whether the ElevenLabs voice is available, so the client can
 * choose it and otherwise fall back to the browser's own speech synthesis.
 * POST returns MP3 audio for a chunk of narration text.
 *
 * The text is the same avatar script already shown on screen — anonymous,
 * number-only prose — never raw rows.
 */
import { hasElevenLabs, synthesizeSpeech, defaultVoiceId } from '../../../lib/elevenlabs.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  return Response.json({ available: hasElevenLabs(), voiceId: hasElevenLabs() ? defaultVoiceId() : null });
}

export async function POST(request) {
  if (!hasElevenLabs()) {
    return Response.json({ unavailable: true }, { status: 501 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ error: 'Nothing to speak.' }, { status: 400 });
  // A single narration chunk is a sentence or two; cap it so a bad caller cannot
  // run up the TTS bill.
  if (text.length > 3000) return Response.json({ error: 'Text too long.' }, { status: 413 });

  const audio = await synthesizeSpeech(text, { voiceId: body?.voiceId });
  if (!audio) return Response.json({ unavailable: true }, { status: 502 });

  return new Response(audio, {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'content-length': String(audio.length),
    },
  });
}
