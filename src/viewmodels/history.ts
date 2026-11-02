import type { InputChange } from './events';
import { fLong, fMY, fShort, toT } from '../domain/dates';
import { doseAt, fmtR, plural, refText } from '../domain/format';
import { GLYPH, HCATS, TYPE_LABEL, evNote, grpOf } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { HealthEvent, ISODate } from '../domain/types';

function eventRow(store: AppStore, e: HealthEvent) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const open = !!(store.state.hxOpen || {})[e.id];
  const later = e.date <= cur && e.documented > cur,
    after = e.date > cur;
  const g = GLYPH[e.type],
    d = e.provenance;
  const fields = [];
  if (e.dx) {
    fields.push(
      { k: 'Onset recorded', v: fLong(e.dx.onset) },
      { k: 'Documented', v: fLong(e.dx.documented) },
      {
        k: 'Resolved',
        v: !e.dx.resolved
          ? 'Not recorded as resolved'
          : e.dx.resolved <= cur || e.date > cur
            ? fLong(e.dx.resolved)
            : mode === 'known'
              ? 'Not resolved by the snapshot date'
              : 'Recorded later: ' + fLong(e.dx.resolved),
      },
    );
  } else if (e.med) {
    fields.push(
      { k: 'Medication', v: e.med.name },
      { k: 'Dose at snapshot', v: e.med.start <= cur ? doseAt(e.med, cur) : doseAt(e.med, e.date) },
      {
        k: 'Period',
        v:
          e.date > cur || (e.med.end && e.med.end <= cur)
            ? fLong(e.med.start) + ' to ' + (e.med.end ? fLong(e.med.end) : 'present')
            : mode === 'known'
              ? 'From ' + fLong(e.med.start) + ', ongoing on the snapshot date'
              : 'From ' +
                fLong(e.med.start) +
                '. Recorded later: ' +
                (e.med.end ? 'stopped ' + fLong(e.med.end) : 'continues to present'),
      },
    );
  } else {
    fields.push({ k: 'Date of event', v: fLong(e.date) }, { k: 'Documented', v: fLong(e.documented) });
  }
  fields.push(
    { k: 'Source', v: e.source },
    { k: e.type === 'lab' ? 'Ordered by' : 'Clinician', v: e.clinician || 'Not stated' },
    { k: 'Document', v: d.format },
    { k: 'Imported', v: d.via + ', ' + d.imported },
    { k: 'Import status', v: d.status },
  );
  const results =
    e.draw != null
      ? archive.markers.flatMap((mk) => {
          const r = mk.results.find((x) => x.i === e.draw);
          return r
            ? [
                {
                  name: mk.short,
                  value: fmtR(r) + ' ' + r.unit,
                  flag: r.flag,
                  ref: refText(r),
                  onClick: () => {
                    store.setState({ marker: mk.key, sel: r.i, bxUnit: r.unit, bxCmp: null });
                    store.go('biomarkers');
                  },
                },
              ]
            : [];
        })
      : [];
  return {
    isYear: false as const,
    isSnap: false as const,
    isEv: true as const,
    id: e.id,
    date: fShort(e.date),
    type: TYPE_LABEL[e.type] + (e.surgery ? ', surgery' : ''),
    title: e.title,
    source: e.source + (e.clinician ? ' · ' + e.clinician : ''),
    status: after ? 'After snapshot' : later ? 'Documented later, ' + fShort(e.documented) : '',
    statusColor: after ? C.ink3 : C.rust,
    titleColor: after ? C.ink3 : C.ink,
    gw: g.w,
    gh: g.h,
    gr: g.r,
    gbg: g.bg,
    gbd: g.bd,
    grot: g.rot,
    sign: open ? '−' : '+',
    isOpen: open,
    expanded: !!open,
    onToggle: () =>
      store.setState((st) => ({ hxOpen: Object.assign({}, st.hxOpen, { [e.id]: !(st.hxOpen || {})[e.id] }) })),
    note: evNote(e),
    fields,
    hasResults: results.length > 0,
    results,
    resultsTitle: plural(results.length, 'result') + ' from this draw',
    hasDoc: !!e.documentId,
    onDoc: () => store.openEventDocument(e),
    onSnap: () => store.setCur(mode === 'known' ? e.documented : e.date),
    isLab: e.type === 'lab',
    onLab: () => {
      store.setState({ marker: 'ldl', sel: e.draw });
      store.go('biomarkers');
    },
  };
}

type SnapRow = { isYear: false; isSnap: true; isEv: false; label: string; sub: string };
type YearRow = { isYear: true; isSnap: false; isEv: false; year: string; count: string };
type HistoryRow = SnapRow | YearRow | ReturnType<typeof eventRow>;

export function historyVM(store: AppStore) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const types = s.hxTypes || {},
    on = (kk: string) => types[kk] !== false;
  const q = (s.hxQuery || '').trim().toLowerCase();
  const yA = Math.min(s.hxFrom, s.hxTo),
    yB = Math.max(s.hxFrom, s.hxTo);
  const afterSnap = (e: HealthEvent) => (mode === 'known' ? e.documented > cur : e.date > cur);
  const base = archive.events.filter((e) => {
    const yy = +e.date.slice(0, 4);
    return (
      (s.hxSource === 'all' || e.source === s.hxSource) &&
      yy >= yA &&
      yy <= yB &&
      (!q || (e.title + ' ' + e.source + ' ' + e.clinician).toLowerCase().indexOf(q) >= 0) &&
      (s.hxShowAfter || !afterSnap(e))
    );
  });
  const list = base.filter((e) => on(grpOf(e)));
  const desc = s.hxDesc !== false;
  const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * (desc ? -1 : 1));
  const yc: Record<string, number> = {};
  sorted.forEach((e) => {
    const yy = e.date.slice(0, 4);
    yc[yy] = (yc[yy] || 0) + 1;
  });
  const snapRow = () => ({
    isYear: false as const,
    isSnap: true as const,
    isEv: false as const,
    label: 'Snapshot ' + fShort(cur),
    sub: desc ? 'Earlier events below this line' : 'Later events below this line',
  });
  const rows: HistoryRow[] = [];
  let yr: string | null = null,
    snapDone = false;
  sorted.forEach((e) => {
    if (!snapDone && (desc ? e.date <= cur : e.date > cur)) {
      rows.push(snapRow());
      snapDone = true;
    }
    const yy = e.date.slice(0, 4);
    if (yy !== yr) {
      rows.push({
        isYear: true as const,
        isSnap: false as const,
        isEv: false as const,
        year: yy,
        count: plural(yc[yy], 'event'),
      });
      yr = yy;
    }
    rows.push(eventRow(store, e));
  });
  if (!snapDone && sorted.length) rows.push(snapRow());
  const sources = [...new Set(archive.events.map((e) => e.source))].sort();
  const radio = (sel: boolean) => ({ box: sel ? C.ink : 'transparent', checked: !!sel, weight: sel ? 600 : 400 });
  const { chartStart: T0A, chartEnd: T1A } = archive;
  const tp = (d: ISODate) => ((toT(d) - T0A) / (T1A - T0A)) * 100;
  const snapL = tp(cur).toFixed(2);
  const step = (key: 'hxFrom' | 'hxTo', d: number) => () =>
    store.setState((st) => ({ [key]: Math.max(archive.firstYear, Math.min(archive.lastYear, st[key] + d)) }));
  const seg = (on2: boolean) => ({ bg: on2 ? C.ink : C.paper, fg: on2 ? C.paper : C.ink, pressed: !!on2 });
  return {
    hxCountText:
      'Showing ' +
      list.length +
      ' of ' +
      archive.events.length +
      ' events in the full archive. ' +
      archive.events.filter((e) => (mode === 'known' ? e.documented <= cur : e.date <= cur)).length +
      ' were in the record by ' +
      fShort(cur) +
      '.',
    hxQuery: s.hxQuery,
    onHxQuery: (e: InputChange) => store.setState({ hxQuery: e.target.value }),
    hxCats: HCATS.map(([kk, l]) => {
      const g = GLYPH[kk];
      return Object.assign(
        {
          label: l,
          count: String(base.filter((e) => grpOf(e) === kk).length),
          gw: g.w,
          gh: g.h,
          gr: g.r,
          gbg: g.bg,
          gbd: g.bd,
          grot: g.rot,
          onClick: () =>
            store.setState((st) => ({
              hxTypes: Object.assign({}, st.hxTypes, { [kk]: (st.hxTypes || {})[kk] === false }),
            })),
        },
        radio(on(kk)),
      );
    }),
    hxSources: [
      Object.assign(
        {
          label: 'All sources',
          count: String(archive.events.length),
          onClick: () => store.setState({ hxSource: 'all' }),
        },
        radio(s.hxSource === 'all'),
      ),
    ].concat(
      sources.map((src) =>
        Object.assign(
          {
            label: src,
            count: String(archive.events.filter((e) => e.source === src).length),
            onClick: () => store.setState({ hxSource: src }),
          },
          radio(s.hxSource === src),
        ),
      ),
    ),
    hxFromTxt: String(yA),
    hxToTxt: String(yB),
    hxFromDown: step('hxFrom', -1),
    hxFromUp: step('hxFrom', 1),
    hxToDown: step('hxTo', -1),
    hxToUp: step('hxTo', 1),
    hxOrder: (
      [
        ['Newest first', true],
        ['Oldest first', false],
      ] as [string, boolean][]
    ).map(([l, dv]) => Object.assign({ label: l, onClick: () => store.setState({ hxDesc: dv }) }, seg(desc === dv))),
    toggleAfter: () => store.setState({ hxShowAfter: !s.hxShowAfter }),
    hxAfterA: !!s.hxShowAfter,
    hxAfterBg: s.hxShowAfter ? C.ink : 'transparent',
    hxAfterLabel:
      mode === 'known' ? 'Include events documented after the snapshot' : 'Include events after the snapshot',
    hxReset: () =>
      store.setState({
        hxTypes: {},
        hxSource: 'all',
        hxFrom: archive.firstYear,
        hxTo: archive.lastYear,
        hxQuery: '',
        hxShowAfter: true,
      }),
    hxExpandAll: () => {
      const o: Record<string, boolean> = {};
      list.forEach((e) => {
        o[e.id] = true;
      });
      store.setState({ hxOpen: o });
    },
    hxCollapseAll: () => store.setState({ hxOpen: {} }),
    hxRows: rows,
    hxEmpty: !list.length,
    treat: archive.treatments.map((t) => {
      const st = t.start,
        en = t.end || archive.today,
        act = st <= cur && (!t.end || t.end > cur);
      const kEnd = en < cur ? en : cur,
        lStart = st > cur ? st : cur;
      return {
        name: t.name,
        dose: st <= cur ? doseAt(t, cur) : t.dose,
        left: tp(st).toFixed(2),
        width: st <= cur ? Math.max(0.4, tp(kEnd) - tp(st)).toFixed(2) : '0',
        lleft: tp(lStart).toFixed(2),
        lwidth: en > cur ? Math.max(0.4, tp(en) - tp(lStart)).toFixed(2) : '0',
        period:
          st > cur
            ? 'Recorded after snapshot'
            : t.end && t.end <= cur
              ? fMY(st) + ' to ' + fMY(t.end)
              : 'From ' + fMY(st) + ', ongoing',
        later:
          st > cur
            ? fMY(st) + (t.end ? ' to ' + fMY(t.end) : ' onward')
            : en > cur && st <= cur
              ? t.end
                ? 'Later record: stopped ' + fMY(t.end)
                : 'Later records: continues'
              : '',
        snap: snapL,
        act: act ? 'Active on snapshot date' : '',
        nameWeight: act ? 600 : 500,
      };
    }),
    treatTicks: Array.from({ length: Math.ceil((T1A - T0A) / 3) }, (_, i) => T0A + i * 3).map((yy) => ({
      label: String(yy),
      left: tp(yy + '-01-01').toFixed(2),
    })),
    treatSnap: snapL,
  };
}
