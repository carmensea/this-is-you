import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AppStore } from './store';

export const StoreContext = createContext<AppStore | null>(null);

/** The app store, re-rendering the caller on every state change. */
export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore needs a StoreContext provider');
  useSyncExternalStore(store.subscribe, store.getState);
  return store;
}
