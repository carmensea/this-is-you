import type { Click, InputChange } from './events';
import { addDays, addMonths, fLong, fMY, fShort, monthsBetween, span } from '../domain/dates';
import { doseAt, fmtR, plural, refText } from '../domain/format';
import { TYPE_LABEL } from '../domain/vocabulary';
import { C } from '../theme';
import type { AppState, AppStore } from '../state/store';
import type { Diagnosis, EventType, HealthEvent, ISODate, LabResult, Marker, Medication, WeightReading } from '../domain/types';

type SnapKey = 'cA' | 'cB';

export function compareVM(store: AppStore) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const A0 = s.cA || cur,
    B0 = s.cB || archive.today,
    inverted = A0 > B0;
  const A = inverted ? B0 : A0,
    B = inverted ? A0 : B0,
    aKey: SnapKey = inverted ? 'cB' : 'cA',
    bKey: SnapKey = inverted ? 'cA' : 'cB';
  const visAt = (d: ISODate) => (r: { date: ISODate; documented: ISODate }) =>
    mode === 'known' ? r.documented <= d : r.date <= d;
  const vA = visAt(A),
    vB = visAt(B);
  const lb = s.units === 'lb',
    conv = (v: number) => (lb ? v * 2.20462 : v),
    wu = lb ? 'lb' : 'kg';
  const setK = (key: SnapKey, d: ISODate) => {
    if (d < archive.start) d = archive.start;
    if (d > archive.today) d = archive.today;
    const o = key === 'cA' ? B0 : A0;
    if (key === 'cA' ? d > o : d < o) store.setState({ cA: key === 'cA' ? o : d, cB: key === 'cA' ? d : o });
    else store.setState({ [key]: d } as Pick<AppState, SnapKey>);
  };
  const lag = (d: ISODate, snap: ISODate) =>
    d === snap ? 'On the snapshot date' : span(d, snap) + ' before ' + (snap === A ? 'A' : 'B');
  const stopEv = (e?: Click) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const scrollChart = () =>
    setTimeout(() => {
      const el = document.getElementById('cmp-chart');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
    }, 30);
  const cell = (r: LabResult | null | undefined, snap: ISODate, m: Marker | null) =>
    r
      ? {
          has: true,
          none: false,
          value: fmtR(r),
          flag: r.flag,
          date: fShort(r.date),
          lag: lag(r.date, snap),
          ref: 'Range ' + refText(r),
          lab: archive.labs[r.lab],
          onDoc: (e: Click) => {
            stopEv(e);
            store.openDrawDocument(r.i);
          },
        }
      : {
          has: false,
          none: true,
          value: 'No recorded value',
          flag: '',
          date: '',
          lag:
            m && m.results[0].date > snap
              ? 'First measured ' + fMY(m.results[0].date)
              : m
                ? 'Not measured or not yet reported by this date'
                : '',
          ref: '',
          lab: '',
          onDoc: (e: Click) => stopEv(e),
        };
  const groups = archive.categories
    .map((c) => {
      const rows = archive.markers
        .filter((m) => m.cat === c.key)
        .map((m) => {
          const ra = m.results.filter(vA).pop(),
            rb = m.results.filter(vB).pop();
          let change = '',
            note = '';
          if (!ra || !rb) note = 'No change computed';
          else if (ra.i === rb.i) note = 'Same result at both dates';
          else if (ra.unit !== rb.unit) note = 'Not comparable: units differ (' + ra.unit + ', ' + rb.unit + ')';
          else if (m.method && ra.date < m.method.date !== rb.date < m.method.date)
            note = 'Not comparable: calculation method changed';
          else {
            const d = rb.value - ra.value;
            change = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(rb.dp) + ' ' + rb.unit;
            note = ra.lab !== rb.lab ? 'Different laboratories and printed ranges' : 'Later minus earlier';
          }
          const sel = m.key === s.cMk;
          return {
            name: m.name,
            unit: (rb || ra || m).unit,
            a: cell(ra, A, m),
            b: cell(rb, B, m),
            change,
            note,
            bg: sel ? '#E6E1D6' : 'transparent',
            current: !!sel,
            both: !!(ra && rb),
            any: !!(ra || rb),
            onClick: () => {
              store.setState({ cMk: m.key });
              scrollChart();
            },
            onExplore: (e: Click) => {
              stopEv(e);
              store.setState({
                view: 'biomarkers',
                marker: m.key,
                sel: null,
                bxUnit: null,
                bxCmp: null,
                returnTo: { view: 'compare', y: window.scrollY },
              });
              window.scrollTo(0, 0);
            },
          };
        })
        .filter((r) => !s.cHideEmpty || r.any);
      const all = archive.markers.filter((m) => m.cat === c.key).length;
      return {
        name: c.name,
        count: rows.filter((r) => r.both).length + ' of ' + all + ' recorded at both dates',
        rows,
      };
    })
    .filter((g) => g.rows.length);
  const wAt = (d: ISODate) => archive.weight.filter((w) => w.date <= d).pop();
  const wa = wAt(A),
    wb = wAt(B);
  const wcell = (w: WeightReading | undefined, snap: ISODate) =>
    w
      ? {
          has: true,
          none: false,
          value: conv(w.v).toFixed(1),
          flag: '',
          date: fShort(w.date),
          lag: lag(w.date, snap),
          ref: w.src === 'clinic' ? 'Clinic visit measurement' : 'Smart scale reading',
          lab: '',
          onDoc: (e: Click) => {
            stopEv(e);
            const ev = archive.events.find((x) => x.type === 'visit' && x.date === w.date);
            store.openDocument(w.src === 'scale' || !ev ? 'x-vesync' : ev.documentId);
          },
        }
      : cell(null, snap, null);
  let wch = '',
    wnote = 'No change computed';
  if (wa && wb && wa.date !== wb.date) {
    const d = conv(wb.v) - conv(wa.v);
    wch = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1) + ' ' + wu;
    wnote = wa.src !== wb.src ? 'Clinic scale and home scale differ' : 'Later minus earlier';
  } else if (wa && wb) wnote = 'Same reading at both dates';
  groups.push({
    name: 'Weight and body measurements',
    count: (wa && wb ? '1' : '0') + ' of 1 recorded at both dates',
    rows: [
      {
        name: 'Body weight',
        unit: wu,
        a: wcell(wa, A),
        b: wcell(wb, B),
        change: wch,
        note: wnote,
        bg: 'transparent',
        current: false,
        both: !!(wa && wb),
        any: true,
        onClick: () =>
          setTimeout(() => {
            const el = document.getElementById('cmp-weight');
            if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
          }, 30),
        onExplore: (e: Click) => stopEv(e),
      },
    ],
  });

  const m = archive.markers.find((x) => x.key === s.cMk) || archive.markers[0];
  const ra = m.results.filter(vA).pop(),
    rb = m.results.filter(vB).pop();
  const evK = (e: HealthEvent) => (mode === 'known' ? e.documented : e.date);
  const inRec = (e: HealthEvent, d: ISODate) => evK(e) <= d;
  const dxAt = (d: ISODate) => archive.diagnoses.filter((x) => (mode === 'known' ? x.documented : x.onset) <= d);
  const dA = dxAt(A),
    dB = dxAt(B);
  const toHist = (e: HealthEvent) => () => {
    store.setState({
      view: 'history',
      hxQuery: e.title,
      hxTypes: {},
      hxSource: 'all',
      hxFrom: 2009,
      hxTo: 2026,
      hxShowAfter: true,
      hxOpen: { [e.id]: true },
      returnTo: { view: 'compare', y: window.scrollY },
    });
    window.scrollTo(0, 0);
  };
  const dxEv = (d: Diagnosis) => archive.events.find((e) => e.dx === d)!;
  const dxItem = (x: Diagnosis, snap: ISODate, other?: Diagnosis[]) => {
    const res = x.resolved && x.resolved <= snap;
    const isNew = other && other.indexOf(x) < 0;
    return {
      text: x.name,
      sub: (res ? 'Resolved ' + fMY(x.resolved!) : 'Open in record') + ' · documented ' + fMY(x.documented),
      tag:
        x.documented > snap
          ? 'Documented later, ' + fShort(x.documented)
          : isNew
            ? 'Newly recorded after A'
            : x.resolved && x.resolved > A && x.resolved <= B && snap === B
              ? 'Resolved between A and B'
              : '',
      tagColor: x.documented > snap ? C.rust : C.ink2,
      onClick: toHist(dxEv(x)),
    };
  };
  const medsAt = (d: ISODate) => archive.medications.filter((x) => x.start <= d && (!x.end || x.end > d));
  const mA = medsAt(A),
    mB = medsAt(B);
  const medEv = (x: Medication) => archive.events.find((e) => e.med === x && e.title.indexOf('Started') === 0)!;
  const medItem = (x: Medication, snap: ISODate, other?: Medication[]) => ({
    text: x.name,
    sub: doseAt(x, snap) + ' · since ' + fMY(x.start),
    tag: other && other.indexOf(x) < 0 ? 'Started after A' : '',
    tagColor: C.ink2,
    onClick: toHist(medEv(x)),
  });
  const pi = (d: ISODate) =>
    archive.events.filter(
      (e) => (e.type === 'procedure' || e.type === 'imaging' || e.type === 'report') && inRec(e, d),
    );
  const piA = pi(A),
    piB = pi(B);
  const piItem = (e: HealthEvent, snap: ISODate) => ({
    text: e.title,
    sub: fShort(e.date) + ' · ' + e.source,
    tag:
      e.documented > snap
        ? 'Documented later, ' + fShort(e.documented)
        : snap === B && piA.indexOf(e) < 0
          ? 'After A'
          : '',
    tagColor: e.documented > snap ? C.rust : C.ink2,
    onClick: toHist(e),
  });
  const started = archive.medications.filter((x) => x.start > A && x.start <= B),
    stopped = archive.medications.filter((x) => x.end && x.end > A && x.end <= B);
  const hxRows = [
    { label: 'Conditions recorded', a: dA.map((x) => dxItem(x, A)), b: dB.map((x) => dxItem(x, B, dA)) },
    { label: 'Medications active', a: mA.map((x) => medItem(x, A)), b: mB.map((x) => medItem(x, B, mA)) },
    {
      label: 'Procedures and imaging',
      a: piA
        .slice(-4)
        .reverse()
        .map((e) => piItem(e, A)),
      b: piB
        .slice(-4)
        .reverse()
        .map((e) => piItem(e, B)),
      aMore: piA.length > 4 ? piA.length - 4 + ' earlier not shown' : '',
      bMore: piB.length > 4 ? piB.length - 4 + ' earlier not shown' : '',
    },
  ].map((r) => Object.assign({ aMore: '', bMore: '' }, r, { aEmpty: !r.a.length, bEmpty: !r.b.length }));
  const between = archive.events.filter((e) => evK(e) > A && evK(e) <= B).sort((a, b) => (evK(a) < evK(b) ? -1 : 1));
  const sig = between.filter((e) => e.type !== 'lab' && !(e.type === 'visit' && e.title.indexOf('Annual') === 0));
  const bList = s.cAll ? between : sig;
  const retro = archive.events.filter((e) => e.date <= A && e.documented > A && e.documented <= B);
  const docsAt = (d: ISODate) =>
    archive.documents.filter((x) => (mode === 'known' ? x.documented : x.date) <= d).length;
  const resAt = (v: (r: LabResult) => boolean) => archive.markers.reduce((n, mk) => n + mk.results.filter(v).length, 0);
  const drawsAt = (d: ISODate) => archive.draws.filter(([dd]) => (mode === 'known' ? addDays(dd, 4) : dd) <= d).length;
  const cntT = (d: ISODate, types: EventType[]) =>
    archive.events.filter((e) => types.indexOf(e.type) >= 0 && inRec(e, d)).length;
  const led = (label: string, a: number, b: number) => ({
    label,
    a: String(a),
    b: String(b),
    diff: b - a > 0 ? '+' + (b - a) : b - a < 0 ? '−' + (a - b) : '0',
  });
  const ledger = [
    led('Laboratory results', resAt(vA), resAt(vB)),
    led('Laboratory draws', drawsAt(A), drawsAt(B)),
    led('Documents in the record', docsAt(A), docsAt(B)),
    led('Visits', cntT(A, ['visit']), cntT(B, ['visit'])),
    led('Imaging reports', cntT(A, ['imaging']), cntT(B, ['imaging'])),
    led('Procedures and pathology', cntT(A, ['procedure', 'report']), cntT(B, ['procedure', 'report'])),
    led('Conditions recorded', dA.length, dB.length),
    led('Medications active', mA.length, mB.length),
    led(
      'Weight readings',
      archive.weight.filter((w) => w.date <= A).length,
      archive.weight.filter((w) => w.date <= B).length,
    ),
  ];
  const newDx = dB.filter((x) => dA.indexOf(x) < 0);
  const facts = [
    plural(between.length, 'event was', 'events were') + ' documented between A and B.',
    newDx.length
      ? 'Newly recorded diagnoses: ' + newDx.map((x) => x.name).join(', ') + '.'
      : 'No diagnoses were newly recorded between A and B.',
    started.length
      ? 'Medications started: ' + started.map((x) => x.name + ' (' + fMY(x.start) + ')').join(', ') + '.'
      : 'No medications started between A and B.',
    stopped.length
      ? 'Medications stopped: ' + stopped.map((x) => x.name + ' (' + fMY(x.end!) + ')').join(', ') + '.'
      : 'No medications stopped between A and B.',
    plural(docsAt(B) - docsAt(A), 'document was', 'documents were') + ' added to the record between A and B.',
  ];
  if (archive.gaps.some(([g0, g1]) => g0 < B && g1 > A))
    facts.push('The period includes a gap with no records in the archive, July 2012 to February 2015.');
  if (retro.length)
    facts.push(
      plural(retro.length, 'record about the time before A was', 'records about the time before A were') +
        ' documented after A.',
    );
  const presets = (
    [
      [
        '1 year apart',
        () => store.setState({ cA: addMonths(B, -12) < archive.start ? archive.start : addMonths(B, -12), cB: B }),
      ],
      [
        '5 years apart',
        () => store.setState({ cA: addMonths(B, -60) < archive.start ? archive.start : addMonths(B, -60), cB: B }),
      ],
      ['Earliest record and today', () => store.setState({ cA: archive.events.map(evK).sort()[0], cB: archive.today })],
      [
        'Time machine date and today',
        () => store.setState({ cA: cur < archive.today ? cur : addMonths(archive.today, -12), cB: archive.today }),
      ],
    ] as [string, () => void][]
  ).map(([l, f]) => ({ label: l, onClick: f, bg: C.paper, fg: C.ink, pressed: false }));
  const age = (d: ISODate) => Math.floor(monthsBetween(archive.born, d) / 12);
  const snapBlock = (d: ISODate, key: SnapKey) => ({
    date: fLong(d),
    dVal: d,
    meta: 'Age ' + age(d) + ' · ' + (d === archive.today ? 'today' : span(d, archive.today) + ' before today'),
    onDate: (e: InputChange) => {
      if (e.target.value) setK(key, e.target.value);
    },
    yb: () => setK(key, addMonths(d, -12)),
    mb: () => setK(key, addMonths(d, -1)),
    mf: () => setK(key, addMonths(d, 1)),
    yf: () => setK(key, addMonths(d, 12)),
    useTm: () => setK(key, cur),
    setTm: () => store.setCur(d),
  });
  const sa = snapBlock(A0, 'cA'),
    sb = snapBlock(B0, 'cB');
  const used = (r: LabResult | undefined, snap: ISODate, l: string) =>
    r
      ? l +
        ' uses ' +
        fmtR(r) +
        ' ' +
        r.unit +
        (r.flag ? ' ' + r.flag : '') +
        ', collected ' +
        fShort(r.date) +
        ' (' +
        (r.date === snap ? 'on the snapshot date' : span(r.date, snap) + ' before ' + l) +
        ').'
      : l + ': no recorded value by ' + fShort(snap) + '.';
  return {
    minDate: archive.start,
    maxDate: archive.today,
    cA: sa,
    cB: sb,
    cInverted: inverted,
    cSwap: () => store.setState({ cA: B0, cB: A0 }),
    cSameDate: A === B,
    cGapText: A === B ? 'Same date' : span(A, B) + ' apart',
    cRuler: { A, B, aKey, bKey },
    cPresets: presets,
    cTmText: 'Time machine date: ' + fShort(cur),
    cModeNote:
      mode === 'known'
        ? 'As known then: each snapshot shows only what had been documented by its date.'
        : 'As understood now: each snapshot includes information about its date that was documented later, marked as such.',
    cLedger: ledger,
    cFacts: facts,
    cAShort: fShort(A),
    cBShort: fShort(B),
    cGroups: groups,
    cHideA: !!s.cHideEmpty,
    cHideBg: s.cHideEmpty ? C.ink : 'transparent',
    cToggleHide: () => store.setState({ cHideEmpty: !s.cHideEmpty }),
    cMkName: m.name,
    cMkMeta:
      m.panel +
      ' · ' +
      plural(m.results.length, 'result') +
      ' in full archive · ' +
      [...new Set(m.results.map((r) => r.unit))].join(' and '),
    cMkList: archive.markers.map((x) => ({
      label: x.short,
      onClick: () => store.setState({ cMk: x.key }),
      bg: x.key === m.key ? C.ink : C.paper,
      fg: x.key === m.key ? C.paper : C.ink,
      pressed: !!(x.key === m.key),
    })),
    cChart: { m, A, B, vB, ra, rb },
    cUsedA: used(ra, A, 'A'),
    cUsedB: used(rb, B, 'B'),
    cHasUsedA: !!ra,
    cHasUsedB: !!rb,
    cDocA: () => ra && store.openDrawDocument(ra.i),
    cDocB: () => rb && store.openDrawDocument(rb.i),
    cOpenExplorer: () => {
      store.setState({
        view: 'biomarkers',
        marker: m.key,
        sel: null,
        bxUnit: null,
        bxCmp: null,
        returnTo: { view: 'compare', y: window.scrollY },
      });
      window.scrollTo(0, 0);
    },
    cWeightChart: { A, B, wa, wb, lb },
    cWA: wa ? conv(wa.v).toFixed(1) + ' ' + wu : 'No recorded value',
    cWAd: wa
      ? fShort(wa.date) +
        ', ' +
        (wa.date === A ? 'on the snapshot date' : span(wa.date, A) + ' before A') +
        ' · ' +
        (wa.src === 'clinic' ? 'clinic visit' : 'smart scale')
      : 'No weight recorded by this date',
    cWB: wb ? conv(wb.v).toFixed(1) + ' ' + wu : 'No recorded value',
    cWBd: wb
      ? fShort(wb.date) +
        ', ' +
        (wb.date === B ? 'on the snapshot date' : span(wb.date, B) + ' before B') +
        ' · ' +
        (wb.src === 'clinic' ? 'clinic visit' : 'smart scale')
      : 'No weight recorded by this date',
    cWCh: wch || 'No change computed',
    cWNote:
      wnote +
      (wa && wb
        ? '. Readings between A and B: ' + archive.weight.filter((w) => w.date > A && w.date <= B).length + '.'
        : ''),
    cHxRows: hxRows,
    cBetween: bList.map((e) => ({
      date: fShort(e.date),
      type: TYPE_LABEL[e.type],
      title: e.title,
      source: e.source,
      later:
        e.documented !== e.date && mode === 'now' && e.documented > B
          ? 'Documented later, ' + fShort(e.documented)
          : '',
      onOpen: toHist(e),
      onDoc: () => store.openEventDocument(e),
    })),
    cBetweenEmpty: !bList.length,
    cBetweenTitle: s.cAll
      ? 'All ' + plural(between.length, 'event') + ' between A and B'
      : plural(sig.length, 'significant event') + ' between A and B',
    cBetweenToggle: s.cAll
      ? 'Show significant events only'
      : 'Show all ' + between.length + ', including routine visits and laboratory draws',
    cToggleAll: () => store.setState({ cAll: !s.cAll }),
    cRetro: retro.map((e) => ({
      date: fShort(e.date),
      type: TYPE_LABEL[e.type],
      title: e.title,
      documented: 'Documented ' + fShort(e.documented),
      onOpen: toHist(e),
      onDoc: () => store.openEventDocument(e),
    })),
    cHasRetro: retro.length > 0,
    cNoRetro: !retro.length,
  };
}
