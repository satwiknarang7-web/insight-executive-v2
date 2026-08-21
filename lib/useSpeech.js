'use client';

/**
 * A small, well-behaved wrapper over the Web Speech API.
 *
 * Speech synthesis in browsers is full of sharp edges, and every one of these
 * is worked around here rather than in the presentation page:
 *
 * - `getVoices()` is empty on first call in Chrome until `voiceschanged` fires.
 * - An utterance longer than roughly 200 characters silently stops partway in
 *   Chrome, so text is split into sentence-sized chunks and queued.
 * - `speechSynthesis` is global to the tab: leaving the page mid-sentence keeps
 *   talking unless it is explicitly cancelled on unmount.
 * - `onend` fires for cancellations too, so a cancelled run must not be mistaken
 *   for a finished one — otherwise the deck auto-advances when the user hits stop.
 *
 * Audio never leaves the device, which keeps the presentation consistent with
 * the rest of the product.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Chrome truncates long utterances; keep each chunk comfortably under that. */
const MAX_CHUNK = 180;

/** Split a script into utterance-sized pieces, preferring sentence boundaries. */
export function chunkScript(text, max = MAX_CHUNK) {
  const clean = String(text || '').trim();
  if (!clean) return [];

  // Split only where sentence punctuation is FOLLOWED by whitespace. Matching
  // runs of non-punctuation instead treated the dot in "1.2" as a sentence
  // end, and the rejoin turned it into "1. 2" — spoken as two numbers.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > max) {
      // A single monstrous sentence still has to be broken somewhere; commas
      // are the least jarring place.
      if (current) {
        chunks.push(current);
        current = '';
      }
      let buffer = '';
      for (const piece of sentence.split(/,\s*/)) {
        // The ', ' rejoin costs two characters; not counting them let a chunk
        // land just over the limit, which is exactly where Chrome truncates.
        const joined = buffer ? `${buffer}, ${piece}` : piece;
        if (joined.length > max && buffer) {
          chunks.push(buffer.trim());
          buffer = piece;
        } else {
          buffer = joined;
        }
        // A single piece with no comma to break on has to be cut somewhere.
        while (buffer.length > max) {
          chunks.push(buffer.slice(0, max).trim());
          buffer = buffer.slice(max).trim();
        }
      }
      if (buffer) chunks.push(buffer.trim());
      continue;
    }

    if ((current + ' ' + sentence).trim().length > max) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = (current ? `${current} ` : '') + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export default function useSpeech() {
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  // Identifies the current run, so a cancelled run's `onend` can be ignored.
  const runRef = useRef(0);
  const doneRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    setSupported(true);

    const load = () => setVoices(window.speechSynthesis.getVoices() || []);
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);

    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      // Leaving the page must not leave a voice talking to an empty room.
      window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1; // invalidate any in-flight run
    doneRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /**
   * Speak a script. `onDone` fires only when the whole script finished on its
   * own — never when it was cancelled or replaced.
   */
  const speak = useCallback(
    (text, { voice = null, pitch = 1, rate = 1, onDone = null } = {}) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;

      window.speechSynthesis.cancel();
      const run = ++runRef.current;
      doneRef.current = onDone;

      const chunks = chunkScript(text);
      if (chunks.length === 0) {
        setSpeaking(false);
        onDone?.();
        return;
      }

      setSpeaking(true);
      chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        if (voice) u.voice = voice;
        u.pitch = pitch;
        u.rate = rate;

        if (i === chunks.length - 1) {
          u.onend = () => {
            if (runRef.current !== run) return; // superseded or stopped
            setSpeaking(false);
            doneRef.current?.();
          };
        }
        u.onerror = () => {
          if (runRef.current !== run) return;
          setSpeaking(false);
        };
        window.speechSynthesis.speak(u);
      });
    },
    []
  );

  return { speak, stop, speaking, voices, supported };
}
