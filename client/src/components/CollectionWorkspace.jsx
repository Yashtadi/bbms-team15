import { useState } from 'react';
import { getSession } from '../api';
import useCampQueue from '../useCampQueue';
import CollectionDeskWizard from './CollectionDeskWizard';
import CampRecordForm from './CampRecordForm';
import CampSyncBar from './CampSyncBar';
import './CampMode.css';

// BBMS-F-010 to F-013: the collection workspace. "Collection desk" is the online wizard;
// "Outreach camp" records donations offline and syncs them later (F-013).

export default function CollectionWorkspace() {
  const userId = getSession()?.user?.id;
  const camp = useCampQueue(userId);
  const [mode, setMode] = useState(() => (camp.online ? 'desk' : 'camp'));

  return (
    <div className="collection-workspace">
      <div className="checkin-mode-toggle workspace-mode-toggle" role="group" aria-label="Collection mode">
        <button
          type="button"
          className={`mode-btn ${mode === 'desk' ? 'active' : ''}`}
          aria-pressed={mode === 'desk'}
          onClick={() => setMode('desk')}
        >
          <span>Collection desk</span>
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'camp' ? 'active' : ''}`}
          aria-pressed={mode === 'camp'}
          onClick={() => setMode('camp')}
        >
          <span>Outreach camp</span>
        </button>
      </div>

      {!camp.online && mode === 'desk' && (
        <div className="alert-box alert-error" role="alert">
          You are offline. Switch to Outreach camp to keep recording donations.
        </div>
      )}

      <CampSyncBar
        online={camp.online}
        syncing={camp.syncing}
        lastResult={camp.lastResult}
        pending={camp.pending}
        rejected={camp.rejected}
        synced={camp.synced}
        onSyncNow={camp.syncNow}
        onRemove={camp.remove}
        onClearSynced={camp.clearSynced}
      />

      {mode === 'desk' ? <CollectionDeskWizard /> : <CampRecordForm onSave={camp.add} />}
    </div>
  );
}
