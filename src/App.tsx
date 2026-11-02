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
import { C } from './theme';
import { shellVM } from './viewmodels/shell';

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
    if (viewFromHash() !== view) window.location.hash = '/' + view;
  }, [view]);

  const v = shellVM(store);
  return (
    <div style={{ minHeight: '100vh', background: C.paper }}>
      <Header v={v} />
      <DemoBanner />
      {notice && <Notice v={v} />}
      {view !== 'overview' && <SnapshotBar v={v} />}
      {view === 'overview' && <OverviewScreen />}
      {view === 'biomarkers' && <BiomarkersScreen />}
      {view === 'history' && <HistoryScreen />}
      {view === 'documents' && <DocumentsScreen />}
      {view === 'import' && (rvDoc ? <ReviewScreen /> : <ImportScreen />)}
      {view === 'compare' && <CompareScreen />}
    </div>
  );
}
