import { useEffect } from 'react';
import { DemoBanner, Header, Notice, SnapshotBar } from './components/AppShell';
import { BiomarkersScreen } from './screens/BiomarkersScreen';
import { CompareScreen } from './screens/CompareScreen';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ImportScreen } from './screens/ImportScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { useStore } from './state/useStore';
import { VIEWS, type View } from './state/store';
import { NoRecordsYet } from './screens/NoRecordsYet';
import { C } from './theme';
import { shellVM } from './viewmodels/shell';

/** These screens show extracted records, and a real archive has none yet. */
const NEEDS_RECORDS: View[] = ['overview', 'biomarkers', 'history', 'compare'];

const viewFromHash = (): View | null => {
  const h = window.location.hash.replace(/^#\/?/, '') as View;
  return VIEWS.includes(h) ? h : null;
};

export function App() {
  const store = useStore();
  const { view, rvDoc, notice } = store.state;

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

  const v = shellVM(store);
  const isDemo = store.archive.kind === 'demo';
  return (
    <div style={{ minHeight: '100vh', background: C.paper }}>
      <Header v={v} />
      {isDemo && <DemoBanner />}
      {notice && <Notice v={v} />}
      {view !== 'overview' && (isDemo || !NEEDS_RECORDS.includes(view)) && <SnapshotBar v={v} />}
      {!isDemo && NEEDS_RECORDS.includes(view) && <NoRecordsYet />}
      {isDemo && view === 'overview' && <OverviewScreen />}
      {isDemo && view === 'biomarkers' && <BiomarkersScreen />}
      {isDemo && view === 'history' && <HistoryScreen />}
      {view === 'documents' && <DocumentsScreen />}
      {view === 'import' && (rvDoc ? <ReviewScreen /> : <ImportScreen />)}
      {isDemo && view === 'compare' && <CompareScreen />}
    </div>
  );
}
