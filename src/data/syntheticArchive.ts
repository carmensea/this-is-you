// Fictional demonstration data. Every person, provider, value and document here is invented.
// Replace with a real source through services/archiveApi.ts; screens never import this file.
import { addDays, fLong, fShort, toT } from '../domain/dates';
import { DCATL } from '../domain/vocabulary';
import type { Archive, ArchiveDocument, Diagnosis, DocumentCategory, DocumentProvenance, EventType, HealthEvent, ImportFile, ImportRecord, LabCode, LowConfidenceSet, Marker, MarkerCategory, Medication, TreatmentPeriod, WeightReading } from '../domain/types';

const START = '2009-01-01',
  TODAY = '2026-11-01',
  BORN = '1984-02-17';

const LABS: Record<LabCode, string> = { H: 'Harbor Diagnostics', N: 'Northfield Clinical Laboratory' };
const DRAWS: [string, LabCode][] = [
  ['2009-05-12', 'H'],
  ['2010-11-03', 'H'],
  ['2012-06-19', 'H'],
  ['2015-02-24', 'N'],
  ['2016-08-30', 'N'],
  ['2016-12-06', 'N'],
  ['2017-09-14', 'N'],
  ['2018-09-20', 'N'],
  ['2019-07-11', 'N'],
  ['2020-11-17', 'N'],
  ['2021-07-22', 'N'],
  ['2021-12-08', 'N'],
  ['2022-09-15', 'N'],
  ['2023-09-28', 'N'],
  ['2024-10-02', 'N'],
  ['2025-10-09', 'N'],
  ['2026-09-24', 'N'],
];
const CATS: MarkerCategory[] = [
  { key: 'cbc', name: 'Complete blood count', short: 'CBC' },
  { key: 'cmp', name: 'Metabolic panel', short: 'metabolic' },
  { key: 'lipid', name: 'Lipid panel', short: 'lipids' },
  { key: 'thyroid', name: 'Thyroid function', short: 'thyroid' },
  { key: 'vit', name: 'Vitamins and minerals', short: 'vitamins' },
];
type RawMarker = Omit<Marker, 'panel' | 'results'>;
const RAW_MARKERS: RawMarker[] = [
  {
    key: 'hgb',
    cat: 'cbc',
    name: 'Hemoglobin',
    short: 'Hemoglobin',
    unit: 'g/dL',
    dp: 1,
    ref: { H: [13.5, 17.5], N: [13.2, 17.1] },
    vals: [14.8, 15.1, 14.6, 14.9, 15.2, null, 14.7, 15.0, 14.5, 14.9, 15.3, null, 14.8, 15.1, 14.6, 14.9, 15.0],
  },
  {
    key: 'hct',
    cat: 'cbc',
    name: 'Hematocrit',
    short: 'Hematocrit',
    unit: '%',
    dp: 1,
    ref: { H: [40, 52], N: [38.5, 50] },
    vals: [44.1, 45.0, 43.6, 44.5, 45.3, null, 43.9, 44.8, 43.2, 44.4, 45.6, null, 44.0, 45.1, 43.7, 44.5, 44.9],
  },
  {
    key: 'wbc',
    cat: 'cbc',
    name: 'White blood cell count',
    short: 'WBC',
    unit: '×10³/µL',
    dp: 1,
    ref: { H: [4.0, 11.0], N: [3.8, 10.8] },
    vals: [6.2, 5.8, 6.9, 7.1, 6.4, null, 5.9, 6.6, 7.0, 6.1, 5.7, null, 6.3, 6.8, 11.2, 6.5, 6.0],
  },
  {
    key: 'plt',
    cat: 'cbc',
    name: 'Platelet count',
    short: 'Platelets',
    unit: '×10³/µL',
    dp: 0,
    ref: { H: [150, 400], N: [140, 400] },
    vals: [248, 262, 239, 255, 270, null, 244, 251, 236, 259, 266, null, 247, 253, 241, 250, 245],
  },
  {
    key: 'glu',
    cat: 'cmp',
    name: 'Glucose, fasting',
    short: 'Glucose',
    unit: 'mg/dL',
    dp: 0,
    ref: { H: [70, 110], N: [65, 99] },
    vals: [88, 91, 94, 96, 97, null, 95, 101, 99, 98, 103, null, 97, 96, 99, 95, 94],
  },
  {
    key: 'a1c',
    cat: 'cmp',
    name: 'Hemoglobin A1c',
    short: 'HbA1c',
    unit: '%',
    dp: 1,
    ref: { H: [4.0, 6.0], N: [4.0, 5.6] },
    vals: [5.2, null, 5.3, 5.4, null, null, 5.4, null, 5.6, null, 5.7, null, 5.6, 5.5, 5.6, 5.5, 5.4],
  },
  {
    key: 'creat',
    cat: 'cmp',
    name: 'Creatinine',
    short: 'Creatinine',
    unit: 'mg/dL',
    units: { H: 'µmol/L' },
    dp: 2,
    dps: { 'µmol/L': 0 },
    ref: { H: [62, 115], N: [0.76, 1.27] },
    vals: [84, 86, 88, 0.98, 1.01, null, 0.99, 1.03, 1.0, 1.02, 1.05, null, 1.01, 1.04, 1.06, 1.03, 1.02],
  },
  {
    key: 'egfr',
    cat: 'cmp',
    name: 'Estimated glomerular filtration rate',
    short: 'eGFR',
    unit: 'mL/min/1.73m²',
    dp: 0,
    ref: { N: [60, null] },
    vals: [null, null, null, 98, 96, null, 97, 93, 95, 93, 90, null, 92, 89, 87, 89, 90],
    method: {
      date: '2022-01-01',
      label: 'Calculation changed',
      text: 'Reports from 2022 onward state that a revised eGFR equation was used. Values before and after this point were calculated differently and may not be directly comparable.',
    },
  },
  {
    key: 'na',
    cat: 'cmp',
    name: 'Sodium',
    short: 'Sodium',
    unit: 'mmol/L',
    dp: 0,
    ref: { H: [135, 145], N: [135, 146] },
    vals: [140, 141, 139, 140, 141, null, 140, 142, 139, 140, 141, null, 140, 139, 141, 140, 140],
  },
  {
    key: 'k',
    cat: 'cmp',
    name: 'Potassium',
    short: 'Potassium',
    unit: 'mmol/L',
    dp: 1,
    ref: { H: [3.5, 5.1], N: [3.5, 5.3] },
    vals: [4.2, 4.0, 4.4, 4.1, 4.3, null, 4.2, 4.5, 4.0, 4.3, 4.4, null, 4.6, 4.2, 4.3, 4.1, 4.4],
  },
  {
    key: 'alt',
    cat: 'cmp',
    name: 'Alanine aminotransferase',
    short: 'ALT',
    unit: 'U/L',
    dp: 0,
    ref: { H: [7, 56], N: [9, 46] },
    vals: [24, 27, 31, 29, 33, null, 35, 38, 36, 41, 49, null, 34, 30, 28, 27, 26],
  },
  {
    key: 'tc',
    cat: 'lipid',
    name: 'Total cholesterol',
    short: 'Total chol.',
    unit: 'mg/dL',
    dp: 0,
    cmp: 'lipid',
    ref: { H: [null, 200], N: [null, 200] },
    vals: [192, 198, 206, 214, 219, null, 224, 229, 226, 233, 238, 184, 170, 166, 175, 168, 163],
  },
  {
    key: 'ldl',
    cat: 'lipid',
    name: 'LDL cholesterol',
    short: 'LDL',
    unit: 'mg/dL',
    dp: 0,
    cmp: 'lipid',
    ref: { H: [null, 130], N: [null, 100] },
    vals: [118, 124, 131, 138, 142, null, 146, 151, 149, 155, 158, 112, 98, 94, 101, 96, 92],
  },
  {
    key: 'hdl',
    cat: 'lipid',
    name: 'HDL cholesterol',
    short: 'HDL',
    unit: 'mg/dL',
    dp: 0,
    cmp: 'lipid',
    ref: { H: [40, null], N: [40, null] },
    vals: [48, 47, 46, 45, 44, null, 45, 43, 44, 42, 41, 47, 49, 50, 48, 51, 52],
  },
  {
    key: 'tg',
    cat: 'lipid',
    name: 'Triglycerides',
    short: 'Triglycerides',
    unit: 'mg/dL',
    dp: 0,
    cmp: 'lipid',
    ref: { H: [null, 150], N: [null, 150] },
    vals: [128, 134, 145, 152, 166, null, 161, 174, 168, 176, 193, 126, 115, 109, 131, 118, 112],
  },
  {
    key: 'tsh',
    cat: 'thyroid',
    name: 'Thyroid stimulating hormone',
    short: 'TSH',
    unit: 'mIU/L',
    dp: 1,
    ref: { H: [0.4, 4.0], N: [0.45, 4.5] },
    vals: [2.1, 2.4, 2.8, 3.6, 6.8, 3.1, 2.2, 1.9, 2.0, 2.3, 2.6, null, 2.1, 1.8, 2.4, 2.0, 2.2],
  },
  {
    key: 'ft4',
    cat: 'thyroid',
    name: 'Free thyroxine',
    short: 'Free T4',
    unit: 'ng/dL',
    dp: 2,
    ref: { H: [0.8, 1.8], N: [0.82, 1.77] },
    vals: [null, null, null, null, 0.71, 1.02, 1.18, 1.21, null, 1.15, null, null, 1.24, null, 1.19, null, 1.22],
  },
  {
    key: 'vitd',
    cat: 'vit',
    name: 'Vitamin D, 25-hydroxy',
    short: 'Vitamin D',
    unit: 'ng/mL',
    dp: 0,
    ref: { N: [30, 100] },
    vals: [null, null, null, null, 24, null, 27, null, 22, 18, 34, 38, 41, 36, 33, 31, 35],
  },
  {
    key: 'b12',
    cat: 'vit',
    name: 'Vitamin B12',
    short: 'B12',
    unit: 'pg/mL',
    dp: 0,
    ref: { N: [232, 1245] },
    vals: [null, null, null, null, 412, null, null, 388, null, 402, null, null, 445, null, 421, null, 398],
  },
  {
    key: 'ferr',
    cat: 'vit',
    name: 'Ferritin',
    short: 'Ferritin',
    unit: 'ng/mL',
    dp: 0,
    ref: { N: [38, 380] },
    vals: [null, null, null, null, null, null, null, null, null, 96, null, null, 112, null, 104, null, 99],
  },
];
const MARKERS: Marker[] = RAW_MARKERS.map((m) => ({
  ...m,
  panel: CATS.find((c) => c.key === m.cat)!.name,
  results: DRAWS.flatMap(([d, l], i) => {
    const v = m.vals[i];
    if (v == null) return [];
    const r = m.ref[l] || [null, null],
      unit = (m.units && m.units[l]) || m.unit;
    return [
      {
        i,
        date: d,
        documented: addDays(d, 4),
        lab: l,
        value: v,
        lo: r[0],
        hi: r[1],
        unit,
        dp: m.dps && m.dps[unit] != null ? m.dps[unit] : m.dp,
        flag: (r[1] != null && v > r[1] ? 'H' : r[0] != null && v < r[0] ? 'L' : '') as '' | 'H' | 'L',
        documentId: 'lab-' + i,
      },
    ];
  }),
}));
const WHO: Record<string, string> = {
  'Harbor Family Medicine': 'Dr. P. Lindqvist',
  'Cedar Row Family Practice': 'Dr. M. Okafor',
  'St. Aldric Medical Center': 'Dr. R. Castellanos',
  'Linden Dermatology': 'Dr. S. Hale',
  'Westgate Imaging': 'Dr. A. Ferrante, radiologist',
  'Riverbend Physical Therapy': 'K. Duarte, physical therapist',
  'Harbor Diagnostics': 'Dr. P. Lindqvist',
  'Northfield Clinical Laboratory': 'Dr. M. Okafor',
};
const docOf = (date: string, source: string): DocumentProvenance => {
  if (source.indexOf('Harbor') === 0)
    return {
      format: 'Scanned PDF',
      via: 'Scanned reports, 2009 to 2012',
      imported: '14 Oct 2026',
      status: 'Parsed, needs review',
      ext: 'pdf',
    };
  if (date === '2026-09-24' && source === 'Northfield Clinical Laboratory')
    return {
      format: 'PDF, 3 pages',
      via: 'Direct upload',
      imported: '28 Oct 2026',
      status: 'Parsed, 2 values need review',
      ext: 'pdf',
    };
  if (source === 'Cedar Row Family Practice' || source === 'Northfield Clinical Laboratory')
    return {
      format: 'Clinical document (CCD)',
      via: 'MyChart export, Cedar Row',
      imported: '20 Oct 2026',
      status: 'Reviewed',
      ext: 'xml',
    };
  return { format: 'PDF', via: 'Direct upload', imported: '20 Oct 2026', status: 'Reviewed', ext: 'pdf' };
};
type RawEvent = {
  type: EventType;
  date: string;
  documented?: string;
  title: string;
  source: string;
  end?: string;
  who?: string;
  surgery?: boolean;
  draw?: number;
  med?: Medication;
  dx?: Diagnosis;
};
const RAW_EVENTS: RawEvent[] = [];
const ev = (o: RawEvent) => {
  RAW_EVENTS.push(o);
};
DRAWS.forEach(([d, l], i) =>
  ev({
    type: 'lab',
    date: d,
    documented: addDays(d, 4),
    draw: i,
    title:
      'Laboratory draw: ' +
      CATS.filter((c) => MARKERS.some((m) => m.cat === c.key && m.vals[i] != null))
        .map((c) => c.short)
        .join(', '),
    source: LABS[l],
  }),
);
(
  [
    ['2009-05-12', 'Annual physical examination', 'Harbor Family Medicine'],
    ['2010-11-03', 'Annual physical examination', 'Harbor Family Medicine'],
    ['2011-03-19', 'Emergency visit, right ankle injury', 'St. Aldric Medical Center'],
    ['2011-05-02', 'Orthopedic follow-up', 'St. Aldric Medical Center'],
    ['2012-06-19', 'Annual physical examination', 'Harbor Family Medicine'],
    ['2015-02-24', 'New patient visit', 'Cedar Row Family Practice'],
    ['2016-08-30', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2016-12-06', 'Follow-up visit, thyroid', 'Cedar Row Family Practice'],
    ['2017-09-14', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2018-03-02', 'Visit, lower back pain', 'Cedar Row Family Practice'],
    ['2018-09-20', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2019-07-11', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2020-03-26', 'Telehealth visit', 'Cedar Row Family Practice'],
    ['2020-11-17', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2021-07-22', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2021-08-05', 'Follow-up visit, blood pressure', 'Cedar Row Family Practice'],
    ['2021-12-08', 'Follow-up visit, lipids', 'Cedar Row Family Practice'],
    ['2022-05-04', 'Dermatology visit', 'Linden Dermatology'],
    ['2022-09-15', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2023-09-28', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2024-02-06', 'Visit, abdominal discomfort', 'Cedar Row Family Practice'],
    ['2024-10-02', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2025-10-09', 'Annual physical examination', 'Cedar Row Family Practice'],
    ['2026-09-24', 'Annual physical examination', 'Cedar Row Family Practice'],
  ] as [string, string, string][]
).forEach(([d, t, s]) => ev({ type: 'visit', date: d, title: t, source: s }));
ev({ type: 'imaging', date: '2011-03-19', title: 'X-ray, right ankle, report', source: 'St. Aldric Medical Center' });
ev({
  type: 'imaging',
  date: '2018-04-11',
  documented: '2018-04-13',
  title: 'MRI lumbar spine, report',
  source: 'Westgate Imaging',
});
ev({
  type: 'imaging',
  date: '2018-04-11',
  documented: '2019-01-09',
  title: 'MRI lumbar spine, addendum to report',
  source: 'Westgate Imaging',
});
ev({
  type: 'imaging',
  date: '2020-03-28',
  documented: '2020-03-30',
  title: 'Chest X-ray, report',
  source: 'Westgate Imaging',
});
ev({
  type: 'imaging',
  date: '2024-02-13',
  documented: '2024-02-14',
  title: 'Ultrasound, abdomen, report',
  source: 'Westgate Imaging',
});
ev({ type: 'procedure', date: '2011-03-19', title: 'Short leg cast applied', source: 'St. Aldric Medical Center' });
ev({
  type: 'procedure',
  date: '2018-05-01',
  end: '2018-07-10',
  title: 'Physical therapy, 8 sessions',
  source: 'Riverbend Physical Therapy',
});
ev({ type: 'procedure', date: '2022-05-04', title: 'Shave biopsy, left shoulder', source: 'Linden Dermatology' });
ev({
  type: 'report',
  date: '2022-05-04',
  documented: '2022-05-12',
  title: 'Pathology report, shave biopsy',
  source: 'Linden Dermatology',
});
ev({
  type: 'visit',
  date: '2024-03-05',
  title: 'Surgical consultation',
  source: 'St. Aldric Medical Center',
  who: 'Dr. L. Navarro',
});
ev({
  type: 'procedure',
  date: '2024-04-18',
  title: 'Laparoscopic cholecystectomy',
  source: 'St. Aldric Medical Center',
  who: 'Dr. L. Navarro',
  surgery: true,
});
ev({
  type: 'report',
  date: '2024-04-18',
  documented: '2024-04-23',
  title: 'Pathology report, gallbladder',
  source: 'St. Aldric Medical Center',
});
ev({
  type: 'visit',
  date: '2024-05-02',
  title: 'Post-operative follow-up',
  source: 'St. Aldric Medical Center',
  who: 'Dr. L. Navarro',
});
const MEDS: Medication[] = [
  {
    name: 'Ibuprofen 600 mg',
    dose: 'As needed, per discharge note',
    start: '2011-03-19',
    end: '2011-04-10',
    source: 'St. Aldric Medical Center',
  },
  {
    name: 'Levothyroxine',
    dose: '50 mcg daily',
    doses: [
      ['2016-10-01', '50 mcg daily'],
      ['2017-01-10', '75 mcg daily'],
    ],
    start: '2016-10-01',
    end: null,
    source: 'Cedar Row Family Practice',
  },
  {
    name: 'Cyclobenzaprine 5 mg',
    dose: 'At bedtime, as prescribed',
    start: '2018-04-12',
    end: '2018-05-20',
    source: 'Cedar Row Family Practice',
  },
  {
    name: 'Vitamin D3 2000 IU',
    dose: 'Daily, patient-reported',
    start: '2020-11-20',
    end: '2022-03-15',
    source: 'Cedar Row Family Practice',
  },
  { name: 'Lisinopril 10 mg', dose: 'Daily', start: '2021-08-05', end: null, source: 'Cedar Row Family Practice' },
  { name: 'Atorvastatin 10 mg', dose: 'Daily', start: '2021-09-02', end: null, source: 'Cedar Row Family Practice' },
  {
    name: 'Acetaminophen 500 mg',
    dose: 'As needed after surgery',
    start: '2024-04-18',
    end: '2024-04-30',
    source: 'St. Aldric Medical Center',
  },
];
MEDS.forEach((m) => ev({ type: 'medication', date: m.start, title: 'Started ' + m.name, source: m.source, med: m }));
MEDS.filter((m) => m.end).forEach((m) =>
  ev({ type: 'medication', date: m.end!, title: 'Stopped ' + m.name, source: m.source, med: m }),
);
ev({
  type: 'medication',
  date: '2017-01-10',
  title: 'Dose changed: Levothyroxine 75 mcg daily',
  source: 'Cedar Row Family Practice',
  med: MEDS[1],
});
const DX: Diagnosis[] = [
  {
    name: 'Right ankle fracture, lateral malleolus',
    onset: '2011-03-19',
    documented: '2011-03-19',
    resolved: '2011-06-20',
    source: 'St. Aldric Medical Center',
  },
  {
    name: 'Hypothyroidism',
    onset: '2016-09-08',
    documented: '2016-09-08',
    resolved: null,
    source: 'Cedar Row Family Practice',
  },
  {
    name: 'Low back pain',
    onset: '2018-03-02',
    documented: '2018-03-02',
    resolved: '2018-08-01',
    source: 'Cedar Row Family Practice',
  },
  {
    name: 'Essential hypertension',
    onset: '2019-06-01',
    documented: '2021-08-05',
    resolved: null,
    source: 'Cedar Row Family Practice',
    note: 'Onset dated retrospectively from home readings',
  },
  {
    name: 'Hyperlipidemia',
    onset: '2021-09-02',
    documented: '2021-09-02',
    resolved: null,
    source: 'Cedar Row Family Practice',
  },
  {
    name: 'Gallstones (cholelithiasis)',
    onset: '2024-02-14',
    documented: '2024-02-14',
    resolved: '2024-04-18',
    source: 'Cedar Row Family Practice',
  },
];
DX.forEach((d) =>
  ev({
    type: 'diagnosis',
    date: d.onset,
    documented: d.documented,
    title: 'Diagnosis recorded: ' + d.name,
    source: d.source,
    dx: d,
  }),
);
RAW_EVENTS.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const EVENTS: HealthEvent[] = RAW_EVENTS.map(({ who, ...o }, i) => ({
  ...o,
  id: 'e' + i,
  documented: o.documented || o.date,
  clinician: who || WHO[o.source] || '',
  provenance: docOf(o.date, o.source),
  documentId: o.draw != null ? 'lab-' + o.draw : 'ev-e' + i,
}));
const fileOf = (date: string, source: string, ext: string) =>
  source
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '') +
  '_' +
  date +
  '.' +
  ext;
// shortcut: stands in for the SHA-256 of a stored file, replace when originals are stored.
const hashOf = (str: string) => {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let h1 = 2166136261 ^ (r * 977);
    for (let i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i);
      h1 = Math.imul(h1, 16777619) >>> 0;
    }
    out += h1.toString(16).padStart(8, '0');
  }
  return out;
};
type RawDocument = Omit<ArchiveDocument, 'file' | 'hash' | 'size' | 'search'> & { file?: string; size?: string };
const DOCS: RawDocument[] = [];
DRAWS.forEach(([d, l], i) => {
  const src = LABS[l],
    meta = docOf(d, src),
    n = MARKERS.filter((m) => m.vals[i] != null).length;
  DOCS.push({
    id: 'lab-' + i,
    cat: 'lab',
    title:
      'Laboratory report: ' +
      CATS.filter((c) => MARKERS.some((m) => m.cat === c.key && m.vals[i] != null))
        .map((c) => c.short)
        .join(', '),
    date: d,
    documented: addDays(d, 4),
    source: src,
    who: WHO[src],
    draw: i,
    ext: meta.ext,
    format: meta.format,
    via: meta.via,
    imported: meta.imported,
    status: (meta.status.indexOf('Parsed') === 0 ? 'parsed' : 'reviewed') as 'parsed' | 'reviewed',
    pages: Math.ceil(n / 8),
    n,
  });
});
const ECAT: Partial<Record<EventType, DocumentCategory>> = {
  visit: 'note',
  imaging: 'imaging',
  report: 'pathology',
  procedure: 'procedure',
  diagnosis: 'note',
  medication: 'other',
};
EVENTS.filter((e) => e.type !== 'lab').forEach((e) => {
  const meta = e.provenance;
  DOCS.push({
    id: 'ev-' + e.id,
    cat: ECAT[e.type]!,
    title:
      e.type === 'diagnosis'
        ? 'Problem list entry: ' + e.dx!.name
        : e.type === 'medication'
          ? 'Medication record: ' + e.title
          : e.type === 'visit'
            ? 'Visit note: ' + e.title
            : e.title,
    date: e.date,
    documented: e.documented,
    source: e.source,
    who: e.clinician,
    ev: e.id,
    ext: meta.ext,
    format: meta.format,
    via: meta.via,
    imported: meta.imported,
    status: (meta.status.indexOf('Parsed') === 0 ? 'parsed' : 'reviewed') as 'parsed' | 'reviewed',
    pages: e.type === 'imaging' || e.type === 'report' ? 2 : 1,
    n: 0,
  });
});
(
  [
    {
      id: 'x-vesync',
      cat: 'other',
      title: 'Smart scale export',
      dateLabel: 'Jan 2019 to Oct 2026',
      date: '2019-01-15',
      documented: '2019-01-15',
      source: 'VeSync',
      who: '',
      ext: 'csv',
      file: 'vesync_weight_export_2026-10-27.csv',
      format: 'CSV, 2 columns',
      via: 'Direct upload',
      imported: '27 Oct 2026',
      status: 'reviewed',
      pages: 0,
      n: 0,
      rows: 0,
      note: 'Each row became one weight reading. Readings dated after the snapshot are not shown in historical views.',
    },
    {
      id: 'x-apple',
      cat: 'other',
      title: 'Apple Health export',
      date: '2026-10-19',
      documented: '2026-10-19',
      source: 'Apple Health',
      who: '',
      ext: 'zip',
      file: 'apple_health_export.zip',
      format: 'ZIP archive, export.xml inside',
      via: 'Direct upload',
      imported: '20 Oct 2026',
      status: 'uploaded',
      pages: 0,
      n: 0,
      size: '184 MB',
      note: 'Stored as uploaded. Reading Apple Health exports is planned but not available in this version.',
    },
    {
      id: 'x-disch',
      cat: 'note',
      title: 'Discharge summary, emergency visit',
      date: '2011-03-19',
      documented: '2011-03-19',
      source: 'St. Aldric Medical Center',
      who: 'Dr. R. Castellanos',
      ext: 'pdf',
      file: 'st_aldric_discharge_2011-03-19_scan.pdf',
      format: 'Scanned PDF',
      via: 'Scanned reports, 2009 to 2012',
      imported: '14 Oct 2026',
      status: 'uploaded',
      pages: 2,
      n: 0,
      note: 'Text recognition could not read this scan reliably. The original is stored; details can be entered manually.',
    },
    {
      id: 'x-heic',
      cat: 'other',
      title: 'Photo of prescription label',
      date: '2026-10-20',
      documented: '2026-10-20',
      source: 'Manual upload',
      who: '',
      ext: 'heic',
      file: 'IMG_2041.HEIC',
      format: 'HEIC image',
      via: 'Direct upload',
      imported: '20 Oct 2026',
      status: 'unsupported',
      pages: 0,
      n: 0,
      size: '2.6 MB',
      note: 'Images cannot be read in this version. The original is stored unchanged.',
    },
    {
      id: 'x-docx',
      cat: 'other',
      title: 'Letter from employer wellness program',
      date: '2019-03-01',
      documented: '2019-03-01',
      source: 'Manual upload',
      who: '',
      ext: 'docx',
      file: 'wellness_letter_2019.docx',
      format: 'Word document',
      via: 'Direct upload',
      imported: '20 Oct 2026',
      status: 'unsupported',
      pages: 0,
      n: 0,
      note: 'Word documents cannot be read in this version. The original is stored unchanged.',
    },
    {
      id: 'x-dup1',
      cat: 'lab',
      title: 'Laboratory report, second copy',
      date: '2018-09-20',
      documented: '2018-09-24',
      source: 'Northfield Clinical Laboratory',
      who: 'Dr. M. Okafor',
      ext: 'pdf',
      file: 'northfield_lab_2018-09-20 (1).pdf',
      format: 'PDF',
      via: 'MyChart export, Cedar Row',
      imported: '20 Oct 2026',
      status: 'uploaded',
      pages: 2,
      n: 0,
      dup: 'lab-7',
    },
    {
      id: 'x-dup2',
      cat: 'lab',
      title: 'Laboratory report, second copy',
      date: '2021-07-22',
      documented: '2021-07-26',
      source: 'Northfield Clinical Laboratory',
      who: 'Dr. M. Okafor',
      ext: 'pdf',
      file: 'northfield_lab_2021-07-22 (1).pdf',
      format: 'PDF',
      via: 'MyChart export, Cedar Row',
      imported: '20 Oct 2026',
      status: 'uploaded',
      pages: 2,
      n: 0,
      dup: 'lab-10',
    },
    {
      id: 'x-dup3',
      cat: 'lab',
      title: 'Laboratory report, second copy',
      date: '2023-09-28',
      documented: '2023-10-02',
      source: 'Northfield Clinical Laboratory',
      who: 'Dr. M. Okafor',
      ext: 'pdf',
      file: 'northfield_lab_2023-09-28 (1).pdf',
      format: 'PDF',
      via: 'MyChart export, Cedar Row',
      imported: '20 Oct 2026',
      status: 'uploaded',
      pages: 2,
      n: 0,
      dup: 'lab-13',
    },
  ] as RawDocument[]
).forEach((d) => DOCS.push(d));
const rawById: Record<string, RawDocument> = {};
DOCS.forEach((d) => {
  rawById[d.id] = d;
});
const DOCUMENTS: ArchiveDocument[] = DOCS.map((d) => {
  const file = d.file || fileOf(d.date, d.source, d.ext);
  const hash = hashOf(d.dup || d.id + file);
  return {
    ...d,
    file,
    hash,
    size:
      d.size ||
      (d.pages || 1) * (d.format.indexOf('Scanned') >= 0 ? 610 : 130) + (parseInt(hash.slice(0, 3), 16) % 90) + ' KB',
    note: d.dup
      ? 'Identical checksum to ' +
        DCATL.lab.toLowerCase() +
        ', ' +
        fShort(rawById[d.dup].date) +
        '. Set aside as a duplicate; nothing was extracted twice.'
      : d.note,
    search: [
      d.title,
      d.source,
      d.who || '',
      DCATL[d.cat],
      fLong(d.date),
      fShort(d.date),
      d.date,
      file,
      d.draw != null
        ? MARKERS.filter((m) => m.vals[d.draw!] != null)
            .map((m) => m.name + ' ' + m.short + ' ' + m.vals[d.draw!])
            .join(' ')
        : '',
    ]
      .join(' ')
      .toLowerCase(),
  };
});
const DOCUMENTS_BY_ID: Record<string, ArchiveDocument> = {};
DOCUMENTS.forEach((d) => {
  DOCUMENTS_BY_ID[d.id] = d;
});
const LOWCONF: Record<string, LowConfidenceSet> = {
  'lab-16': {
    creat: { read: '1.02', reason: 'Characters unclear in the original: read as 1.02, could be 1.07.' },
    ft4: { unit: 'ng/mL', reason: 'Unit read as ng/mL. Earlier Free T4 results in the archive are in ng/dL.' },
  },
  'lab-1': {
    _date: 'Printed as 11/03/2010. Read as 3 November 2010; could also be 11 March 2010.',
    hgb: { reason: 'Decimal point faint on the scan. Read as 15.1.' },
    wbc: { reason: 'Recognized as "5.B" and interpreted as 5.8.' },
    creat: { reason: 'Reported in µmol/L, unlike later reports in mg/dL. Kept as printed; no conversion.' },
  },
  'lab-0': { plt: { reason: 'Scan quality is low in this row. Read as 248.' } },
  'lab-2': { ldl: { reason: 'Flag column partly cut off at the page edge. The H flag is not certain.' } },
};
const SAMPLE: ImportFile[] = [
  {
    name: 'northfield_lab_2018-09-20.pdf',
    size: '412 KB',
    kind: 'Laboratory report',
    outcome: 'duplicate',
    result: 'Identical to the laboratory report of 20 Sep 2018 already in the archive. Set aside; nothing added.',
  },
  {
    name: 'MyChart_export_2026-10/',
    size: '42 files, 3.8 MB',
    kind: 'Patient portal export, folder',
    outcome: 'parsed',
    result: '42 documents found. 40 already in the archive. 2 visit notes extracted and waiting for review.',
  },
  {
    name: 'vesync_weight_2026-10.csv',
    size: '38 KB',
    kind: 'Smart scale export',
    outcome: 'parsed',
    result: '18 readings newer than the last import. Columns mapped: date, weight in kg.',
  },
  {
    name: 'fhir_bundle_linden_dermatology.json',
    size: '64 KB',
    kind: 'FHIR bundle',
    outcome: 'duplicate',
    result: '3 resources: visit, procedure, pathology report. All match existing records. Set aside.',
  },
  {
    name: 'westgate_mri_addendum_scan.pdf',
    size: '1.9 MB',
    kind: 'Imaging report, scanned',
    outcome: 'failed',
    result: 'Page 2 could not be read. Original stored; details can be entered manually.',
  },
  {
    name: 'IMG_2041.HEIC',
    size: '2.6 MB',
    kind: 'Image',
    outcome: 'unsupported',
    result: 'Images cannot be read in this version. Original stored; nothing extracted.',
  },
  {
    name: 'northfield_lab_2025-10-09_print.pdf',
    size: '388 KB',
    kind: 'Laboratory report',
    outcome: 'possible',
    result:
      'Same date and laboratory as an existing report, but a different file. All 19 values match. Marked as a possible duplicate.',
  },
];
const TREAT: TreatmentPeriod[] = MEDS.map((m): TreatmentPeriod => ({
  name: m.name,
  dose: m.dose,
  doses: m.doses,
  start: m.start,
  end: m.end,
}))
  .concat([
    {
      name: 'Physical therapy',
      dose: '8 sessions, Riverbend Physical Therapy',
      start: '2018-05-01',
      end: '2018-07-10',
    },
  ])
  .sort((a, b) => (a.start < b.start ? -1 : 1));
const GAPS: [string, string][] = [['2012-06-20', '2015-02-23']];
const CLINICW: [string, number][] = [
  ['2009-05-12', 78.2],
  ['2010-11-03', 79.0],
  ['2011-03-19', 80.1],
  ['2012-06-19', 81.4],
  ['2015-02-24', 84.0],
  ['2016-08-30', 85.2],
  ['2016-12-06', 84.6],
  ['2017-09-14', 86.1],
  ['2018-03-02', 87.0],
  ['2018-09-20', 86.4],
];
const WEIGHT: WeightReading[] = (() => {
  const out: WeightReading[] = CLINICW.map(([d, v]) => ({ date: d, v, src: 'clinic' }));
  let s = 11;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const kn = [
    [2019.0, 87.2],
    [2019.6, 87.9],
    [2020.3, 88.6],
    [2021.0, 88.1],
    [2021.6, 86.6],
    [2022.4, 84.2],
    [2023.0, 83.3],
    [2024.0, 81.8],
    [2025.0, 81.1],
    [2026.84, 80.4],
  ];
  const f = (t: number) => {
    for (let i = 1; i < kn.length; i++)
      if (t <= kn[i][0]) {
        const [a, va] = kn[i - 1],
          [b, vb] = kn[i];
        return va + ((vb - va) * (t - a)) / (b - a);
      }
    return kn[kn.length - 1][1];
  };
  let d = '2019-01-15';
  while (d <= '2026-10-30') {
    if (!(d >= '2022-06-02' && d <= '2022-11-20')) {
      const t = toT(d);
      out.push({
        date: d,
        v: Math.round((f(t) + (r() - 0.5) * 1.2 + Math.sin(t * 2 * Math.PI) * 0.35) * 10) / 10,
        src: 'scale',
      });
    }
    d = addDays(d, 3 + Math.floor(r() * 7));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
})();
const SCALE_N = WEIGHT.filter((w) => w.src === 'scale').length;
rawById['x-vesync'].rows = SCALE_N;
DOCUMENTS_BY_ID['x-vesync'].rows = SCALE_N;
const IMPORTS: ImportRecord[] = [
  {
    title: 'Lab report, collected 24 Sep 2026',
    meta: 'Northfield Clinical Laboratory · PDF, 3 pages · 28 Oct 2026',
    stage: 2,
    note: '2 extracted values are waiting for your confirmation.',
  },
  {
    title: 'Smart scale export, Jan 2019 to Oct 2026',
    meta: 'VeSync · CSV · 27 Oct 2026',
    stage: 3,
    note: SCALE_N + ' readings confirmed. No reading between Jun and Nov 2022.',
  },
  {
    title: 'Patient portal export',
    meta: 'MyChart, Cedar Row Family Practice · XML archive · 20 Oct 2026',
    stage: 3,
    note: '3 duplicate lab reports set aside, originals kept.',
  },
  {
    title: 'Apple Health export',
    meta: 'Apple Health · ZIP · 20 Oct 2026',
    stage: 1,
    note: 'Stored as uploaded. Not yet parsed.',
  },
  {
    title: 'Scanned reports, 2009 to 2012',
    meta: 'Harbor Family Medicine · 6 PDFs, scanned · 14 Oct 2026',
    stage: 2,
    note: 'Text read from scans. Values should be checked against the originals.',
  },
];
export const syntheticArchive: Archive = {
  patientName: 'Jordan Vale',
  start: START,
  today: TODAY,
  born: BORN,
  labs: LABS,
  whoBySource: WHO,
  draws: DRAWS,
  categories: CATS,
  markers: MARKERS,
  overviewMarkers: ['ldl', 'a1c', 'tsh', 'vitd', 'hgb'].map((k) => MARKERS.find((m) => m.key === k)!),
  events: EVENTS,
  medications: MEDS,
  diagnoses: DX,
  treatments: TREAT,
  documents: DOCUMENTS,
  documentsById: DOCUMENTS_BY_ID,
  lowConfidence: LOWCONF,
  weight: WEIGHT,
  clinicWeightCount: CLINICW.length,
  gaps: GAPS,
  scaleGap: ['2022-06-02', '2022-11-20'],
  scaleSpans: [
    ['2019-01-15', '2022-06-01'],
    ['2022-11-21', '2026-10-30'],
  ],
  recentImports: IMPORTS,
  sampleBatch: SAMPLE,
  knownLimits: [
    {
      title: 'No records of any kind',
      detail: 'July 2012 to February 2015. Nothing has been imported for this period.',
    },
    { title: 'Weight before 2019', detail: 'Only ' + CLINICW.length + ' measurements, all taken at clinic visits.' },
    { title: 'No smart scale readings', detail: 'June to November 2022.' },
    { title: 'Vitamin D', detail: 'First measured in August 2016. Not tested at every draw.' },
    { title: 'Apple Health export', detail: 'Uploaded but not yet parsed. Its contents are not shown anywhere yet.' },
  ],
};
