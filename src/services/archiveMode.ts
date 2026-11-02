// Which archive this page is showing. Switching is a full page load, so no state crosses over.
export const isDemoMode = (search = window.location.search) => new URLSearchParams(search).has('demo');

export const openDemoArchive = () => window.location.assign('/?demo#/overview');
export const openPersonalArchive = () => window.location.assign('/#/documents');
