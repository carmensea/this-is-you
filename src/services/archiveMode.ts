// Which archive this page is showing. Switching is a full page load, so no state crosses over.
import { VIEWS, type View } from '../state/store';

/** The screen named in the address, if any. */
export const viewFromHash = (hash = window.location.hash): View | null => {
  const name = hash.replace(/^#\/?/, '') as View;
  return VIEWS.includes(name) ? name : null;
};

export const isDemoMode = (search = window.location.search) => new URLSearchParams(search).has('demo');

export const openDemoArchive = () => window.location.assign('/?demo#/overview');
export const openPersonalArchive = () => window.location.assign('/#/documents');
