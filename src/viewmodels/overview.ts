import type { Click } from './events';
import { fLong, fMY, fShort, monthsBetween, span, toT } from '../domain/dates';
import {
  axisExtentLabel,
  doseAt,
  flagText,
  fmtR,
  plural,
  provenanceText,
  refText,
  reportedText,
} from '../domain/format';
import { TYPE_LABEL } from '../domain/vocabulary';
import { overviewDomain } from '../charts/scale';
import { C } from '../theme';
import type { AppStore } from '../state/store';
import type { EventType, HealthEvent, ISODate, WeightReading } from '../domain/types';

/** Links shown under "Go to" on the Overview. */
function exploreLinks(store: AppStore) {
  const archive = store.archive;
  return [
    {
      label: 'Biomarkers',
      detail: 'Full archive: ' + archive.markers.length + ' measures, ' + archive.draws.length + ' laboratory draws',
      onClick: () => store.go('biomarkers'),
    },
    {
      label: 'Medical history',
      detail:
        'Full archive: ' +
        archive.events.length +
        ' events since ' +
        (archive.events[0] ? fMY(archive.events[0].date) : ''),
      onClick: () => store.go('history'),
    },
    {
      label: 'Documents',
      detail:
        'Full archive: ' +
        archive.documents.length +
        ' files from ' +
        plural(new Set(archive.documents.map((d) => d.source)).size, 'source'),
      onClick: () => store.go('documents'),
    },
    { label: 'Compare', detail: 'Two snapshots of the same record, side by side', onClick: () => store.go('compare') },
    {
      label: 'Import',
      detail:
        archive.documents.filter((d) => store.documentStatus(d) === 'parsed').length + ' documents waiting for review',
      onClick: () => store.go('import'),
    },
  ];
}

export function overviewVM(store: AppStore) {
  const archive = store.archive,
    s = store.state,
    cur = s.cur,
    mode = store.snapshotMode;
  const lb = s.units === 'lb',
    rVis = store.isVisible,
    vis = store.isVisible;
  const later = (e: HealthEvent) => e.date <= cur && e.documented > cur;
  const visEv = archive.events.filter(vis),
    laterEv = archive.events.filter(later);
  const cnt = (t: EventType) => visEv.filter((e) => e.type === t).length;
  const wIsVis = (w: WeightReading) => w.date <= cur;
  const wVis = archive.weight.filter(wIsVis);
  const sources = new Set(visEv.map((e) => e.source));
  if (wVis.some((w) => w.src === 'scale')) sources.add('VeSync');
  const docs = visEv.length + (wVis.some((w) => w.src === 'scale') ? 1 : 0);
  const m = archive.markers.find((x) => x.key === s.marker) || archive.markers[0];
  const visRes = m.results.filter(rVis);
  const selR = m.results.find((r) => r.i === store.state.sel) || visRes[visRes.length - 1] || m.results[0];
  const lastLab = archive.draws
    .map((d, i) => ({ date: d[0], documented: archive.drawDocumented[i], lab: d[1] }))
    .filter(rVis)
    .pop();
  const inGap = archive.gaps.some(([a, b]) => cur >= a && cur <= b);
  const months = archive.born ? monthsBetween(archive.born, cur) : 0;

  const resultsKnown = archive.markers.reduce((n, mk) => n + mk.results.filter(rVis).length, 0);
  const summarySentence =
    archive.kind === 'personal'
      ? docs === 0
        ? 'Nothing has been recorded by this date. Your verified results begin in ' + fMY(archive.draws[0][0]) + '.'
        : `By ${fShort(cur)}, the archive holds ${plural(resultsKnown, 'verified laboratory result')} from ${plural(cnt('lab'), 'collection')}.`
      : docs === 0
        ? 'Nothing has been recorded by this date. The archive begins in ' + fMY(archive.events[0].date) + '.'
        : `By ${fShort(cur)}, the archive holds ${plural(docs, 'document')} from ${plural(sources.size, 'source')}: ${plural(cnt('lab'), 'laboratory panel')}, ${plural(cnt('imaging'), 'imaging report')}, ${plural(cnt('visit'), 'visit')}, ${plural(cnt('procedure') + cnt('report'), 'procedure or pathology record', 'procedure and pathology records')}, and ${plural(wVis.length, 'weight measurement')}.`;

  const markerTabs = archive.overviewMarkers.map((mk) => {
    const lv = mk.results.filter(rVis).pop();
    const sel = mk.key === m.key;
    return {
      label: mk.short,
      sub: lv ? fmtR(lv) + ' ' + mk.unit + (lv.flag ? ' ' + lv.flag : '') : 'not yet measured',
      selected: sel,
      border: sel ? C.ink : 'transparent',
      color: sel ? C.ink : C.ink2,
      onClick: () => store.setState({ marker: mk.key, sel: null }),
    };
  });
  const labsInSeries = [...new Set(m.results.map((r) => r.lab))];
  const [d0, d1] = overviewDomain(store, toT(cur));
  const selFields = [
    { k: 'Collected', v: fLong(selR.date) },
    { k: 'Result', v: fmtR(selR) + ' ' + m.unit },
    { k: 'Range printed on report', v: refText(selR) },
    {
      k: 'Flag on report',
      v: flagText(selR.flag),
    },
    { k: 'Laboratory', v: archive.labs[selR.lab] },
    { k: 'Reported', v: reportedText(selR) },
    ...(provenanceText(selR) ? [{ k: 'Provenance', v: provenanceText(selR) }] : []),
  ];
  const selStatus = rVis(selR)
    ? ''
    : selR.date > cur
      ? 'Collected after the snapshot date'
      : 'Reported after the snapshot date, not known then';

  const valueRows = archive.overviewMarkers.map((mk) => {
    const lv = mk.results.filter(rVis).pop();
    const sel = mk.key === m.key;
    return {
      name: mk.short,
      ref: lv ? (lv.userEntered ? 'User-entered · ' : '') + 'Range ' + refText(lv) : mk.panel,
      value: lv ? fmtR(lv) : 'Not measured',
      valColor: lv ? C.ink : C.ink3,
      flag: lv && lv.flag ? lv.flag : '',
      unit: lv ? mk.unit : '',
      date: lv ? fShort(lv.date) : '',
      ago: lv ? span(lv.date, cur) + ' earlier' : '',
      bg: sel ? '#EDE9DF' : 'transparent',
      onClick: () => store.setState({ marker: mk.key, sel: null }),
    };
  });
  const medRows = archive.medications
    .filter((x) => x.start <= cur && (!x.end || x.end > cur))
    .map((x) => ({ name: x.name, dose: doseAt(x, cur), since: 'Since ' + fMY(x.start) }));
  const dxRows = archive.diagnoses
    .filter((d) => (mode === 'known' ? d.documented <= cur : d.onset <= cur))
    .map((d) => {
      const res = d.resolved && d.resolved <= cur;
      const isL = d.documented > cur;
      return {
        name: d.name,
        status: res ? 'Resolved ' + fMY(d.resolved!) : 'Open in record',
        meta:
          (d.onset !== d.documented
            ? 'Onset ' + fMY(d.onset) + ', documented ' + fMY(d.documented)
            : 'Documented ' + fMY(d.documented)) +
          ' · ' +
          d.source,
        isLater: isL,
        laterText: isL ? 'Documented later, on ' + fShort(d.documented) + '. ' + (d.note || '') : '',
      };
    })
    .reverse();
  const eventRows = [...visEv]
    .reverse()
    .slice(0, 7)
    .map((e) => ({
      date: fShort(e.date),
      type: TYPE_LABEL[e.type],
      title: e.title,
      source: e.source,
      later: e.documented > cur ? 'Documented later, ' + fShort(e.documented) : '',
      onClick: () => store.setCur(store.evKey(e)),
    }));
  if (!eventRows.length)
    eventRows.push({
      date: '',
      type: '',
      title: 'No events recorded before this date.',
      source: '',
      later: '',
      onClick: () => {},
    });

  const keys = [...new Set(archive.events.map((e) => store.evKey(e)))].sort();
  const nk = keys.find((x) => x > cur),
    pk = [...keys].reverse().find((x) => x < cur);
  const evAt = (k: ISODate) => archive.events.find((e) => store.evKey(e) === k)!;
  const curY = +cur.slice(0, 4);
  const years = [];
  for (let y = archive.firstYear; y <= archive.lastYear; y++) {
    const has = archive.events.some((e) => +e.date.slice(0, 4) === y);
    const act = y === curY;
    years.push({
      short: String(y),
      title: has ? 'Jump to ' + y : y + ': no records',
      color: act ? C.ink : has ? C.ink2 : C.ink3,
      border: act ? C.green : 'transparent',
      deco: has ? 'none' : 'line-through',
      onClick: () => {
        let c = y + cur.slice(4);
        if (c.slice(5) === '02-29') c = y + '-02-28';
        store.setCur(c);
      },
    });
  }
  const lastW = wVis[wVis.length - 1];
  const stageC = ['', '#6E6A61', '#8A5A1F', C.green];

  return {
    hasBirthDate: !!archive.born,
    hasWeight: archive.weight.length > 0,
    curLong: fLong(cur),
    curShort: fShort(cur),
    age: Math.floor(months / 12),
    agoText: cur === archive.today ? 'Today' : span(cur, archive.today) + ' before today',
    modeText:
      mode === 'known'
        ? 'Shows only what had been documented on or before this date. Results reported later, addenda and retrospective diagnoses are left out.'
        : 'Includes information about this period that was documented afterwards. Each such item is marked with the date it was actually recorded.',

    prevEvent: () => store.stepEvent(-1),
    nextEvent: () => store.stepEvent(1),
    prevLabel: pk
      ? 'Previous: ' + evAt(pk).title + ', ' + fShort(pk)
      : 'Previous: none, this is the start of the archive',
    nextLabel: nk ? 'Next: ' + evAt(nk).title + ', ' + fShort(nk) : 'Next: none recorded after this date',
    years,
    summarySentence,
    inGap,
    lastLabText: lastLab
      ? 'Most recent laboratory draw: ' +
        fShort(lastLab.date) +
        ' at ' +
        archive.labs[lastLab.lab] +
        ', ' +
        span(lastLab.date, cur) +
        ' before this date.'
      : 'No laboratory results on record yet.',
    hasLater: mode === 'known' && laterEv.length > 0,
    laterText:
      plural(laterEv.length, 'record about this period was', 'records about this period were') +
      ' documented after this date and are hidden.',
    laterAction: 'Show as understood now',
    markerName: m.name,
    markerMeta:
      m.panel +
      ' · ' +
      plural(m.results.length, 'result') +
      ' in archive · ' +
      labsInSeries.map((l) => archive.labs[l]).join(' and '),
    markerTabs,
    rangeAll: () => store.setState({ range: 'all' }),
    rangeWin: () => store.setState({ range: 'window' }),
    rAllBg: store.state.range === 'all' ? C.ink : 'transparent',
    rAllFg: store.state.range === 'all' ? C.paper : C.ink,
    rWinBg: store.state.range === 'window' ? C.ink : 'transparent',
    rWinFg: store.state.range === 'window' ? C.paper : C.ink,
    markerChart: { m, cur, selR },
    axisNote:
      'Vertical axis ' +
      axisExtentLabel(m) +
      ' ' +
      m.unit +
      ', not starting at zero. Showing ' +
      Math.floor(d0) +
      ' to ' +
      Math.min(archive.lastYear, Math.floor(d1)) +
      '. Points are individual draws; lines join draws less than about two years apart.',
    selFields,
    selStatus,
    selDoc: selR.userEntered
      ? archive.drawDocuments[selR.i]
        ? 'User-entered, linked to a document'
        : 'None, user-entered'
      : 'Lab report, ' + archive.labs[selR.lab] + ', ' + fShort(selR.date) + ' (PDF)',
    openDoc: (e: Click) => {
      e.preventDefault();
      store.openDrawDocument(selR.i);
    },
    rangeNote:
      labsInSeries.length > 1
        ? 'Reference ranges differ between the laboratories in this series, and methods may differ too. Each shaded band shows the range printed on that specific report. Values from different laboratories may not be directly comparable.'
        : 'The shaded band shows the reference range printed on each report by the laboratory.',
    weightLb: lb,
    weightSummary: lastW
      ? 'Last reading before this date: ' +
        (lb ? (lastW.v * 2.20462).toFixed(1) + ' lb' : lastW.v.toFixed(1) + ' kg') +
        ', ' +
        fShort(lastW.date) +
        ', ' +
        (lastW.src === 'clinic' ? 'clinic visit' : 'smart scale')
      : 'No weight recorded before this date',
    valueRows,
    medRows,
    noMeds: !medRows.length,
    dxRows,
    noDx: !dxRows.length,
    eventRows,
    openBiomarkers: () => store.go('biomarkers'),
    openHistory: () => store.go('history'),
    imports: archive.recentImports.map((d) => ({
      title: d.title,
      meta: d.meta,
      note: d.note,
      stageLabel: ['', 'Uploaded', 'Parsed, needs review', 'Reviewed'][d.stage],
      stageColor: stageC[d.stage],
      s1: C.ink,
      s2: d.stage >= 2 ? C.ink : 'transparent',
      s3: d.stage >= 3 ? C.green : 'transparent',
    })),
    gaps: archive.knownLimits,
    explore: exploreLinks(store),
  };
}
