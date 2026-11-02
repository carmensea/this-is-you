import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { mockArchiveApi } from './services/archiveApi';
import { AppStore } from './state/store';
import { StoreContext } from './state/useStore';
import './styles/global.css';

mockArchiveApi.loadArchive().then((archive) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StoreContext.Provider value={new AppStore(archive)}>
        <App />
      </StoreContext.Provider>
    </StrictMode>,
  );
});
