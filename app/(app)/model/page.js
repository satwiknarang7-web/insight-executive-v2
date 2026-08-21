'use client';

import { useDataset } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import DataModelReview from '../../../components/panels/DataModelReview';

export default function ModelPage() {
  const { dataset } = useDataset();
  const tables = dataset?.tables || [];

  return (
    <PageFrame
      title="Data model"
      subtitle={
        tables.length > 1
          ? `How ${tables.length} tables were related to each other`
          : dataset?.fileName
      }
    >
      <DataModelReview />
    </PageFrame>
  );
}
