import type { InputChange } from './events';
import { fLong, fShort } from '../domain/dates';
import { fmtR, plural, rangeOnly } from '../domain/format';
import { DCATL, DCATS, STATUS, TYPE_LABEL } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { ArchiveDocument, DocumentStatus } from '../domain/types';

type DocumentRow =
  | { isYear: true; isDoc: false; year: string; count: string }
  | {
      isYear: false;
      isDoc: true;
      date: string;
      title: string;
      sub: string;
      type: string;
      statusLabel: string;
      statusColor: string;
      extracted: string;
      note: string;
      bg: string;
      current: boolean;
      snapTag: string;
      titleColor: string;
      s1: string;
      s2: string;
      s3: string;
      onClick: () => void;
    };

export function documentsVM(store: AppStore) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const st = (d: ArchiveDocument) => store.documentStatus(d);
  const q = (s.dQuery || '').trim().toLowerCase();
  const tOn = (k: string) => (s.dTypes || {})[k] !== false,
    sOn = (k: string) => (s.dStatus || {})[k] !== false;
  const inRec = (d: ArchiveDocument) => (mode === 'known' ? d.documented <= cur : d.date <= cur);
  const base = archive.documents.filter((d) => (!q || d.search.indexOf(q) >= 0) && (!s.dSnapOnly || inRec(d)));
  const list = base.filter((d) => tOn(d.cat) && sOn(st(d)));
  const desc = s.dDesc !== false;
  const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * (desc ? -1 : 1));
  const sel = (s.dSel ? archive.documentsById[s.dSel] : undefined) || sorted[0] || null;
  const sq = (k: DocumentStatus) => {
    const n = STATUS[k].n,
      un = k === 'unsupported';
    return { s1: un ? C.rust : C.ink, s2: n >= 2 ? C.ink : 'transparent', s3: n >= 3 ? C.green : 'transparent' };
  };
  const rows: DocumentRow[] = [];
  let yr: string | null = null;
  const yc: Record<string, number> = {};
  sorted.forEach((d) => {
    const y = d.date.slice(0, 4);
    yc[y] = (yc[y] || 0) + 1;
  });
  sorted.forEach((d) => {
    const y = d.date.slice(0, 4);
    if (y !== yr) {
      rows.push({ isYear: true as const, isDoc: false as const, year: y, count: plural(yc[y], 'document') });
      yr = y;
    }
    const k = st(d);
    rows.push(
      Object.assign({ isYear: false as const, isDoc: true as const }, sq(k), {
        date: d.dateLabel || fShort(d.date),
        title: d.title,
        sub: d.source + ' · ' + d.format,
        type: DCATL[d.cat],
        statusLabel: STATUS[k].label,
        statusColor: STATUS[k].color,
        extracted: d.n
          ? plural(d.n, 'value')
          : d.rows
            ? d.rows + ' rows'
            : k === 'reviewed' || k === 'parsed'
              ? '1 record'
              : 'None',
        note: d.dup ? 'Duplicate, set aside' : '',
        bg: sel && sel.id === d.id ? '#E6E1D6' : 'transparent',
        current: !!(sel && sel.id === d.id),
        snapTag: inRec(d) ? '' : 'Added after snapshot',
        titleColor: inRec(d) ? C.ink : C.ink2,
        onClick: () => store.setState({ dSel: d.id, dPage: 0, dHL: null }),
      }),
    );
  });
  const out = {
    dQuery: s.dQuery,
    onDQuery: (e: InputChange) => store.setState({ dQuery: e.target.value }),
    dCountText:
      'Full archive: ' +
      archive.documents.length +
      ' files. ' +
      archive.documents.filter(inRec).length +
      ' were in the record by ' +
      fShort(cur) +
      '. Showing ' +
      list.length +
      '.',
    dStatusList: (Object.keys(STATUS) as DocumentStatus[]).map((k) =>
      Object.assign(
        {
          label: STATUS[k].label,
          desc: STATUS[k].desc,
          color: STATUS[k].color,
          count: String(base.filter((d) => st(d) === k).length),
          checked: !!sOn(k),
          state: sOn(k) ? 'Shown in list' : 'Hidden from list',
          op: sOn(k) ? 1 : 0.55,
          onClick: () =>
            store.setState((x) => ({ dStatus: Object.assign({}, x.dStatus, { [k]: (x.dStatus || {})[k] === false }) })),
        },
        sq(k),
      ),
    ),
    dTypeList: DCATS.map(([k, l]) => ({
      label: l,
      count: String(base.filter((d) => d.cat === k).length),
      box: tOn(k) ? C.ink : 'transparent',
      checked: !!tOn(k),
      onClick: () =>
        store.setState((x) => ({ dTypes: Object.assign({}, x.dTypes, { [k]: (x.dTypes || {})[k] === false }) })),
    })),
    dSortLabel: desc ? 'Newest first' : 'Oldest first',
    toggleDSort: () => store.setState({ dDesc: !desc }),
    dSnapA: !!s.dSnapOnly,
    dSnapBg: s.dSnapOnly ? C.ink : 'transparent',
    toggleDSnap: () => store.setState({ dSnapOnly: !s.dSnapOnly }),
    dSnapLabel: 'Only files in the record by ' + fShort(cur),
    dReset: () => store.setState({ dQuery: '', dTypes: {}, dStatus: {}, dSnapOnly: false }),
    dRows: rows,
    dEmpty: !list.length && archive.documents.length > 0,
    dNoDocuments: archive.documents.length === 0,
    goImport: () => store.go('import'),
  };
  if (!sel) return { ...out, detail: null };
  const k = st(sel),
    meta = STATUS[k],
    f = archive.lowConfidence[sel.id] || {};
  const lines =
    sel.draw != null
      ? archive.markers.flatMap((mk) => {
          const r = mk.results.find((x) => x.i === sel.draw);
          return r ? [{ mk, r }] : [];
        })
      : [];
  const pages = Math.max(1, lines.length ? Math.ceil(lines.length / 8) : sel.pages || 1);
  const page = Math.min(s.dPage || 0, pages - 1);
  const ev = sel.ev ? archive.events.find((e) => e.id === sel.ev) : null;
  const known = inRec(sel);
  const lineStatus = (mkKey: string): [string, string] =>
    k === 'reviewed'
      ? ['Reviewed', C.green]
      : k === 'parsed'
        ? f[mkKey]
          ? ['Low confidence', C.rust]
          : ['Parsed', '#8A5A1F']
        : ['Not extracted', C.ink3];
  const preview = sel.draw != null && !sel.dup;
  return {
    ...out,
    detail: {
      ...sq(k),
      ddCat: DCATL[sel.cat],
      ddTitle: sel.title,
      ddFile: sel.file,
      ddStatusLabel: meta.label,
      ddStatusColor: meta.color,
      ddStatusDesc: meta.desc,
      ddKnown: known
        ? 'In the record by the snapshot date, ' + fShort(cur) + '.'
        : 'Not yet in the record on the snapshot date, ' + fShort(cur) + '. Documented ' + fShort(sel.documented) + '.',
      ddKnownColor: known ? C.ink2 : C.rust,
      ddContentUrl: sel.contentUrl ?? null,
      ddHasNote: !!sel.note,
      ddNote: sel.note || '',
      ddFields: [
        { k: 'Document type', v: DCATL[sel.cat] },
        {
          k: sel.cat === 'lab' ? 'Collected' : 'Date of service',
          v: sel.dateUnknown ? 'Not recorded' : sel.dateLabel || fLong(sel.date),
        },
        {
          k: 'Documented',
          v: sel.dateUnknown ? 'Not recorded' : sel.dateLabel ? 'Exported 27 Oct 2026' : fLong(sel.documented),
        },
        { k: 'Source', v: sel.source },
        { k: sel.cat === 'lab' ? 'Ordered by' : 'Clinician', v: sel.who || 'Not stated' },
        { k: 'Format', v: sel.format },
        { k: 'Pages', v: sel.contentUrl ? 'Not read' : sel.pages ? String(sel.pages) : 'Not applicable' },
        { k: 'File size', v: sel.size },
        { k: 'Imported', v: sel.via + ', ' + sel.imported },
        { k: 'Checksum, SHA-256', v: sel.contentUrl ? sel.hash : sel.hash.slice(0, 16) + '…' },
        { k: 'Original file', v: 'Stored unchanged since import' },
        {
          k: 'Extracted',
          v:
            lines.length && !sel.dup
              ? plural(lines.length, 'measurement')
              : sel.rows
                ? sel.rows + ' weight readings'
                : k === 'reviewed' || k === 'parsed'
                  ? '1 history record'
                  : 'Nothing',
        },
      ],
      ddHasEvent: !!ev,
      ddShowHistory: () => {
        if (!ev) return;
        store.setState({
          view: 'history',
          hxQuery: '',
          hxTypes: {},
          hxSource: 'all',
          hxFrom: 2009,
          hxTo: 2026,
          hxShowAfter: true,
          hxOpen: { [ev.id]: true },
          returnTo: { view: 'documents', y: 0 },
        });
        window.scrollTo(0, 0);
      },
      ddSnap: () => store.setCur(mode === 'known' ? sel.documented : sel.date),
      ddCanReview: k === 'parsed',
      ddReview: () => {
        store.setState({
          view: 'import',
          rvDoc: sel.id,
          rvStage: 'review',
          rvLine: null,
          rvEdit: null,
          rvFilter: 'all',
          returnTo: { view: 'documents', y: 0 },
        });
        window.scrollTo(0, 0);
      },
      ddHasDup: !!sel.dup,
      ddOpenDup: () => store.setState({ dSel: sel.dup, dPage: 0, dHL: null }),
      ddMultiPage: pages > 1,
      ddPageText: 'Page ' + (page + 1) + ' of ' + pages,
      ddPrev: () => store.setState({ dPage: Math.max(0, page - 1) }),
      ddNext: () => store.setState({ dPage: Math.min(pages - 1, page + 1) }),
      ddIsLab: preview,
      ddNoPreview: !preview,
      ddPlaceholder:
        sel.status === 'unsupported'
          ? 'No preview: ' +
            sel.format +
            ' files cannot be displayed in this version. The original file is stored unchanged.'
          : sel.dup
            ? 'Second copy of an existing report. Open the original copy to see its contents.'
            : sel.ext === 'csv'
              ? 'Tabular export with ' + sel.rows + ' rows: date, weight in kg.'
              : sel.ext === 'zip'
                ? 'Archive file. Its contents have not been read yet.'
                : 'Original document text is preserved in the source file. This prototype does not reproduce clinical narrative.',
      ddHead: sel.source,
      ddSub:
        (sel.cat === 'lab'
          ? 'Collected ' + fShort(sel.date) + ' · Reported ' + fShort(sel.documented)
          : DCATL[sel.cat] + ' · ' + (sel.dateLabel || fShort(sel.date))) + (sel.who ? ' · ' + sel.who : ''),
      ddLines: lines.slice(page * 8, page * 8 + 8).map(({ mk, r }) => ({
        name: mk.name,
        value: fmtR(r),
        flag: r.flag,
        ref: rangeOnly(r),
        unit: r.unit,
        bg: s.dHL === mk.key ? C.greenT : 'transparent',
        outline: s.dHL === mk.key ? '1px solid ' + C.green : '1px solid transparent',
        onClick: () => store.setState({ dHL: mk.key }),
      })),
      ddHasLines: lines.length > 0 && !sel.dup,
      ddLinesCount: plural(lines.length, 'measurement') + ' extracted from this report',
      ddExtracted: lines.map(({ mk, r }, idx) => {
        const ls = lineStatus(mk.key);
        return {
          name: mk.name,
          value: fmtR(r) + ' ' + r.unit,
          ref: rangeOnly(r),
          flag: r.flag,
          status: ls[0],
          statusColor: ls[1],
          bg: s.dHL === mk.key ? C.greenT : 'transparent',
          onLocate: () => store.setState({ dHL: mk.key, dPage: Math.floor(idx / 8) }),
          onChart: () => {
            store.setState({
              view: 'biomarkers',
              marker: mk.key,
              sel: r.i,
              bxUnit: r.unit,
              bxCmp: null,
              returnTo: { view: 'documents', y: window.scrollY },
            });
            window.scrollTo(0, 0);
          },
        };
      }),
      ddHasRecord: !lines.length && !!ev,
      ddRecordText: ev ? TYPE_LABEL[ev.type] + ' in Medical history: ' + ev.title + ', ' + fShort(ev.date) : '',
    },
  };
}
