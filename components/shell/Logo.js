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
 * **Why the mark is cropped rather than shipped separately.** The artwork is a
 * stacked lockup: the hexagon above, the wordmark below. At the 24–40px height
 * a header gives it, the baked-in wordmark is three pixels tall and reads as
 * grey mush. So the image is framed to its hexagon and the product name is set
 * beside it as live type, which stays crisp at any size and in any theme. The
 * whole lockup is still available as `full`, for the places with room for it.
 */

/** The artwork, one per theme. Both are 1080×1080 on a transparent background. */
export const LOGO_DARK = '/brand/logo-dark.png';
export const LOGO_LIGHT = '/brand/logo-light.png';

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

/**
 * Where the hexagon sits inside the 1080×1080 artwork.
 *
 * Measured off the file rather than guessed: the mark's outer dots run from
 * about (315, 105) to (780, 645), so a square window of 580 centred on that
 * starts at (258, 85) and leaves a little air on every side.
 *
 * Written as `size / window` and `-offset / window` rather than as decimals, so
 * the source measurements stay visible — a re-export at another resolution only
 * needs the first number changed, as long as the composition holds.
 */
const ART = 1080;
const WINDOW = 580;
const CROP = { scale: ART / WINDOW, left: -258 / WINDOW, top: -85 / WINDOW };

/**
 * The hexagon alone, framed out of the stacked artwork.
 *
 * `object-position` cannot do this: the source is square and so is the window,
 * so `cover` scales it 1:1 and there is nothing left to reposition. Zooming in
 * means sizing the image past its container and offsetting it, which is what
 * these three numbers are.
 */
function Mark({ src, height, className = '' }) {
  return (
    <span
      className={`relative block overflow-hidden ${className}`}
      style={{ width: height, height }}
      aria-hidden="true"
    >
      <img
        src={src}
        alt=""
        className="absolute max-w-none"
        style={{
          width: height * CROP.scale,
          height: height * CROP.scale,
          left: height * CROP.left,
          top: height * CROP.top,
        }}
      />
    </span>
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
        <img src={LOGO_DARK} alt={title} className="logo-dark block w-auto" style={{ height }} />
        <img src={LOGO_LIGHT} alt={title} className="logo-light w-auto" style={{ height }} />
      </span>
    );
  }

  const mark = (
    <>
      <Mark src={LOGO_DARK} height={height} className="logo-dark" />
      <Mark src={LOGO_LIGHT} height={height} className="logo-light" />
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
