'use client';

/**
 * The logo, in one place.
 *
 * It used to be six copies of the same three lines — an icon in a rounded
 * square, the word "Insight", and a spaced-out label under it — in the landing
 * header, the sidebar at two widths, the sign-in page, the profile shell and
 * the PDF report. Changing the brand meant finding all six and getting the type
 * scale right in each, which is the kind of job that ends with five of them
 * updated.
 *
 * **Two files, swapped by CSS.** The artwork comes as two square PNGs on a
 * transparent background — one drawn light for the dark theme, one drawn dark
 * for the light one — so each is legible on exactly one of them. The theme here
 * is a `data-theme` attribute on `<html>` written by a blocking script before
 * first paint, so both images are rendered and one is hidden in CSS. Picking
 * the file in JavaScript instead would have to wait for hydration and would
 * show the wrong logo for a frame on every load, which is exactly the flash
 * that script exists to avoid.
 *
 * **The mark ships as its own file.** The artwork is a stacked lockup: the
 * hexagon above, the wordmark below. At the 24–40px height a header gives it,
 * the baked-in wordmark is three pixels tall and reads as grey mush — so the
 * header uses the hexagon alone and sets the product name beside it as live
 * type, which stays crisp at any size and in any theme.
 *
 * That framing used to be done in CSS, by sizing the 1080px artwork to 1.86x
 * its container and offsetting it behind `overflow: hidden`. It worked, and it
 * cost 480KB to draw a 32px mark: both themes are rendered and one is hidden,
 * so every page downloaded two 240KB files and threw away three quarters of
 * each. The browser then resampled 1080px of artwork down to 60, which is the
 * blurriest way to arrive at a small logo.
 *
 * The mark is now cropped to its own bounds at build time and shipped at 192px
 * — enough for the 56px `xl` at 3x — which is 28KB a theme and pin sharp. The
 * lockup is likewise shipped at the size anything actually displays it. No
 * arithmetic, no cropping window, and a fifth of the bytes.
 */

/** The hexagon alone, tight to its bounds. 192×192, transparent. */
export const MARK_DARK = '/brand/mark-dark.png';
export const MARK_LIGHT = '/brand/mark-light.png';

/** The whole stacked lockup, for the places with room for it. */
export const LOCKUP_DARK = '/brand/lockup-dark.png';
export const LOCKUP_LIGHT = '/brand/lockup-light.png';

/** The product, in text, for the places an image will not do. */
export const PRODUCT_NAME = 'Insight Executive';

const HEIGHTS = { sm: 24, md: 32, lg: 40, xl: 56 };

/**
 * The wordmark's type, per size.
 *
 * `size` used to move the hexagon and nothing else, so asking for a bigger logo
 * gave you a 56px mark standing next to 16px type — the lockup came apart
 * rather than growing. The name and the rule under it scale with the artwork
 * now, and the gap with them.
 */
const TYPE = {
  sm: { name: 'text-sm', sub: 'text-[7px] tracking-[0.3em]', gap: 'gap-2' },
  md: { name: 'text-base', sub: 'text-[8px] tracking-[0.35em]', gap: 'gap-2.5' },
  lg: { name: 'text-lg', sub: 'text-[9px] tracking-[0.35em]', gap: 'gap-3' },
  xl: { name: 'text-2xl', sub: 'text-[11px] tracking-[0.38em]', gap: 'gap-3.5' },
};

/** The mark, at the height asked for. */
function Mark({ src, height, className = '' }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={`block shrink-0 ${className}`}
      style={{ width: height, height }}
    />
  );
}

/**
 * @param {'lockup'|'mark'|'full'} variant  mark plus name, mark alone, or the
 *   whole stacked artwork.
 */
export default function Logo({ variant = 'lockup', size = 'md', className = '', title = PRODUCT_NAME }) {
  const height = HEIGHTS[size] || HEIGHTS.md;

  if (variant === 'full') {
    return (
      <span className={`inline-block ${className}`} title={title}>
        <img src={LOCKUP_DARK} alt={title} className="logo-dark block w-auto" style={{ height }} />
        <img src={LOCKUP_LIGHT} alt={title} className="logo-light w-auto" style={{ height }} />
      </span>
    );
  }

  const mark = (
    <>
      <Mark src={MARK_DARK} height={height} className="logo-dark" />
      <Mark src={MARK_LIGHT} height={height} className="logo-light" />
    </>
  );

  if (variant === 'mark') {
    return (
      <span className={`inline-flex shrink-0 ${className}`} title={title}>
        {mark}
        {/* The image is decorative once the name is not beside it, so the
            accessible name lives here rather than on an alt attribute. */}
        <span className="sr-only">{title}</span>
      </span>
    );
  }

  const type = TYPE[size] || TYPE.md;

  return (
    <span className={`inline-flex items-center ${type.gap} ${className}`} title={title}>
      {mark}
      <span className="flex flex-col leading-none">
        <span className={`${type.name} font-black tracking-tight`}>Insight</span>
        <span className={`${type.sub} font-black uppercase text-accent-500`}>Executive</span>
      </span>
    </span>
  );
}
