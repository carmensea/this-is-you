import { addMonths, fLong, fShort } from '../domain/dates';
import { C } from '../theme';
import { VIEWS, VIEW_LABELS, type AppStore } from '../state/store';

/** Header, snapshot bar and everything else shown on every screen. */
export function shellVM(store: AppStore) {
  const s = store.state,
    cur = s.cur,
    mode = store.snapshotMode,
    v = s.view;
  return {
    patientName: store.archive.patientName,
    patientLine: 'Patient: ' + store.archive.patientName + ' (fictional) · DOB ' + fShort(store.archive.born),
    nav: VIEWS.map((k) => ({
      label: VIEW_LABELS[k],
      onClick: () => store.go(k),
      border: k === v ? C.ink : 'transparent',
      color: k === v ? C.ink : C.ink2,
    })),
    openSettings: () => store.setState({ notice: 'Sources and settings' }),
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
