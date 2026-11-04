/** Finds where a stored source line sits on a drawn page, using the PDF's own text. Positions are fractions of the page. */

export interface PageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TextLine extends PageBox {
  text: string;
  pieces?: { text: string; left: number; width: number }[];
}

export interface RowBox extends PageBox {
  /** Where the value starts on the page, when it can be found in the row's text. */
  valueLeft: number | null;
}

const CELLS_MAY_SPAN = 3; // Other lines allowed between two cells of one row.

const squash = (text: string) => text.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** Lines that hold every word, whatever order the columns came out in. */
const holdsWords = (line: string, words: string[]) => words.every((word) => line.includes(word));

function spans(lines: string[], parts: string[], fits: (line: string, part: string) => boolean): [number, number][] {
  const found: [number, number][] = [];
  lines.forEach((line, start) => {
    if (!fits(line, parts[0])) return;
    let at = start;
    for (const part of parts.slice(1)) {
      let next = at;
      while (next <= at + CELLS_MAY_SPAN && !(next < lines.length && fits(lines[next], part))) next += 1;
      if (next > at + CELLS_MAY_SPAN) return;
      at = next;
    }
    found.push([start, at]);
  });
  return found;
}

function findValueLeft(lines: TextLine[], value: string): number | null {
  const wanted = squash(value);
  if (!wanted) return null;
  for (const line of lines) {
    for (const piece of line.pieces ?? []) {
      for (const word of piece.text.matchAll(/\S+/g)) {
        // A flag can be printed joined to its value, as in 6.2H.
        if (squash(word[0]) === wanted || squash(word[0]).replace(/[*a-z]+$/, '') === wanted) {
          // shortcut: inside a piece, position is estimated from its character count, upgrade if rows drift visibly.
          return piece.left + piece.width * (word.index / piece.text.length);
        }
      }
    }
  }
  return null;
}

/** The box around one row, or null if it is not there or could be more than one place. A wrong row is worse than none. */
export function locateRow(lines: TextLine[], source: string, value = ''): RowBox | null {
  const parts = source.split(' | ').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const texts = lines.map((line) => squash(line.text));
  const squashed = parts.map(squash);
  let found = spans(texts, squashed, (line, part) => line.includes(part));
  if (found.length > 1) found = spans(texts, squashed, (line, part) => line === part);
  if (!found.length) {
    const words = new Map(parts.map((part) => [squash(part), part.split(/\s+/).map(squash)]));
    found = spans(texts, squashed, (line, part) => holdsWords(line, words.get(part)!));
  }
  if (found.length !== 1) return null;
  const covered = lines.slice(found[0][0], found[0][1] + 1);
  return {
    left: Math.min(...covered.map((line) => line.left)),
    top: Math.min(...covered.map((line) => line.top)),
    right: Math.max(...covered.map((line) => line.right)),
    bottom: Math.max(...covered.map((line) => line.bottom)),
    valueLeft: findValueLeft(covered, value),
  };
}

export interface TextPiece {
  text: string;
  x: number;
  baseline: number;
  width: number;
  height: number;
}

/** Puts a page's text pieces back into printed lines, top to bottom and left to right. */
export function toTextLines(pieces: TextPiece[], pageWidth: number, pageHeight: number): TextLine[] {
  const rows: TextPiece[][] = [];
  for (const piece of [...pieces].sort((a, b) => a.baseline - b.baseline)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].baseline - piece.baseline) < row[0].height * 0.4) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map((row) => {
    const inOrder = row.sort((a, b) => a.x - b.x);
    const height = Math.max(...row.map((piece) => piece.height));
    const baseline = row[0].baseline;
    return {
      text: inOrder.map((piece) => piece.text).join(' '),
      pieces: inOrder.map((piece) => ({ text: piece.text, left: piece.x / pageWidth, width: piece.width / pageWidth })),
      left: Math.min(...row.map((piece) => piece.x)) / pageWidth,
      right: Math.max(...row.map((piece) => piece.x + piece.width)) / pageWidth,
      top: (baseline - height * 0.85) / pageHeight,
      bottom: (baseline + height * 0.25) / pageHeight,
    };
  });
}
