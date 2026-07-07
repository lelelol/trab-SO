// src/lib/fat8.ts

export const CLUSTER_SIZE = 256;
export const TOTAL_CLUSTERS = 256;
export const DISK_SIZE = CLUSTER_SIZE * TOTAL_CLUSTERS;

export const BOOT_SECTOR_CLUSTER = 0;
export const FAT_CLUSTER = 1;
export const ROOT_DIR_CLUSTER_START = 2;
export const ROOT_DIR_CLUSTER_COUNT = 4;
export const DATA_CLUSTER_START = ROOT_DIR_CLUSTER_START + ROOT_DIR_CLUSTER_COUNT; // 6
export const DIR_ENTRY_SIZE = 32;

// FAT Marks
export const FAT_FREE = 0x00;
export const FAT_EOF = 0xff;
export const FAT_BAD = 0xfe;

export const ATTR_DIRECTORY = 0x10;

export interface DirEntry {
  index: number;
  name: string;
  ext: string;
  attributes: number;
  firstCluster: number;
  fileSize: number;
  isEmpty: boolean;
  isDir: boolean;
}

interface ParsedFilename83 {
  name: string;
  ext: string;
}

function isValidCluster(cluster: number): boolean {
  return Number.isInteger(cluster) && cluster >= 0 && cluster < TOTAL_CLUSTERS;
}

function isDataCluster(cluster: number): boolean {
  return cluster >= DATA_CLUSTER_START && cluster < TOTAL_CLUSTERS;
}

function normalize83Part(value: string, maxLength: number, label: string): string {
  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    if (label === "extension") return "";
    throw new Error("Filename cannot be empty.");
  }


  if (normalized.length > maxLength) {
    throw new Error(`Invalid ${label}. FAT8 supports 8.3 names.`);
  }

  // Keep this simulator simple and predictable: no path separators,
  // wildcards, spaces inside the stored 8.3 token, or FAT-reserved symbols.
  if (!/^[A-Z0-9_$~!#%&'()\-@^`{}]+$/.test(normalized)) {
    throw new Error(`Invalid ${label}. Use only FAT8-compatible 8.3 characters.`);
  }

  return normalized;
}

function parseFilename83(filename: string): ParsedFilename83 {
  const clean = filename.trim();

  if (!clean) {
    throw new Error("Filename cannot be empty.");
  }

  if (clean.includes("/") || clean.includes("\\")) {
    throw new Error("Invalid filename. Path separators are not allowed.");
  }

  const parts = clean.split(".");

  if (parts.length > 2) {
    throw new Error("Invalid filename. FAT8 supports only 8.3 format.");
  }

  const name = normalize83Part(parts[0] ?? "", 8, "name");
  const ext = parts.length === 2 ? normalize83Part(parts[1] ?? "", 3, "extension") : "";

  return { name, ext };
}

function parseFolderName83(foldername: string): string {
  const clean = foldername.trim();

  if (!clean) {
    throw new Error("Folder name cannot be empty.");
  }

  if (clean.includes(".") || clean.includes("/") || clean.includes("\\")) {
    throw new Error("Invalid folder name. Use only a single 8-character 8.3 name without extension.");
  }

  return normalize83Part(clean, 8, "name");
}

function entryFullName(entry: DirEntry): string {
  return entry.ext ? `${entry.name}.${entry.ext}` : entry.name;
}

export class VirtualDisk {
  buffer: ArrayBuffer;
  view: DataView;
  bytes: Uint8Array;

  constructor(size = DISK_SIZE) {
    if (!Number.isInteger(size) || size < DISK_SIZE) {
      throw new Error(`Invalid disk size. Minimum size is ${DISK_SIZE} bytes.`);
    }

    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  private validateCluster(cluster: number) {
    if (!isValidCluster(cluster)) {
      throw new Error("Invalid cluster.");
    }
  }

  readSector(cluster: number): Uint8Array {
    this.validateCluster(cluster);

    const offset = cluster * CLUSTER_SIZE;
    return this.bytes.slice(offset, offset + CLUSTER_SIZE);
  }

  writeSector(cluster: number, data: Uint8Array) {
    this.validateCluster(cluster);

    const offset = cluster * CLUSTER_SIZE;

    // Always clear the full cluster before writing so shorter buffers do not
    // leave stale bytes behind.
    this.bytes.fill(0, offset, offset + CLUSTER_SIZE);
    this.bytes.set(data.subarray(0, CLUSTER_SIZE), offset);
  }
}

export class FileSystemAPI {
  disk: VirtualDisk;
  onChange?: () => void;

  constructor(disk: VirtualDisk) {
    this.disk = disk;
  }

  format() {
    this.disk.bytes.fill(0);

    const fatView = this.getFAT();
    fatView.fill(FAT_FREE);

    // Reserve system clusters:
    // 0 = boot sector, 1 = FAT, 2..5 = root directory.
    for (let cluster = BOOT_SECTOR_CLUSTER; cluster < DATA_CLUSTER_START; cluster++) {
      fatView[cluster] = FAT_EOF;
    }

    this.notify();
  }

  getFAT(): Uint8Array {
    return new Uint8Array(this.disk.buffer, FAT_CLUSTER * CLUSTER_SIZE, CLUSTER_SIZE);
  }

  setFAT(cluster: number, value: number) {
    this.validateCluster(cluster);

    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error("Invalid FAT value.");
    }

    const fat = this.getFAT();
    fat[cluster] = value;
  }

  findFreeCluster(): number {
    const fat = this.getFAT();

    for (let i = DATA_CLUSTER_START; i < TOTAL_CLUSTERS; i++) {
      if (fat[i] === FAT_FREE) return i;
    }

    return -1;
  }

  parseDirEntry(offset: number, index: number): DirEntry {
    if (!Number.isInteger(offset) || offset < 0 || offset + DIR_ENTRY_SIZE > this.disk.bytes.length) {
      throw new Error("Invalid directory entry offset.");
    }

    const nameBytes = new Uint8Array(this.disk.buffer, offset, 8);
    const extBytes = new Uint8Array(this.disk.buffer, offset + 8, 3);
    const attributes = this.disk.view.getUint8(offset + 11);

    if (nameBytes[0] === 0x00 || nameBytes[0] === 0xe5) {
      return {
        index,
        name: "",
        ext: "",
        attributes: 0,
        firstCluster: 0,
        fileSize: 0,
        isEmpty: true,
        isDir: false,
      };
    }

    const decoder = new TextDecoder();
    const name = decoder.decode(nameBytes).replace(/\0/g, "").trim().toUpperCase();
    const ext = decoder.decode(extBytes).replace(/\0/g, "").trim().toUpperCase();
    const firstCluster = this.disk.view.getUint8(offset + 26);
    const fileSize = this.disk.view.getUint32(offset + 28, true);
    const isDir = (attributes & ATTR_DIRECTORY) !== 0;

    return { index, name, ext, attributes, firstCluster, fileSize, isEmpty: false, isDir };
  }

  writeDirEntry(
    dirCluster: number,
    index: number,
    name: string,
    ext: string,
    attributes: number,
    firstCluster: number,
    fileSize: number,
  ) {
    const { maxEntries, baseOffset } = this.getDirectoryLayout(dirCluster);

    if (!Number.isInteger(index) || index < 0 || index >= maxEntries) {
      throw new Error("Invalid directory entry index.");
    }

    if (firstCluster !== 0 && !isDataCluster(firstCluster)) {
      throw new Error("Invalid first cluster for directory entry.");
    }

    const offset = baseOffset + index * DIR_ENTRY_SIZE;
    new Uint8Array(this.disk.buffer, offset, DIR_ENTRY_SIZE).fill(0);

    const encoder = new TextEncoder();
    const normalizedName = normalize83Part(name, 8, "name");
    const normalizedExt = ext ? normalize83Part(ext, 3, "extension") : "";
    const nameBuf = encoder.encode(normalizedName.padEnd(8, " "));
    const extBuf = encoder.encode(normalizedExt.padEnd(3, " "));

    this.disk.bytes.set(nameBuf, offset);
    this.disk.bytes.set(extBuf, offset + 8);
    this.disk.view.setUint8(offset + 11, attributes);
    this.disk.view.setUint8(offset + 26, firstCluster);
    this.disk.view.setUint32(offset + 28, fileSize, true);
  }

  deleteDirEntry(dirCluster: number, index: number) {
    const { maxEntries, baseOffset } = this.getDirectoryLayout(dirCluster);

    if (!Number.isInteger(index) || index < 0 || index >= maxEntries) {
      throw new Error("Invalid directory entry index.");
    }

    this.disk.view.setUint8(baseOffset + index * DIR_ENTRY_SIZE, 0xe5);
  }

  notify() {
    if (this.onChange) this.onChange();
  }

  listDir(dirCluster: number): DirEntry[] {
    const entries: DirEntry[] = [];
    const { maxEntries, baseOffset } = this.getDirectoryLayout(dirCluster);

    for (let i = 0; i < maxEntries; i++) {
      const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
      if (!entry.isEmpty) entries.push(entry);
    }

    return entries;
  }

  createFile(filename: string, blocksCount: number, dirCluster: number = 0): boolean {
    if (!Number.isInteger(blocksCount) || blocksCount < 0) {
      throw new Error("Invalid block count.");
    }

    const { name, ext } = parseFilename83(filename);
    const { maxEntries, baseOffset } = this.getDirectoryLayout(dirCluster);
    const existingEntries = this.listDir(dirCluster);
    const existingEntry = existingEntries.find((e) => e.name === name && e.ext === ext);

    // Reuse the existing entry index only after every validation succeeds.
    // This prevents losing the old file if the new allocation is impossible.
    let targetEntryIndex = existingEntry?.index ?? -1;

    if (targetEntryIndex === -1) {
      for (let i = 0; i < maxEntries; i++) {
        const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
        if (entry.isEmpty) {
          targetEntryIndex = i;
          break;
        }
      }
    }

    if (targetEntryIndex === -1) {
      throw new Error("Directory is full.");
    }

    if (blocksCount > this.countFreeClusters()) {
      throw new Error(
        `Not enough free space. Requested: ${blocksCount} blocks, Available: ${this.countFreeClusters()} blocks.`,
      );
    }

    // Only now is it safe to remove the old entry, because the destination
    // entry and free space have already been validated.
    if (existingEntry) {
      this.deleteEntryByDirEntry(existingEntry, dirCluster, false);
    }

    if (blocksCount === 0) {
      this.writeDirEntry(dirCluster, targetEntryIndex, name, ext, 0, 0, 0);
      this.notify();
      return true;
    }

    const firstCluster = this.allocateClusterChain(blocksCount);
    this.writeDirEntry(dirCluster, targetEntryIndex, name, ext, 0, firstCluster, blocksCount * CLUSTER_SIZE);
    this.notify();
    return true;
  }

  createFolder(foldername: string, dirCluster: number = 0): boolean {
    const name = parseFolderName83(foldername);
    const ext = "";
    const { maxEntries, baseOffset } = this.getDirectoryLayout(dirCluster);
    const existingEntries = this.listDir(dirCluster);

    if (existingEntries.some((e) => e.name === name && e.ext === ext)) {
      throw new Error("An entry with this name already exists.");
    }

    let freeEntryIndex = -1;
    for (let i = 0; i < maxEntries; i++) {
      const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
      if (entry.isEmpty) {
        freeEntryIndex = i;
        break;
      }
    }

    if (freeEntryIndex === -1) {
      throw new Error("Directory is full.");
    }

    const cluster = this.findFreeCluster();
    if (cluster === -1) {
      throw new Error("Disk is full.");
    }

    this.setFAT(cluster, FAT_EOF);
    this.disk.writeSector(cluster, new Uint8Array(CLUSTER_SIZE));

    this.writeDirEntry(dirCluster, freeEntryIndex, name, ext, ATTR_DIRECTORY, cluster, 0);
    this.notify();
    return true;
  }

  deleteFile(filename: string, dirCluster: number = 0): boolean {
    // Kept for compatibility with existing app calls. It deletes both files and
    // folders, so new code may prefer deleteEntry().
    return this.deleteEntry(filename, dirCluster);
  }

  deleteEntry(filename: string, dirCluster: number = 0): boolean {
    const parsed = filename.includes(".") ? parseFilename83(filename) : { name: parseFolderName83(filename), ext: "" };
    const entries = this.listDir(dirCluster);
    const entry = entries.find((e) => e.name === parsed.name && e.ext === parsed.ext);

    if (!entry) return false;

    return this.deleteEntryByDirEntry(entry, dirCluster, true);
  }

  private deleteEntryByDirEntry(entry: DirEntry, dirCluster: number, shouldNotify: boolean): boolean {
    if (entry.isDir && entry.firstCluster !== 0) {
      const childEntries = this.listDir(entry.firstCluster);

      for (const child of childEntries) {
        this.deleteEntryByDirEntry(child, entry.firstCluster, false);
      }
    }

    this.freeClusterChain(entry.firstCluster);
    this.deleteDirEntry(dirCluster, entry.index);

    if (shouldNotify) this.notify();
    return true;
  }

  private allocateClusterChain(blocksCount: number): number {
    let firstCluster = 0;
    let previousCluster = 0;

    for (let i = 0; i < blocksCount; i++) {
      const cluster = this.findFreeCluster();

      if (cluster === -1) {
        // This should not happen because createFile pre-checks space, but keep
        // rollback protection for consistency.
        this.freeClusterChain(firstCluster);
        throw new Error("Disk full during write.");
      }

      this.setFAT(cluster, FAT_EOF);
      this.disk.writeSector(cluster, new Uint8Array(CLUSTER_SIZE));

      if (previousCluster !== 0) {
        this.setFAT(previousCluster, cluster);
      } else {
        firstCluster = cluster;
      }

      previousCluster = cluster;
    }

    return firstCluster;
  }

  private freeClusterChain(firstCluster: number) {
    if (firstCluster === 0) return;

    if (!isDataCluster(firstCluster)) {
      throw new Error("Invalid first cluster in directory entry.");
    }

    const fat = this.getFAT();
    const visited = new Set<number>();
    let currentCluster = firstCluster;

    while (isDataCluster(currentCluster) && currentCluster !== FAT_EOF) {
      if (visited.has(currentCluster)) {
        throw new Error("Invalid FAT chain: cycle detected.");
      }

      visited.add(currentCluster);
      const nextCluster = fat[currentCluster];
      this.setFAT(currentCluster, FAT_FREE);
      this.disk.writeSector(currentCluster, new Uint8Array(CLUSTER_SIZE));

      if (nextCluster === FAT_EOF) break;
      if (nextCluster === FAT_FREE || nextCluster === FAT_BAD || !isDataCluster(nextCluster)) {
        break;
      }

      currentCluster = nextCluster;
    }
  }

  private countFreeClusters(): number {
    const fat = this.getFAT();
    let freeCount = 0;

    for (let i = DATA_CLUSTER_START; i < TOTAL_CLUSTERS; i++) {
      if (fat[i] === FAT_FREE) freeCount++;
    }

    return freeCount;
  }

  private getDirectoryLayout(dirCluster: number): { maxEntries: number; baseOffset: number } {
    if (dirCluster === 0) {
      return {
        maxEntries: (ROOT_DIR_CLUSTER_COUNT * CLUSTER_SIZE) / DIR_ENTRY_SIZE,
        baseOffset: ROOT_DIR_CLUSTER_START * CLUSTER_SIZE,
      };
    }

    if (!isDataCluster(dirCluster)) {
      throw new Error("Invalid directory cluster.");
    }

    // In this FAT8 simulator, subdirectories are intentionally 1 cluster long.
    // They contain 8 user-visible entries total.
    return {
      maxEntries: CLUSTER_SIZE / DIR_ENTRY_SIZE,
      baseOffset: dirCluster * CLUSTER_SIZE,
    };
  }

  private validateCluster(cluster: number) {
    if (!isValidCluster(cluster)) {
      throw new Error("Invalid cluster.");
    }
  }
}
