'use client';

/**
 * Turn a list of slide images into a video file, in the browser.
 *
 * Each slide is an image (captured from the real slide, see
 * components/present/VideoExport.js) held on screen for its duration, with a
 * short crossfade between slides, a slow push-in while it is up, and a thin
 * progress rule along the bottom — the same deck, moving the way the
 * slideshow does. The video is silent.
 *
 * It records with MediaRecorder from a canvas, which means recording runs in
 * real time: a two-minute deck takes two minutes to record. That is the price
 * of needing no server, no ffmpeg and no upload — the slides never leave the
 * browser.
 */

/**
 * What to record, best first. H.264 in MP4 is what QuickTime, PowerPoint and
 * phones open, so it leads. Next is WebM, not a bare "video/mp4": a browser
 * without H.264 fills a bare MP4 with VP9 and Opus, which those same players
 * refuse while the extension promises they will not. The bare MP4 stays last
 * for Safari, which records nothing else and fills it with H.264.
 */
const TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

export function pickVideoType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || null;
}

/** Whether this browser can make a video at all, and why not if it cannot. */
export function videoSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: 'Not in a browser.' };
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    return { ok: false, reason: 'This browser cannot record a canvas. Try Chrome, Edge, Firefox or a recent Safari.' };
  }
  if (!pickVideoType()) {
    return { ok: false, reason: 'This browser cannot record video. Try Chrome, Edge, Firefox or a recent Safari.' };
  }
  return { ok: true };
}

export const extensionFor = (type) => (String(type).startsWith('video/mp4') ? 'mp4' : 'webm');

const FADE_MS = 450;
const FPS = 30;

/** Draw `img` to cover the canvas, pushed in by `zoom` around the centre. */
function drawCover(ctx, img, w, h, zoom, alpha) {
  if (!img) return;
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

/**
 * Record the slides.
 *
 * slides:     [{ image: CanvasImageSource, ms: number }]
 * onProgress: (elapsedMs, totalMs, slideIndex) => void
 * signal:     an AbortSignal; aborting stops and resolves null.
 *
 * Resolves the finished video as a Blob, or null when cancelled.
 */
export async function recordSlides({ slides, width = 1920, height = 1080, background = '#0a0a0b', accent = '#34d399', onProgress, signal }) {
  const type = pickVideoType();
  if (!type) throw new Error('This browser cannot record video.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const starts = [];
  let total = 0;
  for (const s of slides) {
    starts.push(total);
    total += s.ms;
  }

  const tracks = canvas.captureStream(FPS).getVideoTracks();
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  const finished = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  // Paint the first frame before recording starts, so the video does not open
  // on an empty canvas.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  drawCover(ctx, slides[0]?.image, width, height, 1, 1);

  recorder.start(1000);

  const pageStart = performance.now();
  const now = () => performance.now() - pageStart;

  let cancelled = false;
  await new Promise((resolve) => {
    const frame = () => {
      const t = now();
      if (signal?.aborted || t >= total) {
        cancelled = !!signal?.aborted;
        clearInterval(id);
        resolve();
        return;
      }
      let i = starts.length - 1;
      while (i > 0 && starts[i] > t) i -= 1;
      const into = t - starts[i];
      const zoom = 1 + 0.025 * Math.min(1, into / slides[i].ms);

      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      if (i > 0 && into < FADE_MS) {
        drawCover(ctx, slides[i - 1].image, width, height, 1.025, 1);
        drawCover(ctx, slides[i].image, width, height, zoom, into / FADE_MS);
      } else {
        drawCover(ctx, slides[i].image, width, height, zoom, 1);
      }
      ctx.fillStyle = accent;
      ctx.fillRect(0, height - 6, (width * t) / total, 6);

      onProgress?.(t, total, i);
    };
    // An interval rather than animation frames: frames stop entirely in a
    // hidden tab, and an interval only slows down.
    const id = setInterval(frame, 1000 / FPS);
    frame();
  });

  // Let the last frame reach the recorder.
  await new Promise((r) => setTimeout(r, 250));
  recorder.stop();
  await finished;
  tracks.forEach((t) => t.stop());
  if (cancelled) return null;
  onProgress?.(total, total, slides.length - 1);
  return new Blob(chunks, { type: type.split(';')[0] });
}
