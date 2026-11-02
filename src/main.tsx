import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ArchiveUnavailable } from './screens/ArchiveUnavailable';
import { isDemoMode } from './services/archiveMode';
import { connectLocalArchive } from './services/localArchiveApi';
import { AppStore } from './state/store';
import { StoreContext } from './state/useStore';
import './styles/fonts.css';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);

function show(store: AppStore) {
  root.render(
    <StrictMode>
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>
    </StrictMode>,
  );
}

async function start() {
  if (isDemoMode()) {
    document.title = 'This Is You (fictional demo)';
    const { demoArchiveApi } = await import('./services/demoArchiveApi');
    show(new AppStore(await demoArchiveApi.loadArchive()));
    return;
  }
  try {
    const { api, backend } = await connectLocalArchive();
    const archive = await api.loadArchive();
    const store = new AppStore(archive, { view: 'documents', cur: archive.today }, backend);
    show(store);
    store.watchReading();
  } catch {
    // Never fall back to the demo here: fictional records must not stand in for someone's own.
    root.render(<ArchiveUnavailable onRetry={start} />);
  }
}

void start();
