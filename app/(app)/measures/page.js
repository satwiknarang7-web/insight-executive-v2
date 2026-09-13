import { redirect } from 'next/navigation';

/**
 * Measures moved into Explore.
 *
 * Naming a calculation and reshaping a column are the same question asked
 * twice — what should this data say that the file does not — and they were on
 * two different pages, neither of which showed the rows being talked about.
 * They are two sections of Explore now, beside the table.
 *
 * The path stays, and redirects, because it is in bookmarks and in the history
 * of anyone who used it.
 */
export default function MeasuresPage() {
  redirect('/explore');
}
