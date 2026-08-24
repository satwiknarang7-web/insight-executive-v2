/**
 * Server-side text-to-speech via ElevenLabs.
 *
 * The avatar narration otherwise uses the browser's Web Speech API — free,
 * offline, no key — and that stays the default and the fallback. When
 * `ELEVENLABS_API_KEY` is set, narration is synthesised with a specific
 * ElevenLabs voice instead, which sounds markedly more natural.
 *
 * The key is read only here, on the server; the browser calls `/api/speech` and
 * never sees it. The voice is fixed by id (overridable via env) so the whole
 * app speaks in one chosen voice, while each analyst persona still shapes the
 * WORDS it is given — the persona changes the script, the voice reads it.
 *
 * Note: unlike the Web Speech path, this sends the (already anonymous,
 * number-only) narration text to a third party to be spoken. It is off unless a
 * key is configured, so the default deployment still speaks entirely on-device.
 */

// The voice the user chose from the ElevenLabs library.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'sB7vwSCyX0tQmU24cW2C';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export function hasElevenLabs() {
  return !!process.env.ELEVENLABS_API_KEY;
}

export function defaultVoiceId() {
  return DEFAULT_VOICE_ID;
}

/**
 * Synthesise `text` to MP3 audio. Returns a Buffer, or null when unconfigured
 * or the API fails — callers fall back to Web Speech rather than erroring.
 */
export async function synthesizeSpeech(text, { voiceId } = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !text) return null;

  const id = voiceId || DEFAULT_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=${OUTPUT_FORMAT}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!res.ok) {
      // The body can carry a quota/permission message; log it, never surface it.
      console.warn(`[elevenlabs] ${res.status} ${res.statusText}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.warn(`[elevenlabs] ${e.message}`);
    return null;
  }
}
