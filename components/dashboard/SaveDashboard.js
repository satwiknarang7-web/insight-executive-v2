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
import { ACTION_ICON, SECONDARY_ACTION } from './actionStyles';

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
        className={SECONDARY_ACTION}
      >
        <Bookmark size={15} className={ACTION_ICON} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
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
