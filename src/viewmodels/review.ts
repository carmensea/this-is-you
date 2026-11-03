import type { InputChange } from './events';
import { fLong, fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { DCATL, DCATS } from '../domain/vocabulary';
import { EXTRACTION_LABEL, VERIFICATION_LABEL, displayValue } from '../domain/documentReview';
import type { DocumentReview, MetadataFieldKey } from '../domain/types';
import type { SegmentItem } from '../components/controls';
import type { ObservationFields } from '../components/ObservationForm';
import { C } from '../theme';
import type { AppState, AppStore } from '../state/store';

export type ReviewVM = NonNullable<ReturnType<typeof reviewVM>>;

type Item = { status: string; conf: string; edited: boolean };

function realLineStatus(real: DocumentReview, id: string): string {
  const o = real.observations.find((x) => x.id === id);
  if (!o) return '';
  if (o.verification_status === 'verified')
    return 'Accepted by you. Shown in Biomarkers if it has a collection date and an exact number.';
  if (o.verification_status === 'rejected') return 'Rejected. Not shown anywhere; still visible in the original.';
  return o.confidence ? `Proposed, not verified · ${o.confidence} confidence` : 'Not yet accepted';
}

function realLineEditedText(real: DocumentReview, id: string): string {
  const o = real.observations.find((x) => x.id === id);
  if (!o) return '';
  const was = o.original;
  const first = [was.reported_name, was.value_text, was.unit].filter(Boolean).join(' ');
  return `${o.origin === 'manual' ? 'First entered' : 'First read'} as ${first}${was.collected_on ? `, collected ${fShort(String(was.collected_on))}` : ', with no collection date'}. Kept in the history.`;
}

/** What only a real measurement has: where it came from, its dates, and its form. */
function lineExtras(store: AppStore, real: DocumentReview | undefined, id: string) {
  const o = real?.observations.find((x) => x.id === id);
  const when = (label: string, d: string | null | undefined) => `${label} ${d ? fShort(d) : 'unknown'}`;
  return {
    observation: o,
    realEditedText: real && o?.edited ? realLineEditedText(real, id) : '',
    dates: o
      ? [when('Collected', o.collected_on), when('Reported', o.reported_on), when('Documented', o.documented_on)].join(
          ' · ',
        )
      : '',
    evidence: !o
      ? ''
      : o.source_page
        ? `Source, page ${o.source_page}, line ${o.source_line}: "${o.source_text}"`
        : o.origin === 'manual'
          ? 'User-entered, not read from this document'
          : '',
    evidencePage: o?.source_page ?? 0,
    onShowPage: () => store.setState({ rvSourcePage: o?.source_page ?? null }),
    duplicateNote: o?.possible_duplicates.length
      ? 'The same result, date and unit also appears elsewhere in the archive. Charts show it once.'
      : '',
    onSaveForm: (fields: ObservationFields) => store.correctObservation(id, fields),
    onCancelForm: () => store.setState({ rvEdit: null }),
  };
}

function rawValue(real: DocumentReview, key: MetadataFieldKey): string {
  const f = real.fields[key];
  return f.value ?? f.proposal?.value ?? '';
}

function realEditedText(real: DocumentReview, key: MetadataFieldKey): string {
  const f = real.fields[key];
  return f.proposal
    ? `Read from the document as ${displayValue(key, f.proposal.value)}. Your correction is kept beside it.`
    : 'User-entered. Nothing was read from the document.';
}

function realStatusText(real: DocumentReview, key: MetadataFieldKey): string {
  const f = real.fields[key];
  if (f.state === 'confirmed') return 'Confirmed by you';
  if (f.state === 'corrected') return 'Corrected by you';
  if (f.state === 'not_stated') return 'You marked this as not stated in the document';
  if (!f.proposal) return 'Nothing was found. Enter it, or mark it as not stated.';
  return `Proposed, not verified · ${f.proposal.confidence} confidence`;
}

/** What only a real document's detail has: its evidence, its editor, and "not stated". */
function fieldExtras(store: AppStore, id: string, key: string, real: DocumentReview | undefined) {
  const none = {
    evidence: '',
    evidencePage: 0,
    onShowPage: () => {},
    editKind: 'text' as 'text' | 'date' | 'type',
    typeOptions: [] as SegmentItem[],
    canNotStated: false,
    onNotStated: () => {},
  };
  if (!real) return none;
  const k = key as MetadataFieldKey;
  const f = real.fields[k];
  const draft = store.state.rvDraft.value ?? '';
  return {
    evidence: f.proposal
      ? (f.proposal.snippet ? `Source, page ${f.proposal.page}: "${f.proposal.snippet}"` : 'Source: file properties') +
        ` · ${f.proposal.method}`
      : '',
    evidencePage: f.proposal?.snippet ? f.proposal.page : 0,
    onShowPage: () => store.setState({ rvSourcePage: f.proposal?.page ?? null }),
    editKind: k === 'service_date' ? ('date' as const) : k === 'document_type' ? ('type' as const) : ('text' as const),
    typeOptions: DCATS.map(([value, label]) => ({
      label: DCATL[value] ?? label,
      onClick: () => store.setState({ rvDraft: { value } }),
      pressed: draft === value,
      bg: draft === value ? C.ink : C.paper,
      fg: draft === value ? C.paper : C.ink,
    })),
    canNotStated: f.state !== 'not_stated',
    onNotStated: () => store.decideField(id, k, { action: 'not_stated' }),
  };
}

export function reviewVM(store: AppStore) {
  const archive = store.archive,
    s = store.state;
  const id = s.rvDoc;
  if (!id || !archive.documentsById[id]) return null;
  const real = archive.documentsById[id].review;
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
  const highPending = L.filter(
    (l) =>
      l.status === 'pending' &&
      l.conf === 'high' &&
      (!real || real.observations.find((o) => o.id === l.key)?.confidence === 'high'),
  );
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
    rvIsReal: !!real,
    rvContentUrl: d.contentUrl ? d.contentUrl + (s.rvSourcePage ? `#page=${s.rvSourcePage}` : '') : null,
    rvError: real ? s.rvError : null,
    rvIdentity: real?.identity?.status === 'possible_mismatch' ? real.identity.reason : null,
    rvTitle: d.title,
    rvMeta: real
      ? `${d.file} · imported ${d.imported} · ${real.pageCount ? plural(real.pageCount, 'page') : 'pages not read'} · ${EXTRACTION_LABEL[real.extraction]}`
      : d.source +
        ' · ' +
        (d.cat === 'lab' ? 'Collected ' : '') +
        fLong(d.date) +
        ' · ' +
        d.format +
        ' · imported ' +
        d.imported,
    rvFile: d.file + (d.pages ? ' · ' + plural(d.pages, 'page') : ''),
    rvProgress: real
      ? `${all.length - pending} of ${all.length} items resolved · ${edt} corrected · ${VERIFICATION_LABEL[real.verification]}`
      : all.length -
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
        fieldExtras(store, id, l.key, real),
        {
          label: l.label,
          value: l.value,
          isLow: l.conf === 'low' && !!l.reason,
          reason: l.reason,
          statusText: real ? realStatusText(real, l.key as MetadataFieldKey) : stText(l),
          statusColor: stColor(l),
          canConfirm: l.status !== 'confirmed' && (!real || !!real.fields[l.key as MetadataFieldKey].proposal),
          isEditing: editKey === 'f:' + l.key,
          dValue: dr.value == null ? '' : dr.value,
          onDValue: (e: InputChange) =>
            store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { value: e.target.value }) }),
          isEdited: l.edited,
          editedText: real ? realEditedText(real, l.key as MetadataFieldKey) : 'Extracted as ' + l.orig.value + '.',
          onConfirm: () => {
            const proposal = real?.fields[l.key as MetadataFieldKey].proposal;
            if (proposal)
              store.decideField(id, l.key as MetadataFieldKey, { action: 'confirmed', proposal_id: proposal.id });
            else store.patchReview(id, 'fields', l.key, { status: 'confirmed' });
          },
          onEdit: () =>
            store.setState({
              rvEdit: 'f:' + l.key,
              rvError: null,
              rvDraft: { value: real ? rawValue(real, l.key as MetadataFieldKey) : l.value },
            }),
          onSave: async () => {
            const v = (store.state.rvDraft || {}).value;
            if (real) {
              const saved = await store.decideField(id, l.key as MetadataFieldKey, {
                action: 'corrected',
                value: v ?? '',
              });
              if (saved) store.setState({ rvEdit: null });
              return;
            }
            store.patchReview(id, 'fields', l.key, { status: 'confirmed', value: v, edited: v !== l.orig.value });
            store.setState({ rvEdit: null });
          },
          onCancel: () => store.setState({ rvEdit: null }),
        },
        sqOf(l),
      ),
    ),
    rvNoneRecognized: !!real && !L.length,
    rvAdding: s.rvAdding,
    rvToggleAdd: () => store.setState((st) => ({ rvAdding: !st.rvAdding })),
    rvAddMeasurement: (fields: ObservationFields) => store.createObservation(fields, id, false),
    testNames: archive.testNames,
    rvLines: showL.map((l) =>
      Object.assign(
        lineExtras(store, real, l.key),
        {
          key: l.key,
          measure: l.measure,
          value: l.value,
          unit: l.unit,
          ref: l.ref,
          flag: l.flag,
          rowBg: s.rvLine === l.key ? '#EDE9DF' : 'transparent',
          deco: l.status === 'excluded' ? 'line-through' : 'none',
          isLow: !!l.reason && (real ? l.status !== 'excluded' : l.conf === 'low' && l.status === 'pending'),
          reason: l.reason,
          statusText: real ? realLineStatus(real, l.key) : stText(l),
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
            if (real) {
              void store.setObservationStatus(l.key, 'verify');
              return;
            }
            store.patchReview(id, 'lines', l.key, { status: 'confirmed' });
            store.setState({ rvLine: l.key });
          },
          onExclude: () =>
            real
              ? void store.setObservationStatus(l.key, 'reject')
              : store.patchReview(id, 'lines', l.key, { status: 'excluded' }),
          onRestore: () =>
            real
              ? void store.setObservationStatus(l.key, 'reopen')
              : store.patchReview(id, 'lines', l.key, { status: 'pending' }),
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
    rvHighLabel: (real ? 'Accept all ' : 'Confirm all ') + highPending.length + ' high-confidence values',
    rvConfirmHigh: () =>
      real
        ? void store.verifyObservations(highPending.map((l) => l.key))
        : store.setState((st) => {
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
      ? plural(pending, 'item') +
        (real
          ? ' still to resolve. Accept or reject each measurement, and confirm, correct or mark each detail as not stated.'
          : ' still to resolve. Confirm, correct or exclude each one.')
      : real
        ? 'Every detail is decided, and your decisions are saved. The next step marks the review as complete.'
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
    rvSumAdd: real
      ? `${plural(conf, 'measurement')} accepted and ${exc} rejected. Accepted results are linked to this document. Nothing is changed in the original file.`
      : L.length
        ? plural(conf, 'measurement') + ' will be added to the archive as reviewed, each linked to this document.'
        : 'The document details will be marked as reviewed.',
    rvEdits: all
      .filter((l) => l.edited)
      .map((l) => ({
        text: real
          ? l.measure
            ? `${l.measure}: ${realLineEditedText(real, l.key)}`
            : `${l.label}: ${realEditedText(real, l.key as MetadataFieldKey)}`
          : (l.measure || l.label) +
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
    rvAcceptLabel: real
      ? 'Mark document as reviewed'
      : L.length
        ? 'Accept ' + plural(conf, 'value') + ' into the archive'
        : 'Mark document as reviewed',
    rvAccept: () => {
      if (real) {
        void store.completeReview(id);
        return;
      }
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
