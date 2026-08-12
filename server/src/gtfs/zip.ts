import type { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export interface ZipArchive {
  /** Entry names in central-directory order. */
  readonly entries: readonly string[];
  has(name: string): boolean;
  /** Uncompressed size in bytes, or undefined if the entry is absent. */
  sizeOf(name: string): number | undefined;
  openEntry(name: string): Promise<Readable>;
  close(): void;
}

/**
 * Opens the consolidated feed zip for streaming.
 *
 * The archive holds ~560 MB uncompressed (shapes.txt 277 MB, stop_times.txt
 * 268 MB), so entries are never buffered: the importer pipes each one straight
 * into the CSV parser.
 */
export async function openZip(path: string): Promise<ZipArchive> {
  const zipFile = await openZipFile(path);
  const entries = await readCentralDirectory(zipFile);

  return {
    entries: [...entries.keys()],
    has: (name) => entries.has(name),
    sizeOf: (name) => entries.get(name)?.uncompressedSize,
    // async so a missing entry rejects rather than throwing synchronously —
    // callers await this and would otherwise need two error paths.
    openEntry: async (name) => {
      const entry = entries.get(name);
      if (!entry) throw new Error(`zip entry not found: ${name}`);
      return openEntryStream(zipFile, entry);
    },
    close: () => zipFile.close(),
  };
}

function openZipFile(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // lazyEntries + autoClose:false keeps the handle usable for repeated reads.
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error(`cannot open zip: ${path}`));
      else resolve(zipFile);
    });
  });
}

function readCentralDirectory(zipFile: ZipFile): Promise<Map<string, Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    zipFile.on("entry", (entry: Entry) => {
      if (!entry.fileName.endsWith("/")) entries.set(entry.fileName, entry);
      zipFile.readEntry();
    });
    zipFile.on("end", () => resolve(entries));
    zipFile.on("error", reject);
    zipFile.readEntry();
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`cannot read zip entry: ${entry.fileName}`));
      else resolve(stream);
    });
  });
}
