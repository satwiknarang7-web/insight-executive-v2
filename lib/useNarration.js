'use client';

/**
 * Narration that prefers the configured ElevenLabs voice and falls back to the
 * browser's Web Speech API.
 *
 * The presentation page does not care which engine speaks — it hands over a
 * script and a callback for when the script finishes. This hook keeps the same
 * shape as `useSpeech` so the page is unchanged, and hides the difference:
 *
 * - On mount it probes `/api/speech`. If the ElevenLabs voice is configured,
 *   `engine` becomes 'elevenlabs' and each script is synthesised server-side and
 *   played through an <audio> element.
 * - Otherwise, or if a request fails, or if autoplay is blocked, it delegates to
 *   Web Speech for that utterance — so narration never silently dies.
 *
 * `onDone` fires exactly once per completed script, whichever engine ran it, and
 * never for a script that was stopped or superseded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import useSpeech from './useSpeech';

export default function useNarration() {
  const web = useSpeech();
  // Destructure the STABLE callbacks. `web` is a fresh object every render, so
  // depending on it would give `speak`/`stop` a new identity each render — and
  // the presentation effect, which lists them as deps, would then cancel and
  // restart narration on every re-render, silencing both engines. These inner
  // functions are memoised in useSpeech, so they are safe dependencies.
  const { speak: webSpeak, stop: webStop } = web;
  const [engine, setEngine] = useState('web'); // 'web' | 'elevenlabs'
  const [elSpeaking, setElSpeaking] = useState(false);

  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const runRef = useRef(0); // invalidates the audio of a stopped/superseded run

  // Probe once for the ElevenLabs voice.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/speech')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.available) setEngine('elevenlabs');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Leaving the page must not leave audio playing.
  useEffect(() => cleanupAudio, [cleanupAudio]);

  const stop = useCallback(() => {
    runRef.current += 1;
    cleanupAudio();
    webStop();
    setElSpeaking(false);
  }, [webStop, cleanupAudio]);

  const speak = useCallback(
    (text, opts = {}) => {
      if (engine !== 'elevenlabs') {
        webSpeak(text, opts);
        return;
      }

      const run = ++runRef.current;
      cleanupAudio();
      webStop();
      setElSpeaking(true);

      fetch('/api/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voiceId: opts.voiceId }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`tts ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          if (runRef.current !== run) return;
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          if (opts.rate) audio.playbackRate = opts.rate;

          audio.onended = () => {
            if (runRef.current !== run) return;
            setElSpeaking(false);
            cleanupAudio();
            opts.onDone?.();
          };
          audio.onerror = () => {
            if (runRef.current !== run) return;
            setElSpeaking(false);
            cleanupAudio();
          };
          audio.play().catch(() => {
            // Autoplay blocked until a user gesture — speak it the browser way.
            if (runRef.current !== run) return;
            cleanupAudio();
            setElSpeaking(false);
            webSpeak(text, opts);
          });
        })
        .catch(() => {
          if (runRef.current !== run) return;
          setElSpeaking(false);
          // The request failed (no credits / quota / network). Don't keep paying
          // that latency on every slide — drop to the browser voice for the rest
          // of the session, and speak this chunk with it now.
          setEngine('web');
          webSpeak(text, opts);
        });
    },
    [engine, webSpeak, webStop, cleanupAudio]
  );

  return {
    speak,
    stop,
    speaking: engine === 'elevenlabs' ? elSpeaking || web.speaking : web.speaking,
    voices: web.voices,
    supported: engine === 'elevenlabs' ? true : web.supported,
    engine,
  };
}
