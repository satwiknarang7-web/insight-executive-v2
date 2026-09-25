'use client';

/**
 * Save the dashboard to the library. What is saved is the dashboard as it
 * stands — its charts' computed numbers, words and layout, plus the specs that
 * recompute it — so it opens again without the file, and refreshes when the
 * same file is loaded.
 */

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import SaveAnalysisDialog from '../panels/SaveAnalysisDialog';
import { useDashboard } from '../../lib/store/DashboardProvider';
import { useDataset } from '../../lib/store/DatasetProvider';

export default function SaveDashboard() {
  const { snapshotWithData } = useDashboard();
  const { dataset } = useDataset();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const [snap, setSnap] = useState(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSnap({ version: 2, dashboard: snapshotWithData() });
          setOpen(true);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white"
      >
        <Bookmark size={14} /> {saved ? 'Saved' : 'Save'}
      </button>
      {open && (
        <SaveAnalysisDialog
          snapshot={snap}
          datasetName={dataset?.fileName}
          rowCount={dataset?.rowCount}
          existing={saved}
          onClose={() => setOpen(false)}
          onSaved={(a) => setSaved(a)}
        />
      )}
    </>
  );
}
