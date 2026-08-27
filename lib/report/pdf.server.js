import 'server-only';

/**
 * Rendering the report to a PDF.
 *
 * Lifted out of the download route so that emailing a report and downloading
 * one produce the same document. They were about to diverge: the route owned
 * the only copy of this, and a second caller would have meant a second
 * headless-Chrome setup with its own idea of the page size and its own set of
 * waits. A report that looks different depending on how it left the building is
 * a report nobody can refer to in a meeting.
 *
 * The mechanism is the app rendering itself. `/report/print` is a real page in
 * this application; a headless browser opens it with the analysis injected as
 * `window.PRINT_DATA` and prints the result. That keeps one implementation of
 * what a report *looks like* — the same components, the same charts, the same
 * palette — rather than a second one written in a PDF library that would drift
 * from the screen within a release.
 *
 * **The browser has to be signed in.** Every page in this app except the
 * sign-in screen is behind the middleware, and a freshly launched Chrome
 * carries no session — so it was being redirected to `/sign-in`, and the
 * "render finished" check was written to warn and carry on. The result was a
 * perfectly valid PDF of a login page. The caller's own cookies are therefore
 * handed to the browser, which makes it act as the person asking for the
 * report and nobody else, and the render check now fails loudly rather than
 * printing whatever happens to be on screen.
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

/** A4 at 96 DPI, which is what the print page is laid out against. */
const PAGE = { width: 794, height: 1123 };

/** Recharts animates in; this is the wait for it to settle before the shot. */
const SETTLE_MS = 3000;

/**
 * Thrown when the host has no browser to render with.
 *
 * Worth its own type because it is a deployment fact rather than a bug, and the
 * two callers want to say different things about it: the download offers
 * browser printing instead, and the emailer says the report could not be
 * attached. Both need to tell it apart from a genuine failure.
 */
export class ReportRendererUnavailable extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'ReportRendererUnavailable';
    // What the launch actually said. The callers phrase their own sentence and
    // put this in brackets after it: "no browser available" on its own reads as
    // a missing dependency whatever the real reason was, and sends whoever is
    // debugging it to install something that is already installed.
    this.cause = cause;
  }
}

/** Where Chrome is: a real one in development, a bundled one in production. */
async function executablePath() {
  if (process.env.NODE_ENV !== 'development') return chromium.executablePath();
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return '/usr/bin/google-chrome';
}

/**
 * How to start the browser, which is not the same question in the two places
 * this runs.
 *
 * Locally it is a real Chrome, and `headless: true` is right. On a serverless
 * host it is the chromium-*shell* build that `@sparticuz/chromium` ships, and
 * the distinction is not cosmetic: `chromium.args` already carries
 * `--headless='shell'`, so asking puppeteer for `headless: true` makes it add a
 * second, contradictory headless flag and the binary refuses to start. The
 * launch then throws, and the only thing the user is told is that no browser
 * was available — which reads as a missing dependency rather than two flags
 * disagreeing.
 *
 * `puppeteer.defaultArgs({ args, headless: 'shell' })` is the shape the package
 * documents, and it is what keeps puppeteer's own defaults consistent with the
 * flags Chromium was handed.
 */
function launchOptions(isLocal, executable) {
  const shared = {
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: executable,
  };
  if (isLocal) return { ...shared, args: [], headless: true };
  return {
    ...shared,
    args: puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    headless: 'shell',
  };
}

/**
 * Render one analysis to a PDF buffer.
 *
 * `origin` is the base URL this server is reachable at — the browser has to
 * fetch `/report/print` from the running app, so it cannot be guessed from
 * configuration and is passed in by the caller from the request it is serving.
 */
export async function renderReportPdf(analysis, { origin, cookies = [], timeoutMs = 60000 } = {}) {
  if (!analysis) throw new Error('There is no analysis to render.');
  if (!origin) throw new Error('The report renderer needs to know where this app is served from.');

  const isLocal = process.env.NODE_ENV === 'development';
  let browser = null;

  try {
    browser = await puppeteer.launch(launchOptions(isLocal, await executablePath()));
  } catch (error) {
    throw new ReportRendererUnavailable(
      `No browser is available to render the report (${error.message}).`,
      error.message
    );
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ ...PAGE, deviceScaleFactor: 2 });

    // What the page itself threw.
    //
    // Kept in two lists on purpose. An uncaught exception is a cause; a console
    // error usually is not — a favicon 404 fires before anything has rendered,
    // and reporting the first error of any kind named that instead of the React
    // crash that actually stopped the page. Exceptions win, resource-loading
    // noise is dropped outright, and only then does console output get a say.
    const crashes = [];
    const complaints = [];
    page.on('pageerror', (error) => crashes.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/failed to load resource/i.test(text)) return;
      complaints.push(text);
    });

    // The session, so the print page is reachable at all. Without this the
    // browser is a signed-out visitor and the middleware sends it to /sign-in.
    //
    // `secure` has to follow the origin: a session cookie set without it is
    // refused on https, which would put us straight back to rendering a login
    // page — in production only, where it is hardest to notice.
    const { hostname, protocol } = new URL(origin);
    const secure = protocol === 'https:';
    for (const cookie of cookies) {
      if (!cookie?.name) continue;
      await page
        .setCookie({
          name: cookie.name,
          value: cookie.value ?? '',
          domain: hostname,
          path: '/',
          secure,
        })
        .catch(() => {
          /* one unsettable cookie is not worth failing the render over */
        });
    }

    // Injected before navigation so the page has it on first render rather than
    // flashing its "no data" state and settling afterwards.
    await page.evaluateOnNewDocument((data) => {
      window.PRINT_DATA = data;
    }, analysis);

    await page.goto(`${origin.replace(/\/$/, '')}/report/print`, {
      waitUntil: 'networkidle0',
      timeout: timeoutMs,
    });

    // A hard failure, not a warning. This is the sentinel the print page sets
    // once it has the analysis and has drawn it; without it, whatever is on
    // screen is not the report — most likely the sign-in page — and printing it
    // anyway produces a valid PDF of the wrong thing, which is the worst
    // possible outcome for a document someone is about to email or file.
    try {
      await page.waitForSelector('.print-container-rendered', { timeout: 20000 });
    } catch {
      const landed = page.url();
      if (landed.includes('/sign-in')) {
        throw new Error('The renderer was signed out, so the report could not be reached.');
      }
      const cause = crashes.find(Boolean) || complaints.find(Boolean);
      throw new Error(
        cause
          ? `The report crashed while rendering: ${firstLine(cause)}`
          : `The report did not finish rendering (stopped at ${landed}).`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    return await page.pdf({
      width: `${PAGE.width}px`,
      height: `${PAGE.height}px`,
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** The first line of a stack-carrying error message, for a one-line report. */
function firstLine(text) {
  return String(text || '').split('\n')[0].trim().slice(0, 200);
}

/** The origin a request arrived on, for fetching this app's own pages. */
export function originOf(request) {
  const host = request.headers.get('host');
  if (!host) return null;
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  return `${protocol}://${host}`;
}

/**
 * The caller's cookies, to hand to the renderer.
 *
 * The browser is about to act as this user, so it gets exactly what they sent
 * and nothing else — no service-role shortcut, no bypass of the middleware.
 * Whatever they cannot read, the render cannot read either.
 */
export function cookiesOf(request) {
  try {
    return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
  } catch {
    return [];
  }
}

/** A filename someone will recognise in an inbox six months from now. */
export function reportFilename(title) {
  const base = String(title || 'Insight report')
    .replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || 'Insight report'}.pdf`;
}
