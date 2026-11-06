import type { InputChange } from './events';
import { fLong, fShort } from '../domain/dates';
import { plural } from '../domain/format';
import { DCATL, DCATS } from '../domain/vocabulary';
import { EXTRACTION_LABEL, VERIFICATION_LABEL, displayValue } from '../domain/documentReview';
import type { DocumentReview, LabObservation, MetadataFieldKey } from '../domain/types';
import type { SegmentItem } from '../components/controls';
import type { ObservationFields } from '../components/ObservationForm';
import { C } from '../theme';
import { KIND_TAG, nextPending, rowKind, splitIssues, type RowKind } from '../domain/reviewRows';
import type { AppState, AppStore } from '../state/store';

export type ReviewVM = NonNullable<ReturnType<typeof reviewVM>>;

type Item = { status: string; conf: string; edited: boolean };

export const REJECTED_TEXT =
  'Rejected. Left out of your verified records, and kept here and in the review history. Restore it to decide again.';

function realLineStatus(observations: LabObservation[], id: string): string {
  const o = observations.find((x) => x.id === id);
  if (!o) return '';
  if (o.verification_status === 'verified' && o.approved_group_id)
    return `Accepted by you as part of a group on ${fShort(o.revisions[o.revisions.length - 1].occurred_at.slice(0, 10))}. Shown in Biomarkers if it has a collection date and an exact number.`;
  if (o.verification_status === 'verified')
    return 'Accepted by you. Shown in Biomarkers if it has a collection date and an exact number.';
  if (o.verification_status === 'rejected') return REJECTED_TEXT;
  return o.confidence ? `Proposed, not verified · ${o.confidence} confidence` : 'Not yet accepted';
}

function realLineEditedText(observations: LabObservation[], id: string): string {
  const o = observations.find((x) => x.id === id);
  if (!o) return '';
  const was = o.original;
  const first = [was.reported_name, was.value_text, was.unit].filter(Boolean).join(' ');
  return `${o.origin === 'manual' ? 'First entered' : 'First read'} as ${first}${was.collected_on ? `, collected ${fShort(String(was.collected_on))}` : ', with no collection date'}. Kept in the history.`;
}

/** What only a real measurement has: where it came from, its dates, and its form. */
function providerSource(o: LabObservation): string {
  const r = o.source_resource;
  if (!r) return o.source_text ?? '';
  const version = `version ${r.version_number} of ${r.versions_kept} kept${r.version_id ? `, the provider's version ${r.version_id}` : ''}`;
  return `Read from ${r.provider ?? 'a provider'}: ${r.resource_type} ${r.fhir_id}, ${version}, received ${fShort(r.fetched_at.slice(0, 10))}. Every version is kept as received.`;
}

function lineExtras(store: AppStore, observations: LabObservation[] | undefined, id: string) {
  const o = observations?.find((x) => x.id === id);
  const when = (label: string, d: string | null | undefined) => `${label} ${d ? fShort(d) : 'unknown'}`;
  return {
    observation: o,
    realEditedText: observations && o?.edited ? realLineEditedText(observations, id) : '',
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
          : o.origin === 'fhir'
            ? providerSource(o)
            : '',
    evidencePage: o?.source_page ?? 0,
    pdfTarget: o?.source_page ? { page: o.source_page, text: o.source_text ?? '', value: o.value_text } : null,
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
    onShowPage: () =>
      store.setState({ rvPdfTarget: f.proposal ? { page: f.proposal.page, text: f.proposal.snippet ?? '', value: f.proposal.value, at: Date.now() } : null }),
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

export type ResultInput = {
  key: string;
  measure: string;
  value: string;
  unit: string;
  ref: string;
  flag: string;
  conf: string;
  reason: string;
  status: string;
  edited: boolean;
  orig: { value: string; unit: string; ref: string; flag: string };
};

/** Rows of results to decide one at a time, for a document or a provider. With observations, every decision goes to the
 *  service and its history; without them (the demo), it stays in this browser. */
export function resultLines(store: AppStore, L: ResultInput[], observations: LabObservation[] | undefined, demoId: string) {
  const s = store.state;
  const dr = s.rvDraft;
  const editKey = s.rvEdit;
  const seg = (on: boolean) => ({ bg: on ? C.ink : C.paper, fg: on ? C.paper : C.ink, pressed: !!on });
  const stText = (l: Item) =>
    l.status === 'confirmed' ? (l.edited ? 'Corrected and accepted.' : 'Accepted.') : l.status === 'excluded' ? REJECTED_TEXT : 'Proposed, not verified.';
  const order = L.map((l) => ({ key: l.key, pending: l.status === 'pending' }));
  const pdfTargetOf = (key: string | null) => {
    const o = key ? observations?.find((x) => x.id === key) : undefined;
    return o?.source_page ? { page: o.source_page, text: o.source_text ?? '', value: o.value_text, at: Date.now() } : null;
  };
  /** Selects a row, and shows its line in the original. Nothing is decided by selecting. */
  const select = (key: string | null, extra: Partial<AppState> = {}) =>
    store.setState({ rvLine: key, rvPdfTarget: pdfTargetOf(key) ?? store.state.rvPdfTarget, ...extra });
  /** After a decision the next undecided row is selected, so a review can go straight down the list. */
  const decided = (key: string) => select(nextPending(order, key) ?? key, { rvOpen: null, rvEdit: null });

  const lines = L.map((l) => {
    const extras = lineExtras(store, observations, l.key);
    const o = extras.observation;
    const kind: RowKind = rowKind(l.value);
    const { problems, notes } = splitIssues(o ? o.issues : l.reason ? [l.reason] : [], kind, o ? !!o.test_code : true);
    const isPending = l.status === 'pending',
      isAccepted = l.status === 'confirmed',
      isRejected = l.status === 'excluded';
    // A doubt about the reading needs a look first. A row with no value needs one typed in.
    const needsLook = isPending && (problems.length > 0 || (!o && l.conf === 'low'));
    const isOpen = s.rvOpen === l.key;
    const isEditing = editKey === l.key;
    const accept = () => {
      decided(l.key);
      if (observations) void store.setObservationStatus(l.key, 'verify');
      else store.patchReview(demoId, 'lines', l.key, { status: 'confirmed' });
    };
    const reject = () => {
      decided(l.key);
      if (observations) void store.setObservationStatus(l.key, 'reject');
      else store.patchReview(demoId, 'lines', l.key, { status: 'excluded' });
    };
    const undo = () => {
      select(l.key);
      if (observations) void store.setObservationStatus(l.key, 'reopen');
      else store.patchReview(demoId, 'lines', l.key, { status: 'pending' });
    };
    const edit = () =>
      select(l.key, {
        rvOpen: l.key,
        rvEdit: l.key,
        rvError: null,
        rvDraft: { value: l.value, unit: l.unit, ref: l.ref, flag: l.flag },
      });
    const open = () => select(l.key, { rvOpen: isOpen ? null : l.key, rvEdit: null });
    const primary = isAccepted
      ? { label: 'Accepted', tone: 'accepted', act: undo, aria: `${l.measure} accepted. Select to undo.` }
      : isRejected
        ? { label: 'Rejected', tone: 'rejected', act: undo, aria: `${l.measure} rejected. Select to restore.` }
        : kind === 'missing'
          ? { label: 'Enter value', tone: 'enter', act: edit, aria: `Enter the value for ${l.measure}` }
          : needsLook
            ? { label: 'Check', tone: 'check', act: () => select(l.key, { rvOpen: l.key, rvEdit: null }), aria: `Check ${l.measure} before deciding` }
            : { label: 'Accept', tone: 'accept', act: accept, aria: `Accept ${l.measure}, ${l.value} ${l.unit}`.trim() };
    const groupDay = o?.approved_group_id ? fShort(o.revisions[o.revisions.length - 1].occurred_at.slice(0, 10)) : '';
    return Object.assign(extras, {
      key: l.key,
      measure: l.measure,
      value: kind === 'missing' ? 'Not read' : l.value,
      unit: l.unit,
      ref: l.ref,
      flag: l.flag,
      kind,
      tag: [
        o?.origin === 'manual' ? 'User-entered' : '',
        isAccepted && l.edited ? 'Corrected' : problems.length && kind !== 'missing' && isPending ? 'Check this one' : KIND_TAG[kind],
        o?.possible_duplicates.length ? 'Possible duplicate' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      // What a screen reader says for the row: name, reading and state, with its details one press away.
      rowLabel: `${l.measure}: ${kind === 'missing' ? 'no value read' : [l.value, l.unit].filter(Boolean).join(' ')}, ${isAccepted ? (l.edited ? 'corrected and accepted' : 'accepted') : isRejected ? 'rejected' : problems.length ? 'needs a check' : 'not yet decided'}. ${isOpen || isEditing ? 'Hide' : 'Show'} actions and source.`,
      hasProblem: problems.length > 0 && isPending,
      problems: isPending ? problems : [],
      notes: [...(isPending ? [] : problems), ...notes],
      isPending,
      isAccepted,
      isRejected,
      isSelected: s.rvLine === l.key,
      isOpen: isOpen || isEditing,
      isEdited: l.edited,
      groupNote: groupDay ? `Accepted as part of a group on ${groupDay}.` : '',
      primary,
      canAcceptAsRead: isPending && kind !== 'missing' && needsLook && !isEditing,
      canCorrect: !isEditing && !isRejected,
      correctLabel: kind === 'missing' ? 'Enter value' : 'Correct',
      statusText: observations ? realLineStatus(observations, l.key) : stText(l),
      editedText:
        'Extracted as ' +
        l.orig.value +
        ' ' +
        l.orig.unit +
        (l.orig.ref !== l.ref ? ', range ' + l.orig.ref : '') +
        (l.orig.flag !== l.flag ? ', flag ' + (l.orig.flag || 'none') : '') +
        '. The extracted value is kept in the review record.',
      isEditing,
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
      onSelect: open,
      onFocus: () => {
        if (store.state.rvLine !== l.key) select(l.key);
      },
      onAccept: accept,
      onReject: reject,
      onUndo: undo,
      onEdit: edit,
      onSaveForm: async (fields: ObservationFields) => {
        const problem = await store.correctAndAccept(l.key, fields);
        if (!problem) decided(l.key);
        return problem;
      },
      onSave: () => {
        const dd = store.state.rvDraft || {};
        if (!(dd.value ?? '').trim()) return;
        const ch =
          dd.value !== l.orig.value || dd.unit !== l.orig.unit || dd.ref !== l.orig.ref || (dd.flag || '') !== l.orig.flag;
        store.patchReview(demoId, 'lines', l.key, {
          status: 'confirmed',
          value: dd.value,
          unit: dd.unit,
          ref: dd.ref,
          flag: dd.flag || '',
          edited: ch,
        });
        decided(l.key);
      },
      onCancel: () => store.setState({ rvEdit: null }),
    });
  });

  const byKey = (key: string | null) => lines.find((l) => l.key === key);
  /** One key, already known not to come from typing. Says which row it moved to, if any. */
  const keys = (key: string): string | null | undefined => {
    const cur = byKey(store.state.rvLine) ?? lines[0];
    if (!cur) return undefined;
    const i = lines.indexOf(cur);
    if (key === 'ArrowDown' || key === 'j') {
      const next = lines[Math.min(lines.length - 1, i + 1)];
      select(next.key, { rvOpen: null, rvEdit: null });
      return next.key;
    }
    if (key === 'ArrowUp' || key === 'k') {
      const prev = lines[Math.max(0, i - 1)];
      select(prev.key, { rvOpen: null, rvEdit: null });
      return prev.key;
    }
    if (key === 'a' || key === 'A') {
      if (!cur.isPending) return undefined;
      cur.primary.act();
      return cur.primary.tone === 'accept' ? (nextPending(order, cur.key) ?? cur.key) : cur.key;
    }
    if (key === 'r' || key === 'R') {
      if (!cur.isPending) return undefined;
      cur.onReject();
      return nextPending(order, cur.key) ?? cur.key;
    }
    if (key === 'u' || key === 'U') {
      if (cur.isPending) return undefined;
      cur.onUndo();
      return cur.key;
    }
    if (key === 'c' || key === 'C') {
      if (cur.isRejected) return undefined;
      cur.onEdit();
      return null; // Focus goes to the form, not a row.
    }
    return undefined;
  };
  return { lines, order, select, keys };
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
  const linesLeft = L.filter((l) => l.status === 'pending').length;
  const fieldsLeft = F.filter((l) => l.status === 'pending').length;
  const dr = s.rvDraft;
  const stText = (l: Item) =>
    l.status === 'confirmed'
      ? l.edited
        ? 'Corrected and accepted.'
        : 'Accepted.'
      : l.status === 'excluded'
        ? REJECTED_TEXT
        : 'Proposed, not verified.';
  const approvedTogether = new Map<string, LabObservation[]>();
  for (const o of real?.observations ?? []) {
    if (o.approved_group_id) approvedTogether.set(o.approved_group_id, [...(approvedTogether.get(o.approved_group_id) ?? []), o]);
  }
  const countAndDate = (rows: LabObservation[]) =>
    `${plural(rows.length, 'result')}${rows[0].collected_on ? ` collected ${fLong(rows[0].collected_on)}` : ', collection date unknown'}`;
  const editKey = s.rvEdit;
  const { lines, order, select, keys } = resultLines(store, L, real?.observations, id);

  const fields = F.map((l, i) => {
    const k = l.key as MetadataFieldKey;
    const rf = real?.fields[k];
    const extras = fieldExtras(store, id, l.key, real);
    const markNotStated = extras.onNotStated;
    const isPending = l.status === 'pending';
    const changing = editKey === 'c:' + l.key;
    const proposal = rf?.proposal;
    const badge = isPending
      ? real && !proposal
        ? 'Nothing found'
        : 'Needs your decision'
      : rf?.state === 'not_stated'
        ? 'Marked not stated'
        : l.edited
          ? 'Corrected by you'
          : 'Confirmed';
    return Object.assign(extras, {
      label: l.label,
      value: l.value,
      divider: i % 2 === 0,
      badge,
      isConfirmed: !isPending && rf?.state !== 'not_stated',
      isPending,
      // A decided detail is changed, never undone to nothing: each change is kept as its own decision.
      showActions: isPending || changing,
      canChange: !isPending && !changing && editKey !== 'f:' + l.key,
      note: isPending && l.conf === 'low' ? l.reason : '',
      isLow: l.conf === 'low' && !!l.reason,
      reason: l.reason,
      statusText: real ? realStatusText(real, k) : stText(l),
      canConfirm: (!real || !!proposal) && (isPending || rf?.state !== 'confirmed'),
      canNotStated: extras.canNotStated && !!real,
      isEditing: editKey === 'f:' + l.key,
      dValue: dr.value == null ? '' : dr.value,
      onDValue: (e: InputChange) =>
        store.setState({ rvDraft: Object.assign({}, store.state.rvDraft, { value: e.target.value }) }),
      isEdited: l.edited,
      editedText: real ? realEditedText(real, k) : 'Extracted as ' + l.orig.value + '.',
      onChange: () => store.setState({ rvEdit: 'c:' + l.key, rvError: null }),
      onUndoDemo: () => store.patchReview(id, 'fields', l.key, { status: 'pending', value: l.orig.value, edited: false }),
      onConfirm: () => {
        store.setState({ rvEdit: null });
        if (proposal) void store.decideField(id, k, { action: 'confirmed', proposal_id: proposal.id });
        else store.patchReview(id, 'fields', l.key, { status: 'confirmed' });
      },
      onNotStated: () => {
        store.setState({ rvEdit: null });
        markNotStated();
      },
      onEdit: () =>
        store.setState({
          rvEdit: 'f:' + l.key,
          rvError: null,
          rvDraft: { value: real ? rawValue(real, k) : l.value },
        }),
      onSave: async () => {
        const v = (store.state.rvDraft || {}).value;
        if (real) {
          const saved = await store.decideField(id, k, { action: 'corrected', value: v ?? '' });
          if (saved) store.setState({ rvEdit: null });
          return;
        }
        store.patchReview(id, 'fields', l.key, { status: 'confirmed', value: v, edited: v !== l.orig.value });
        store.setState({ rvEdit: null });
      },
      onCancel: () => store.setState({ rvEdit: null }),
    });
  });

  const detailsOpen = s.rvDetailsOpen ?? fieldsLeft > 0;
  const fieldsCorrected = F.filter((l) => l.edited).length;
  const pct = (n: number) => String(L.length ? Math.round((n / L.length) * 1000) / 10 : 0);
  const goNext = () => {
    const next = nextPending(order, store.state.rvLine) ?? (order.find((r) => r.pending)?.key ?? null);
    if (next) select(next, { rvOpen: null, rvEdit: null });
    return next;
  };

  const out = {
    rvIsReview: s.rvStage === 'review',
    rvIsConfirm: s.rvStage === 'confirm',
    rvIsDone: s.rvStage === 'done',
    rvBack: () => {
      store.setState({ rvDoc: null, rvEdit: null });
      window.scrollTo(0, 0);
    },
    rvIsReal: !!real,
    rvContentUrl: d.contentUrl ?? null,
    rvPdfTarget: s.rvPdfTarget,
    rvFileUrl: d.contentUrl ?? null,
    rvError: real ? s.rvError : null,
    rvGroupError: s.rvGroupError,
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
    rvProgressHead: L.length
      ? `${L.length - linesLeft} of ${plural(L.length, 'measurement')} decided`
      : fieldsLeft
        ? `${F.length - fieldsLeft} of ${F.length} details decided`
        : 'Every detail is decided',
    rvProgressDetail: [
      L.length ? `${conf} accepted${L.filter((l) => l.edited && l.status === 'confirmed').length ? `, ${L.filter((l) => l.edited && l.status === 'confirmed').length} of them corrected` : ''}` : '',
      L.length ? `${exc} rejected` : '',
      L.length ? `${linesLeft} left` : '',
      fieldsLeft ? `${plural(fieldsLeft, 'document detail')} to decide` : '',
      real ? VERIFICATION_LABEL[real.verification] : '',
    ]
      .filter(Boolean)
      .join(' · '),
    rvPctA: pct(conf),
    rvPctR: pct(exc),
    rvHasLeft: linesLeft > 0,
    rvGoNext: goNext,
    rvHead: d.source,
    rvSub:
      (d.cat === 'lab'
        ? 'Collected ' + fShort(d.date) + ' · Reported ' + fShort(d.documented)
        : DCATL[d.cat] + ' · ' + fShort(d.date)) + (d.who ? ' · ' + d.who : ''),
    rvScanned: d.format.indexOf('Scanned') >= 0,
    rvHasLines: L.length > 0,
    rvNoLines: !L.length,
    // The demo's stand-in for an original, each line selecting its row.
    rvPrev: L.map((l) => ({
      name: l.measure,
      value: l.orig.value,
      unit: l.orig.unit,
      ref: l.orig.ref,
      flag: l.orig.flag,
      bg: s.rvLine === l.key ? C.greenT : 'transparent',
      outline: s.rvLine === l.key ? '1px solid ' + C.green : '1px solid transparent',
      onClick: () => select(l.key),
    })),
    rvDetailsOpen: detailsOpen,
    rvToggleDetails: () => store.setState({ rvDetailsOpen: !detailsOpen }),
    rvDetailsSummary: fieldsLeft
      ? `${fieldsLeft} of ${F.length} need your decision`
      : `All ${F.length} decided${fieldsCorrected ? `, ${fieldsCorrected} corrected by you` : ''}`,
    rvDetailsDone: !fieldsLeft,
    rvDetailsLine: F.map((l) => l.value).join(' · '),
    rvFields: fields,
    rvNoneRecognized: !!real && !L.length,
    rvAdding: s.rvAdding,
    rvToggleAdd: () => store.setState((st) => ({ rvAdding: !st.rvAdding })),
    rvAddMeasurement: (fields: ObservationFields) => store.createObservation(fields, id, false),
    testNames: archive.testNames,
    rvLines: lines,
    rvSelected: s.rvLine,
    rvKey: keys,
    rvApprovedGroups: [...approvedTogether.entries()].map(([groupId, rows]) => ({
      id: groupId,
      text: `${countAndDate(rows)} ${rows.length === 1 ? 'was' : 'were'} approved as a group on ${fShort(rows[0].revisions[rows[0].revisions.length - 1].occurred_at.slice(0, 10))}.`,
      onUndo: () => void store.undoGroup(groupId),
    })),
    rvPendingText: pending
      ? plural(pending, 'item') + ' still to decide. Each one needs your own decision.'
      : real
        ? 'Every detail is decided, and your decisions are saved. The next step marks the review as complete.'
        : 'Everything is resolved. Nothing is added to the archive until you accept on the next step.',
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
            ? `${l.measure}: ${realLineEditedText(real.observations, l.key)}`
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
