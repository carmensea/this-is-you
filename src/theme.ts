// Design tokens from the prototype. Colors and fonts are not to be restyled.
export const C = {
  paper: '#F6F3EC',
  sunk: '#E6E1D6',
  ink: '#1F1E1B',
  ink2: '#4F4C45',
  ink3: '#6E6A61',
  rule: '#D8D2C5',
  rule2: '#E3DED3',
  green: '#3D6A52',
  greenT: '#E1E8DA',
  rust: '#8A3F1F',
  hatch: '#CFC8BA',
  muted: '#55524B',
  amber: '#8A5A1F',
  faint: '#B9B2A4',
  banner: '#EBE6DB',
  field: '#FBFAF6',
  hover: '#EFEBE2',
  selected: '#EDE9DF',
} as const;
export const SERIF = "'Newsreader', Georgia, serif";
export const SANS = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', ui-monospace, monospace";

/** The diagonal hatch that marks "no records". An SVG tile rather than a CSS gradient. */
export const HATCH_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Cpath d='M-1 1L1 -1M0 6L6 0M5 7L7 5' stroke='%23CFC8BA' stroke-width='1'/%3E%3C/svg%3E")`;
