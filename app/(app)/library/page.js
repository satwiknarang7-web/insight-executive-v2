'use client';

/**
 * The library, as a tab.
 *
 * It used to be a block on the profile page, deliberately outside the app
 * shell: the shell existed to hold a loaded dataset, and a shared analysis
 * arrives without the file behind it, so putting the library inside the shell
 * meant you could not reach your own library without first opening a
 * spreadsheet you did not have.
 *
 * That objection is answered rather than ignored. The nav entry carries
 * `standalone`, which is the flag the shell reads to decide whether a page may
 * render with nothing loaded — the same one Home and Settings use. So the
 * library is a tab now, and it stands on an empty session, which is the state
 * somebody following a share link is actually in.
 */
import AnalysisLibrary from '../../../components/panels/AnalysisLibrary';
import PageFrame from '../../../components/shell/PageFrame';

export default function LibraryPage() {
  return (
    <PageFrame
      title="Library"
      subtitle="Analyses you saved, and analyses people shared with you"
    >
      <AnalysisLibrary />
    </PageFrame>
  );
}
