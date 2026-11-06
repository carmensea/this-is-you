import { useEffect } from 'react';
import { DemoBanner, Header, Notice, SnapshotBar, StaleNotice } from './components/AppShell';
import { BiomarkersScreen } from './screens/BiomarkersScreen';
import { CompareScreen } from './screens/CompareScreen';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { SignIn } from './screens/SignIn';
import { SourcesScreen } from './screens/SourcesScreen';
import { useStore } from './state/useStore';
import { type View } from './state/store';
import { viewFromHash } from './services/archiveMode';
import { NoRecordsYet } from './screens/NoRecordsYet';
import { C } from './theme';
import { shellVM } from './viewmodels/shell';

/** These screens show verified results, which a real archive may not have yet. */
const NEEDS_RECORDS: View[] = ['overview', 'biomarkers', 'history', 'compare'];

export function App() {
  const store = useStore();
  const { view, rvDoc, notice, archiveStale, signedOut } = store.state;

  // Keeps the address bar and the back button in step with the current screen.
  useEffect(() => {
    const onHash = () => {
      const v = viewFromHash();
      if (v && v !== store.state.view) store.go(v);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [store]);
  useEffect(() => {
    // Reads the store, not this render's value: the address may have just changed the view.
    if (viewFromHash() !== store.state.view) window.location.hash = '/' + store.state.view;
  }, [store, view]);

  // Replaces the screens without leaving this page, so an import in progress can carry on after signing back in.
  if (signedOut) return <SignIn expired onSignedIn={store.afterSignIn} />;
  const v = shellVM(store);
  const isDemo = store.archive.kind === 'demo';
  const hasRecords = isDemo || store.archive.markers.length > 0;
  const blocked = !hasRecords && NEEDS_RECORDS.includes(view);
  return (
    <div style={{ minHeight: '100vh', background: C.paper }}>
      <Header v={v} />
      {isDemo && <DemoBanner />}
      {notice && <Notice v={v} />}
      {archiveStale && <StaleNotice onRetry={store.retryRefresh} />}
      {view !== 'overview' && view !== 'sources' && !blocked && <SnapshotBar v={v} />}
      {blocked && <NoRecordsYet />}
      {!blocked && view === 'overview' && <OverviewScreen />}
      {!blocked && view === 'biomarkers' && <BiomarkersScreen />}
      {!blocked && view === 'history' && <HistoryScreen />}
      {view === 'documents' && <DocumentsScreen />}
      {view === 'import' && (rvDoc ? <ReviewScreen /> : <ImportScreen />)}
      {!blocked && view === 'compare' && <CompareScreen />}
      {view === 'sources' && <SourcesScreen />}
    </div>
  );
}
