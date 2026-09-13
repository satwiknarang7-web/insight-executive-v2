/**
 * Read a table out of a photograph or a PDF.
 *
 * The one place in this app where a model is asked for *facts* rather than for
 * wording, and the exception is deliberate: there is no deterministic way to
 * read handwriting, so either a model does it or the document cannot be
 * analysed at all. What does not change is what happens next — the rows it
 * returns are cleaned, profiled, queried and charted by exactly the same code
 * as a CSV, every statistic is still computed by SQL over them, and the model
 * is never asked what any of it means.
 *
 * What it *is* asked for, besides the values, is which cells it was unsure of.
 * Those travel with the rows into the confidence store, so a finding resting on
 * a smudged column is capped the same way one resting on a guessed date is. A
 * blurred digit becoming a confident number is the failure this exists to
 * prevent, and it is the whole reason the extraction runs through this app
 * rather than any other.
 *
 * On the caller's own key, and Pro only. Vision costs real money per page, and
 * this deployment holds no model credentials to spend.
 */
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  EXTRACTABLE_TYPES,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  MAX_DOCUMENT_BYTES,
  extractionToTable,
} from '../../../lib/documentExtraction.js';
import { callerGeminiKey, extractJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Vision reads a page at a time and is slower than text; give it room. */
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

export async function POST(request) {
  const denied = await refusedFor('model');
  if (denied) return NextResponse.json(denied, { status: 402 });

  const apiKey = callerGeminiKey(request);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Reading a document needs your own Gemini key. Connect one to use this.' },
      { status: 400 }
    );
  }

  const refused = await enforceLimit(request, 'extract');
  if (refused) return refused;

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No document was uploaded.' }, { status: 400 });
  }

  const mimeType = String(file.type || '').toLowerCase();
  if (!EXTRACTABLE_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `${mimeType || 'That file type'} cannot be read as a document. Upload a PNG, JPEG, WebP or PDF.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: `That document is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer()).toString('base64');
  const client = new GoogleGenerativeAI(apiKey);

  let lastReason = null;
  for (const modelName of MODELS) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        systemInstruction: EXTRACTION_SYSTEM_PROMPT,
      });
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: bytes } },
              { text: 'Extract every table in this document as JSON.' },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA,
        },
      });

      const parsed = extractJson(result.response.text());
      if (!parsed?.columns?.length || !parsed?.rows?.length) {
        lastReason = 'no_table';
        continue;
      }

      const table = extractionToTable(parsed, { label: file.name || 'Document' });
      if (!table.rows.length) {
        lastReason = 'no_table';
        continue;
      }

      return NextResponse.json({
        table,
        // Reported so the screen can say what it is about to hand over, before
        // anything is analysed on top of it.
        summary: {
          rows: table.rows.length,
          columns: table.columns.length,
          uncertain: table.uncertain.length,
          model: modelName,
        },
      });
    } catch (e) {
      // The key itself is never in here: `viaGemini` takes the same care, and
      // for the same reason.
      console.warn(`[extract] ${modelName}: ${e.message}`);
      lastReason = e.message;
    }
  }

  return NextResponse.json(
    {
      error:
        lastReason === 'no_table'
          ? 'No table could be read in that document. A clearer photo, or one page at a time, usually helps.'
          : 'That document could not be read.',
    },
    { status: 502 }
  );
}
