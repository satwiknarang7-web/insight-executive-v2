import { redirect } from 'next/navigation';

/**
 * The root is the app, and the app has a shell.
 *
 * Everything that used to live here — the data source, the dropzone, the
 * samples, the key — is now the Home tab inside that shell, alongside the
 * dashboard and the explorer rather than in front of them. Loading a source is
 * part of the work, not a doorway to it, and pretending otherwise meant the one
 * screen where someone starts was the one screen with no navigation on it.
 *
 * This path is not public — `middleware.js` sends a signed-out visitor to
 * `/sign-in`, which carries the pitch — so nobody arrives here without an
 * account and there is nothing to show them but where they were going.
 */
export default function RootPage() {
  redirect('/home');
}
