import type { InputChange } from './events';
import { fLong, fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { DCATL } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppState, AppStore } from '../state/store';

export type ReviewVM = NonNullable<ReturnType<typeof reviewVM>>;

type Item = { status: string; conf: string; edited: boolean };

export function reviewVM(store: AppStore) {
  const archive = store.archive,
    s = store.state;
  const id = s.rvDoc;
  if (!id || !archive.documentsById[id]) return null;
  const d = archive.documentsById[id],
    x = store.reviewData(id),
    rs = (s.rv || {})[id] || { lines: {}, fields: {} };
  const L = x.lines.map((l) => ({
    status: 'pending',
    edited: false,
    ...l,
    ...rs.lines[l.key],
    orig: l,
    label: undefined as string | undefined,
  }));
  const F = x.fields.map((l) => ({
    status: 'pending',
    edited: false,
    ...l,
    ...rs.fields[l.key],
    orig: { ...l, unit: '', ref: '' },
    measure: undefined as string | undefined,
    unit: '',
    ref: '',
  }));
  const all = [...L, ...F],
    pending = all.filter((l) => l.status === 'pending').length;
  const conf = L.filter((l) => l.status === 'confirmed').length,
    exc = L.filter((l) => l.status === 'excluded').length,
    edt = all.filter((l) => l.edited).length;
  const highPending = L.filter((l) => l.status === 'pending' && l.conf === 'high');
  const dr = s.rvDraft;
  const seg = (on: boolean) => ({ bg: on ? C.ink : C.paper, fg: on ? C.paper : C.ink, pressed: !!on });
  const stText = (l: Item) =>
    l.status === 'confirmed'
      ? l.edited
        ? 'Corrected and confirmed'
        : 'Confirmed'
      : l.status === 'excluded'
        ? 'Excluded. Will not be added; still visible in the original.'
        : l.conf === 'low'
          ? 'Needs attention'
          : 'Not yet confirmed';
  const stColor = (l: Item) =>
    l.status === 'confirmed' ? C.green : l.status === 'excluded' ? C.ink3 : l.conf === 'low' ? C.rust : C.ink2;
  const sqOf = (l: Item) => ({
    sq: l.status === 'confirmed' ? C.green : l.status === 'excluded' ? C.ink3 : 'transparent',
    sqb: l.conf === 'low' && l.status === 'pending' ? '2px solid ' + C.rust : '1px solid ' + C.ink,
  });
  const filt = s.rvFilter || 'all';
  const showL = L.filter(
    (l) =>
      filt === 'all' ||
      (filt === 'attention'
        ? (l.status === 'pending' && l.conf === 'low') || l.status === 'pending'
        : l.status !== 'pending'),
  );
  const editKey = s.rvEdit;
  const out = {
    rvIsReview: s.rvStage === 'review',
    rvIsConfirm: s.rvStage === 'confirm',
    rvIsDone: s.rvStage === 'done',
    rvBack: () => {
      store.setState({ rvDoc: null, rvEdit: null });
      window.scrollTo(0, 0);
    },
    rvTitle: d.title,
    rvMeta:
      d.source +
      ' · ' +
      (d.cat === 'lab' ? 'Collected ' : '') +
      fLong(d.date) +
      ' · ' +
      d.format +
      ' · imported ' +
      d.imported,
    rvFile: d.file + (d.pages ? ' · ' + plural(d.pages, 'page') : ''),
    rvProgress:
      all.length -
      pending +
      ' of ' +
      all.length +
      ' items resolved · ' +
      conf +
      ' values confirmed · ' +
      edt +
      ' corrected · ' +
      exc +
      ' excluded',
    rvPctC: String(
      all.length ? Math.round((all.filter((l) => l.status === 'confirmed').length / all.length) * 100) : 0,
    ),
    rvPctE: String(all.length ? Math.round((all.filter((l) => l.status === 'excluded').length / all.length) * 100) : 0),
    rvHead: d.source,
    rvSub:
      (d.cat === 'lab'
        ? 'Collected ' + fShort(d.date) + ' · Reported ' + fShort(d.documented)
        : DCATL[d.cat] + ' · ' + fShort(d.date)) + (d.who ? ' · ' + d.who : ''),
    rvScanned: d.format.indexOf('Scanned') >= 0,
    rvHasLines: L.length > 0,
    rvNoLines: !L.length,
    rvPrev: L.map((l) => ({
      name: l.measure,
      value: l.orig.value,
      unit: l.orig.unit,
      ref: l.orig.ref,
      flag: l.orig.flag,
      deco: l.conf === 'low' ? 'underline dotted ' + C.rust : 'none',
      bg: s.rvLine === l.key ? C.greenT : 'transparent',
      outline: s.rvLine === l.key ? '1px solid ' + C.green : '1px solid transparent',
      onClick: () => store.setState({ rvLine: l.key }),
    })),
    rvFields: F.map((l) =>
      Object.assign(
        {
          label: l.label,
          value: l.value,
          isLow: l.conf === 'low' && !!l.reason,
          reason: l.reason,
          statusText: stText(l),
          statusColor: stColor(l),
          canConfirm: l.status !== 'confirmed',
          isEditing: editKey === 'f:' + l.key,
          dValue: dr.value == null ? '' : dr.value,
          onDValue: (e: InputChange) =>
            store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { value: e.target.value }) }),
          isEdited: l.edited,
          editedText: 'Extracted as ' + l.orig.value + '.',
          onConfirm: () => store.patchReview(id, 'fields', l.key, { status: 'confirmed' }),
          onEdit: () => store.setState({ rvEdit: 'f:' + l.key, rvDraft: { value: l.value } }),
          onSave: () => {
            const v = (store.state.rvDraft || {}).value;
            store.patchReview(id, 'fields', l.key, { status: 'confirmed', value: v, edited: v !== l.orig.value });
            store.setState({ rvEdit: null });
          },
          onCancel: () => store.setState({ rvEdit: null }),
        },
        sqOf(l),
      ),
    ),
    rvLines: showL.map((l) =>
      Object.assign(
        {
          key: l.key,
          measure: l.measure,
          value: l.value,
          unit: l.unit,
          ref: l.ref,
          flag: l.flag,
          rowBg: s.rvLine === l.key ? '#EDE9DF' : 'transparent',
          deco: l.status === 'excluded' ? 'line-through' : 'none',
          isLow: l.conf === 'low' && l.status === 'pending',
          reason: l.reason,
          statusText: stText(l),
          statusColor: stColor(l),
          canConfirm: l.status !== 'confirmed',
          canExclude: l.status !== 'excluded',
          isExcluded: l.status === 'excluded',
          isEdited: l.edited,
          editedText:
            'Extracted as ' +
            l.orig.value +
            ' ' +
            l.orig.unit +
            (l.orig.ref !== l.ref ? ', range ' + l.orig.ref : '') +
            (l.orig.flag !== l.flag ? ', flag ' + (l.orig.flag || 'none') : '') +
            '. The extracted value is kept in the review record.',
          isEditing: editKey === l.key,
          dValue: dr.value == null ? '' : dr.value,
          dUnit: dr.unit == null ? '' : dr.unit,
          dRef: dr.ref == null ? '' : dr.ref,
          onDValue: (e: InputChange) =>
            store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { value: e.target.value }) }),
          onDUnit: (e: InputChange) =>
            store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { unit: e.target.value }) }),
          onDRef: (e: InputChange) =>
            store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { ref: e.target.value }) }),
          flagOpts: [
            ['', 'None'],
            ['H', 'H, high'],
            ['L', 'L, low'],
          ].map(([fk, fl]) =>
            Object.assign(
              {
                label: fl,
                onClick: () => store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { flag: fk }) }),
              },
              seg((dr.flag || '') === fk),
            ),
          ),
          onFocus: () => store.setState({ rvLine: l.key }),
          onConfirm: () => {
            store.patchReview(id, 'lines', l.key, { status: 'confirmed' });
            store.setState({ rvLine: l.key });
          },
          onExclude: () => store.patchReview(id, 'lines', l.key, { status: 'excluded' }),
          onRestore: () => store.patchReview(id, 'lines', l.key, { status: 'pending' }),
          onEdit: () =>
            store.setState({
              rvEdit: l.key,
              rvLine: l.key,
              rvDraft: { value: l.value, unit: l.unit, ref: l.ref, flag: l.flag },
            }),
          onSave: () => {
            const dd = store.state.rvDraft || {};
            const ch =
              dd.value !== l.orig.value ||
              dd.unit !== l.orig.unit ||
              dd.ref !== l.orig.ref ||
              (dd.flag || '') !== l.orig.flag;
            store.patchReview(id, 'lines', l.key, {
              status: 'confirmed',
              value: dd.value,
              unit: dd.unit,
              ref: dd.ref,
              flag: dd.flag || '',
              edited: ch,
            });
            store.setState({ rvEdit: null });
          },
          onCancel: () => store.setState({ rvEdit: null }),
        },
        sqOf(l),
      ),
    ),
    rvLinesEmpty: !showL.length && L.length > 0,
    rvFilters: (
      [
        ['all', 'All ' + L.length],
        ['attention', 'Unresolved ' + L.filter((l) => l.status === 'pending').length],
        ['done', 'Resolved ' + L.filter((l) => l.status !== 'pending').length],
      ] as [AppState['rvFilter'], string][]
    ).map(([fk, fl]) =>
      Object.assign({ label: fl, onClick: () => store.setState({ rvFilter: fk }) }, seg(filt === fk)),
    ),
    rvHasHigh: highPending.length > 0,
    rvHighLabel: 'Confirm all ' + highPending.length + ' high-confidence values',
    rvConfirmHigh: () =>
      store.setState((st) => {
        const rv = Object.assign({}, st.rv);
        const c = Object.assign({ lines: {}, fields: {} }, rv[id]);
        c.lines = Object.assign({}, c.lines);
        highPending.forEach((l) => {
          c.lines[l.key] = Object.assign({}, c.lines[l.key], { status: 'confirmed' });
        });
        rv[id] = c;
        return { rv };
      }),
    rvPendingText: pending
      ? plural(pending, 'item') + ' still to resolve. Confirm, correct or exclude each one.'
      : 'Everything is resolved. Nothing is added to the archive until you accept on the next step.',
    rvPendingColor: pending ? C.rust : C.green,
    rvContinueDisabled: pending > 0,
    rvContinueBg: pending ? C.sunk : C.ink,
    rvContinueFg: pending ? C.ink3 : C.paper,
    rvContinue: () => {
      if (!pending) {
        store.setState({ rvStage: 'confirm' });
        window.scrollTo(0, 0);
      }
    },
    rvBackToReview: () => store.setState({ rvStage: 'review' }),
    rvSumAdd: L.length
      ? plural(conf, 'measurement') + ' will be added to the archive as reviewed, each linked to this document.'
      : 'The document details will be marked as reviewed.',
    rvEdits: all
      .filter((l) => l.edited)
      .map((l) => ({
        text:
          (l.measure || l.label) +
          ': extracted as ' +
          l.orig.value +
          (l.orig.unit ? ' ' + l.orig.unit : '') +
          ', corrected to ' +
          l.value +
          (l.unit ? ' ' + l.unit : '') +
          (l.ref && l.orig.ref !== l.ref ? ', range ' + l.ref : '') +
          '.',
      })),
    rvHasEdits: edt > 0,
    rvExcl: L.filter((l) => l.status === 'excluded').map((l) => ({
      text: l.measure + ': ' + l.orig.value + ' ' + l.orig.unit,
    })),
    rvHasExcl: exc > 0,
    rvAcceptLabel: L.length ? 'Accept ' + plural(conf, 'value') + ' into the archive' : 'Mark document as reviewed',
    rvAccept: () => {
      store.setState((st) => ({ accepted: Object.assign({}, st.accepted, { [id]: true }), rvStage: 'done' }));
      window.scrollTo(0, 0);
    },
    rvDoneText: L.length
      ? plural(conf, 'value') + ' from ' + d.title.toLowerCase() + ' are now marked as reviewed.'
      : 'The document details are now marked as reviewed.',
    rvOpenDoc: () => store.openDocument(id),
    rvNextQueue: () => {
      store.setState({ rvDoc: null, rvStage: 'review' });
      window.scrollTo(0, 0);
    },
  };
  return out;
}
