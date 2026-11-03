// A dropped folder arrives as one entry per top-level item. Its contents have to be walked, and each file's
// place in the folder recorded, since a dropped File does not carry its relative path.
const droppedPaths = new WeakMap<File, string>();
export const droppedPath = (file: File) => droppedPaths.get(file);

const readBatch = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const readFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

export async function walkEntry(entry: FileSystemEntry, parent: string, out: File[]): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    droppedPaths.set(file, path);
    out.push(file);
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // A reader hands over at most 100 entries per call, and an empty answer means the end.
  for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
    for (const child of batch) await walkEntry(child, path, out);
  }
}

export async function collectDropped(data: DataTransfer | null): Promise<File[]> {
  if (!data) return [];
  const entries = Array.from(data.items ?? []).map((item) => item.webkitGetAsEntry?.() ?? null);
  if (!entries.some(Boolean)) return Array.from(data.files ?? []);
  const out: File[] = [];
  for (const entry of entries) if (entry) await walkEntry(entry, '', out);
  return out;
}
