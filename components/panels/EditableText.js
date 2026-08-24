'use client';

/**
 * A piece of text on the dashboard that the user can rewrite in place.
 *
 * The analysis is generated, but the words are the user's to change — they are
 * the ones presenting them. Everything on the dashboard that is prose goes
 * through this component, so there is exactly one set of interaction rules for
 * all of it: click to type, blur or Enter to keep, Escape to abandon.
 *
 * Deliberately uncontrolled. A controlled input would push every keystroke
 * through the provider, persist it to IndexedDB and re-render the whole
 * dashboard — charts included — on each character. Committing on blur writes
 * once per edit instead. `key` is derived from the incoming value, so when a
 * late-arriving LLM narrative replaces the text underneath, the field remounts
 * with the new wording rather than sitting on stale content.
 */
import { useCallback, useRef } from 'react';

export default function EditableText({
  value,
  display = null,
  onCommit,
  editing = false,
  multiline = false,
  placeholder = '',
  rows = 3,
  className = '',
  as: As = 'p',
  ariaLabel,
}) {
  const ref = useRef(null);
  const original = value ?? '';

  const commit = useCallback(() => {
    const next = ref.current?.value ?? '';
    if (next.trim() === original.trim()) return;
    onCommit?.(next.trim());
  }, [onCommit, original]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (ref.current) ref.current.value = original;
        ref.current?.blur();
        return;
      }
      // Enter keeps a single-line edit. In a textarea it has to stay a newline,
      // so a multi-line field is committed with Ctrl/Cmd+Enter or by blurring.
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current?.blur();
      }
    },
    [multiline, original]
  );

  if (!editing) {
    const shown = display ?? value;
    return <As className={className}>{shown || placeholder}</As>;
  }

  const shared = {
    ref,
    defaultValue: original,
    onBlur: commit,
    onKeyDown,
    placeholder,
    'aria-label': ariaLabel,
    className: `${className} w-full rounded-lg border border-accent-500/40 bg-accent-500/[0.06] px-2.5 py-1.5 outline-none focus:border-accent-500`,
  };

  // Click-through guards: these fields sit inside cards that are links.
  const stop = { onClick: (e) => e.stopPropagation(), onMouseDown: (e) => e.stopPropagation() };

  // `key` is passed directly rather than through the spread: it remounts the
  // field when the text underneath changes, and React rejects it in a spread.
  return multiline ? (
    <textarea key={original} {...shared} {...stop} rows={rows} />
  ) : (
    <input key={original} {...shared} {...stop} type="text" />
  );
}
