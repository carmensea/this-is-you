// Turns verified laboratory results into the records the existing screens read.
// Only verified results come through. Proposed and rejected ones never reach a chart.
import { fShort, fMY } from '../domain/dates';
import type {
  Archive,
  ArchiveDocument,
  HealthEvent,
  LabObservation,
  LabResult,
  Marker,
  MarkerCategory,
  UnplottedResult,
} from '../domain/types';

export const NO_UNIT = 'no unit recorded';
const NO_LAB = 'Laboratory not recorded';

const CATEGORY_NAMES: MarkerCategory[] = [
  { key: 'cbc', name: 'Complete blood count', short: 'CBC' },
  { key: 'cmp', name: 'Metabolic panel', short: 'metabolic' },
  { key: 'lipid', name: 'Lipid panel', short: 'lipids' },
  { key: 'thyroid', name: 'Thyroid function', short: 'thyroid' },
  { key: 'other', name: 'Other results', short: 'other' },
];

const FIRST_CHOICE_MARKERS = ['ldl', 'a1c', 'tsh', 'hgb', 'glu'];

/** The lab's flag as printed, with its common spellings shortened for charts. Never worked out from a range. */
function chartFlag(flag: string | null): string {
  const upper = (flag ?? '').toUpperCase();
  if (upper === 'H' || upper === 'HI' || upper === 'HIGH') return 'H';
  if (upper === 'L' || upper === 'LO' || upper === 'LOW') return 'L';
  return flag ?? '';
}

const decimals = (text: string) => (text.includes('.') ? text.split('.')[1].length : 0);
const markerKey = (o: LabObservation) => o.test_code ?? 'name:' + o.reported_name.toLowerCase().split(/\s+/).join(' ');

/** The date this result counts as known. Without a documented date, that is when it reached the archive. */
export const knownDate = (o: LabObservation, localDate: (iso: string) => string) =>
  o.documented_on ?? localDate(o.imported_at);

type Clinical = Pick<
  Archive,
  | 'start'
  | 'chartStart'
  | 'chartEnd'
  | 'firstYear'
  | 'lastYear'
  | 'labs'
  | 'draws'
  | 'drawDocumented'
  | 'drawDocuments'
  | 'categories'
  | 'markers'
  | 'overviewMarkers'
  | 'events'
  | 'unplotted'
  | 'knownLimits'
  | 'recentImports'
>;

export function buildClinicalRecords(
  observations: LabObservation[],
  documents: ArchiveDocument[],
  today: string,
  localDate: (iso: string) => string,
): Clinical {
  const byId = Object.fromEntries(documents.map((d) => [d.id, d]));
  const labName = (o: LabObservation) => {
    const provider = o.document_id ? byId[o.document_id]?.review?.fields.provider.value : null;
    return o.lab_name ?? provider ?? NO_LAB;
  };
  // Report-read results come first, so that when a person also typed in the same result, the chart keeps the report's copy.
  const verified = observations
    .filter((o) => o.verification_status === 'verified')
    .sort((a, b) => Number(a.origin === 'manual') - Number(b.origin === 'manual'));
  const unplotted: UnplottedResult[] = [];
  const chartable: LabObservation[] = [];
  const seen = new Set<string>();
  for (const o of verified) {
    const reason = !o.collected_on ? 'No collection date' : o.value_number === null ? 'Not an exact number' : null;
    if (reason) {
      unplotted.push({
        key: markerKey(o),
        name: o.reported_name,
        value: o.value_text,
        unit: o.unit ?? '',
        date: o.collected_on,
        reason,
        documentId: o.document_id,
        id: o.id,
        userEntered: o.origin === 'manual',
      });
      continue;
    }
    // The same result from two documents is one point on a chart. Both sources stay in the archive.
    const same = [markerKey(o), o.collected_on, o.value_text, o.display_unit].join('|');
    if (seen.has(same)) continue;
    seen.add(same);
    chartable.push(o);
  }
  chartable.sort((a, b) =>
    a.collected_on! < b.collected_on! ? -1 : a.collected_on! > b.collected_on! ? 1 : a.id < b.id ? -1 : 1,
  );

  // A draw is one collection at one source. A second result for the same test starts another, so no row is lost.
  const draws: [string, string][] = [];
  const drawDocumented: string[] = [];
  const drawDocuments: (string | null)[] = [];
  const drawOrigins: LabObservation['origin'][] = [];
  const drawIndex = new Map<string, number>();
  const usedInDraw = new Set<string>();
  const markers = new Map<string, Marker>();
  for (const o of chartable) {
    const key = markerKey(o);
    const lab = labName(o);
    let occurrence = 0;
    const source = [o.collected_on, o.document_id ?? 'none', lab, o.origin];
    let drawKey = [...source, occurrence].join('|');
    while (usedInDraw.has(drawKey + '|' + key)) drawKey = [...source, ++occurrence].join('|');
    usedInDraw.add(drawKey + '|' + key);
    let i = drawIndex.get(drawKey);
    const known = knownDate(o, localDate);
    if (i === undefined) {
      i = draws.length;
      drawIndex.set(drawKey, i);
      draws.push([o.collected_on!, lab]);
      drawDocumented.push(known);
      drawDocuments.push(o.document_id);
      drawOrigins.push(o.origin);
    } else if (known < drawDocumented[i]) {
      drawDocumented[i] = known;
    }
    const result: LabResult = {
      i,
      date: o.collected_on!,
      documented: known,
      lab,
      value: o.value_number!,
      lo: o.reference_low,
      hi: o.reference_high,
      unit: o.display_unit ?? NO_UNIT,
      dp: decimals(o.value_text),
      flag: chartFlag(o.flag),
      documentId: o.document_id ?? '',
      displayValue: o.value_text,
      referenceText: o.reference_text,
      reportedName: o.reported_name,
      observationId: o.id,
      userEntered: o.origin === 'manual',
      reportedOn: o.reported_on,
    };
    let marker = markers.get(key);
    if (!marker) {
      marker = {
        key,
        cat: o.category,
        name: o.test_name ?? o.reported_name,
        short: o.test_short ?? o.reported_name,
        unit: result.unit,
        dp: result.dp,
        ref: {},
        vals: [],
        panel: CATEGORY_NAMES.find((c) => c.key === o.category)?.name ?? 'Other results',
        results: [],
        cmp: o.compare_group ?? undefined,
      };
      markers.set(key, marker);
    }
    marker.results.push(result);
  }
  for (const marker of markers.values()) {
    const counts = new Map<string, number>();
    marker.results.forEach((r) => counts.set(r.unit, (counts.get(r.unit) ?? 0) + 1));
    marker.unit = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    marker.dp = Math.max(...marker.results.map((r) => r.dp));
    marker.unplotted = unplotted.filter((u) => u.key === marker.key);
  }
  const markerList = [...markers.values()];
  const usedCategories = CATEGORY_NAMES.filter((c) => markerList.some((m) => m.cat === c.key));
  const preferred = FIRST_CHOICE_MARKERS.flatMap((k) => markerList.filter((m) => m.key === k));
  const rest = markerList.filter((m) => !preferred.includes(m)).sort((a, b) => b.results.length - a.results.length);

  const events: HealthEvent[] = draws.map(([date, lab], i) => {
    const documentId = drawDocuments[i];
    const shorts = usedCategories
      .filter((c) => markerList.some((m) => m.cat === c.key && m.results.some((r) => r.i === i)))
      .map((c) => c.short);
    return {
      id: 'e' + i,
      type: 'lab' as const,
      date,
      documented: drawDocumented[i],
      draw: i,
      title: (drawOrigins[i] === 'manual' ? 'User-entered results: ' : 'Laboratory results: ') + shorts.join(', '),
      source: lab,
      clinician: '',
      documentId: drawOrigins[i] === 'manual' ? '' : (documentId ?? ''),
      provenance: {
        format: drawOrigins[i] === 'manual' ? 'User-entered' : 'PDF',
        via: drawOrigins[i] === 'manual' ? 'Typed in by a person' : 'Direct upload',
        imported: documentId && byId[documentId] ? byId[documentId].imported : fShort(drawDocumented[i]),
        status: 'Verified by you',
        ext: 'pdf',
      },
    };
  });

  const todayYear = +today.slice(0, 4);
  const firstYear = draws.length ? +draws[0][0].slice(0, 4) : todayYear;
  return {
    start: `${firstYear}-01-01`,
    chartStart: firstYear,
    chartEnd: todayYear + 1,
    firstYear,
    lastYear: todayYear,
    labs: Object.fromEntries(draws.map(([, lab]) => [lab, lab])),
    draws,
    drawDocumented,
    drawDocuments,
    categories: usedCategories,
    markers: markerList,
    overviewMarkers: [...preferred, ...rest].slice(0, 5),
    events,
    unplotted,
    knownLimits: [
      {
        title: 'Only verified results',
        detail: 'Results appear here after you approve them. Proposed and rejected results are left out.',
      },
      ...(unplotted.length
        ? [
            {
              title: 'Results not on the charts',
              detail: `${unplotted.length} verified ${unplotted.length === 1 ? 'result has' : 'results have'} no collection date or no exact number.`,
            },
          ]
        : []),
      ...(draws.length
        ? [
            {
              title: 'History begins',
              detail: `The earliest verified result was collected in ${fMY(draws[0][0])}. Earlier history may exist but is not in this archive.`,
            },
          ]
        : []),
      {
        title: 'Not read yet',
        detail: 'Medications, conditions, imaging findings and weight are not taken from documents in this version.',
      },
    ],
    recentImports: documents.slice(0, 5).map((d) => ({
      title: d.title,
      meta: `${d.source} · ${d.format} · ${d.imported}`,
      stage: d.status === 'reviewed' ? (3 as const) : d.status === 'parsed' ? (2 as const) : (1 as const),
      note: d.note ?? '',
    })),
  };
}
