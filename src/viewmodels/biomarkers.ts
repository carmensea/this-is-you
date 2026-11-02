import type { Click, InputChange } from './events';
import { fLong, fMY, fShort, span } from '../domain/dates';
import { fmtR, plural, rangeOnly, refText } from '../domain/format';
import { C } from '../theme';
import type { AppState, AppStore } from '../state/store';
import type { LabResult } from '../domain/types';

type BiomarkerRow = {
  date: string;
  value: string;
  valColor: string;
  unit: string;
  flag: string;
  ref: string;
  lab: string;
  reported: string;
  known: string;
  knownColor: string;
  bg: string;
  onClick: () => void;
  onDoc: (e: Click) => void;
  docLabel: string;
};

export function biomarkersVM(store: AppStore) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const rVis = store.isVisible;
  const m = archive.markers.find((x) => x.key === s.marker) || archive.markers[0];
  const q = (s.bxQuery || '').trim().toLowerCase();
  const bxGroups = archive.categories
    .map((c) => {
      const items = archive.markers
        .filter(
          (mk) =>
            mk.cat === c.key &&
            (!q || (mk.name + ' ' + mk.short + ' ' + c.name).toLowerCase().indexOf(q) >= 0) &&
            (!s.bxFlagged || mk.results.some((r) => r.flag)),
        )
        .map((mk) => {
          const lv = mk.results.filter(rVis).pop(),
            sel = mk.key === m.key;
          return {
            label: mk.name,
            sub: lv ? fmtR(lv) + ' ' + lv.unit + ', ' + fMY(lv.date) : 'Not measured by this date',
            flag: lv && lv.flag ? lv.flag : '',
            count: mk.results.filter(rVis).length + ' / ' + mk.results.length,
            bg: sel ? '#E6E1D6' : 'transparent',
            weight: sel ? 600 : 500,
            current: !!sel,
            onClick: () => store.setState({ marker: mk.key, sel: null, bxUnit: null, bxCmp: null }),
          };
        });
      return { name: c.name, n: String(items.length), items };
    })
    .filter((g) => g.items.length);
  const units = [...new Set(m.results.map((r) => r.unit))];
  const unit = s.bxUnit && units.includes(s.bxUnit) ? s.bxUnit : m.unit;
  const series = m.results.filter((r) => r.unit === unit);
  const sel = series.find((r) => r.i === s.sel) || series.filter(rVis).pop() || series[series.length - 1];
  const compat = m.cmp ? archive.markers.filter((x) => x.cmp === m.cmp && x.key !== m.key) : [];
  const cm = compat.find((x) => x.key === s.bxCmp) || null;
  const seg = (on: boolean) => ({ bg: on ? C.ink : C.paper, fg: on ? C.paper : C.ink, pressed: !!on });
  const labsIn = [...new Set(m.results.map((r) => r.lab))];
  const lv = series.filter(rVis).pop();
  const prev = sel ? series.filter((r) => r.date < sel.date).pop() : null;
  const knownTxt = (r: LabResult) =>
    rVis(r)
      ? 'Known at snapshot'
      : r.date > cur
        ? 'Collected after the snapshot date'
        : 'Reported after the snapshot date, not known then';
  const order = archive.draws.map((_, i) => i);
  if (s.bxDesc !== false) order.reverse();
  const rows = order.flatMap((i): BiomarkerRow[] => {
    const r = m.results.find((x) => x.i === i),
      dd = archive.draws[i][0],
      ll = archive.draws[i][1];
    const onDoc = (e: Click) => {
      e.preventDefault();
      e.stopPropagation();
      store.openDrawDocument(i);
    };
    if (!r)
      return !s.bxMissing
        ? []
        : [
            {
              date: fShort(dd),
              value: 'Not measured',
              valColor: C.ink3,
              unit: '',
              flag: '',
              ref: '',
              lab: archive.labs[ll],
              reported: '',
              known: '',
              knownColor: C.ink3,
              bg: 'transparent',
              onClick: () => {},
              onDoc,
              docLabel: 'Report',
            },
          ];
    return [
      {
        date: fShort(r.date),
        value: fmtR(r),
        valColor: r.flag ? C.rust : C.ink,
        unit: r.unit + (r.unit !== unit ? ', not plotted' : ''),
        flag: r.flag,
        ref: rangeOnly(r),
        lab: archive.labs[r.lab],
        reported: fShort(r.documented),
        known: rVis(r) ? 'Known' : r.date > cur ? 'After' : 'Reported later',
        knownColor: rVis(r) ? C.ink2 : C.rust,
        bg: sel && r.i === sel.i ? '#E6E1D6' : 'transparent',
        onClick: () => store.setState({ sel: r.i, bxUnit: r.unit }),
        onDoc,
        docLabel: 'Report',
      },
    ];
  });
  const notes = [];
  if (labsIn.length > 1)
    notes.push(
      'Reference ranges differ between ' +
        labsIn.map((l) => archive.labs[l]).join(' and ') +
        '. Each shaded band is the range printed on that specific report; there is no single universal range.',
    );
  if (units.length > 1)
    notes.push(
      'Results were reported in ' +
        units.join(' and ') +
        '. They are kept in their original units and plotted separately. No conversion has been applied.',
    );
  if (m.method) notes.push(m.method.text);
  const first = m.results[0];
  notes.push(
    'Measured at ' +
      m.results.length +
      ' of ' +
      archive.draws.length +
      ' laboratory draws in the archive' +
      (first.i > 0 ? ', first in ' + fMY(first.date) : '') +
      '. Draws where it was not measured are left blank rather than estimated.',
  );
  if (cm)
    notes.push(
      cm.name + ' is overlaid on the same axis for context. Only the reference range for ' + m.short + ' is shaded.',
    );
  const step = (key: 'bxFrom' | 'bxTo', d: number) => () =>
    store.setState((st) => ({ [key]: Math.max(2009, Math.min(2026, st[key] + d)) }));
  return {
    bxQuery: s.bxQuery,
    onBxQuery: (e: InputChange) => store.setState({ bxQuery: e.target.value }),
    toggleFlagged: () => store.setState({ bxFlagged: !s.bxFlagged }),
    bxFlaggedA: !!s.bxFlagged,
    bxFlaggedBg: s.bxFlagged ? C.ink : 'transparent',
    bxGroups,
    bxNone: !bxGroups.length,
    bxCat: m.panel,
    bxName: m.name,
    bxMeta: [
      m.short,
      units.join(' and '),
      plural(m.results.length, 'result') +
        ' in full archive (' +
        m.results.filter(rVis).length +
        ' known by snapshot), ' +
        fMY(first.date) +
        ' to ' +
        fMY(m.results[m.results.length - 1].date),
      labsIn.map((l) => archive.labs[l]).join(' and '),
    ].join(' · '),
    bxNowVal: lv ? fmtR(lv) : 'None',
    bxNowUnit: lv ? lv.unit : '',
    bxNowFlag: lv && lv.flag ? lv.flag : '',
    bxNowDate: lv
      ? 'Collected ' + fShort(lv.date) + ', ' + span(lv.date, cur) + ' earlier'
      : 'Not measured by this date',
    bxRanges: (
      [
        ['all', 'All years'],
        ['10', '10 years'],
        ['5', '5 years'],
        ['custom', 'Custom'],
      ] as [AppState['bxRange'], string][]
    ).map(([kk, l]) =>
      Object.assign({ label: l, onClick: () => store.setState({ bxRange: kk }) }, seg((s.bxRange || 'all') === kk)),
    ),
    bxCustom: s.bxRange === 'custom',
    bxFromTxt: String(Math.min(s.bxFrom, s.bxTo)),
    bxToTxt: String(Math.max(s.bxFrom, s.bxTo)),
    bxFromDown: step('bxFrom', -1),
    bxFromUp: step('bxFrom', 1),
    bxToDown: step('bxTo', -1),
    bxToUp: step('bxTo', 1),
    bxMultiUnit: units.length > 1,
    bxUnits: units.map((u) =>
      Object.assign(
        {
          label: u + ' (' + m.results.filter((r) => r.unit === u).length + ')',
          onClick: () => store.setState({ bxUnit: u, sel: null }),
        },
        seg(u === unit),
      ),
    ),
    bxHasCompat: compat.length > 0,
    bxNoCompat: !compat.length,
    bxCmps: [Object.assign({ label: 'None', onClick: () => store.setState({ bxCmp: null }) }, seg(!cm))].concat(
      compat.map((c) =>
        Object.assign(
          { label: c.short, onClick: () => store.setState({ bxCmp: c.key }) },
          seg(!!cm && cm.key === c.key),
        ),
      ),
    ),
    bxHasCm: !!cm,
    bxCmLabel: cm ? cm.name + ', same unit' : '',
    bxChart: { m, unit, series, cm, cur, sel },
    bxAxisNote:
      'Vertical axis in ' +
      unit +
      ', scaled to the values shown; it does not start at zero. Each point is one result. Lines join results less than about two years apart; longer gaps are hatched.',
    bxSelFields: sel
      ? [
          { k: 'Collected', v: fLong(sel.date) },
          { k: 'Result', v: fmtR(sel) + ' ' + sel.unit },
          {
            k: 'Flag on report',
            v: sel.flag ? (sel.flag === 'H' ? 'H, above printed range' : 'L, below printed range') : 'None',
          },
          { k: 'Range printed on report', v: refText(sel) },
          { k: 'Laboratory', v: archive.labs[sel.lab] },
          { k: 'Ordered by', v: archive.whoBySource[archive.labs[sel.lab]] },
          { k: 'Reported', v: fShort(sel.documented) },
          {
            k: 'Previous result, same unit',
            v: prev ? fmtR(prev) + ' ' + prev.unit + ', ' + fShort(prev.date) : 'None in archive',
          },
        ]
      : [],
    bxSelStatus: sel ? knownTxt(sel) : '',
    bxSelStatusColor: sel && rVis(sel) ? C.ink2 : C.rust,
    bxSelDoc: sel ? 'Laboratory report, ' + archive.labs[sel.lab] + ', ' + fShort(sel.date) : '',
    bxOpenDoc: (e: Click) => {
      e.preventDefault();
      if (sel) store.openDrawDocument(sel.i);
    },
    bxSnapHere: () => {
      if (sel) store.setCur(mode === 'known' ? sel.documented : sel.date);
    },
    bxNotes: notes,
    bxRows: rows,
    bxRowsNote:
      plural(m.results.length, 'result') +
      ' in full archive' +
      (s.bxMissing ? ', with ' + (archive.draws.length - m.results.length) + ' draws where it was not measured' : ''),
    toggleMissing: () => store.setState({ bxMissing: !s.bxMissing }),
    bxMissingA: !!s.bxMissing,
    bxMissingBg: s.bxMissing ? C.ink : 'transparent',
    toggleSort: () => store.setState({ bxDesc: s.bxDesc === false }),
    bxSortLabel: s.bxDesc !== false ? 'Newest first' : 'Oldest first',
  };
}
