'use client';

import { PenLine } from 'lucide-react';

/**
 * Who wrote the sentences.
 *
 * The provider has always tracked `analysis.narrated` and nothing showed it,
 * so a reader had no way to tell a model-refined paragraph from the built-in
 * analyst's — which matters most in the deployment the README advertises, the
 * one with no API key, where the answer is always "nobody's model".
 */
export default function NarrationNote({ narrated, className = '' }) {
  return (
    <p className={`flex items-center gap-2 text-[11px] leading-relaxed text-white/45 ${className}`}>
      <PenLine size={11} className="shrink-0" />
      {narrated
        ? 'Wording refined by a language model; every number computed locally.'
        : 'Wording by the built-in analyst. No language model saw this dataset.'}
    </p>
  );
}
