import { addMonths, fLong, fShort } from '../domain/dates';
import { C } from '../theme';
import { openDemoArchive, openPersonalArchive } from '../services/archiveMode';
import { VIEWS, VIEW_LABELS, type AppStore } from '../state/store';

/** Header, snapshot bar and everything else shown on every screen. */
export function shellVM(store: AppStore) {
  const s = store.state,
    cur = s.cur,
    mode = store.snapshotMode,
    v = s.view;
  return {
    patientName: store.archive.patientName,
    patientLine: store.archive.born
      ? 'Patient: ' + store.archive.patientName + ' (fictional) · DOB ' + fShort(store.archive.born)
      : '',
    isDemo: store.archive.kind === 'demo',
    archiveLabel:
      store.archive.kind === 'demo'
        ? `Archive: ${store.archive.patientName} (sample)`
        : 'Archive: your documents (local)',
    switchLabel: store.archive.kind === 'demo' ? 'Leave demo' : 'Open demo archive',
    switchArchive: store.archive.kind === 'demo' ? openPersonalArchive : openDemoArchive,
    nav: VIEWS.map((k) => ({
      label: VIEW_LABELS[k],
      onClick: () => store.go(k, { rvDoc: null }), // A tab opens its own page, not a document left open there.
      border: k === v ? C.ink : 'transparent',
      color: k === v ? C.ink : C.ink2,
    })),
    openSettings: () => store.go('sources'),
    hasNotice: !!s.notice,
    noticeText: (s.notice || '') + ' is planned for a later iteration.',
    closeNotice: () => store.go('overview'),
    notOverview: v !== 'overview',
    hasReturn: !!s.returnTo,
    goBack: store.goBack,
    returnLabel: s.returnTo ? VIEW_LABELS[s.returnTo.view] : '',
    crumb: v === 'overview' ? '' : VIEW_LABELS[v],
    goOverview: () => store.go('overview'),
    cur,
    curLong: fLong(cur),
    curShort: fShort(cur),
    stepYB: () => store.setCur(addMonths(cur, -12)),
    stepMB: () => store.setCur(addMonths(cur, -1)),
    stepMF: () => store.setCur(addMonths(cur, 1)),
    stepYF: () => store.setCur(addMonths(cur, 12)),
    goToday: () => store.setCur(store.archive.today),
    setKnown: () => store.setState({ mode: 'known' }),
    setNow: () => store.setState({ mode: 'now' }),
    knownPressed: mode === 'known',
    nowPressed: mode === 'now',
    knownBg: mode === 'known' ? C.ink : 'transparent',
    knownFg: mode === 'known' ? C.paper : C.ink,
    nowBg: mode === 'now' ? C.ink : 'transparent',
    nowFg: mode === 'now' ? C.paper : C.ink,
  };
}
