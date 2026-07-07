// src/lib/fat8.ts

export const CLUSTER_SIZE = 256;
export const TOTAL_CLUSTERS = 256;
export const DISK_SIZE = CLUSTER_SIZE * TOTAL_CLUSTERS;

export const BOOT_SECTOR_CLUSTER = 0;
export const FAT_CLUSTER = 1;
export const ROOT_DIR_CLUSTER_START = 2;
export const ROOT_DIR_CLUSTER_COUNT = 4;
export const DATA_CLUSTER_START = BOOT_SECTOR_CLUSTER + 1 + ROOT_DIR_CLUSTER_COUNT + 1; // 6
export const DIR_ENTRY_SIZE = 32;

// FAT Marks
export const FAT_FREE = 0x00;
export const FAT_EOF = 0xFF;
export const FAT_BAD = 0xFE;

export interface DirEntry {
  index: number;
  name: string;
  ext: string;
  attributes: number;
  firstCluster: number;
  fileSize: number;
  fileSize: number;
  isEmpty: boolean;
  isDir: boolean;
}

export const ATTR_DIRECTORY = 0x10;

export class VirtualDisk {
  buffer: ArrayBuffer;
  view: DataView;
  bytes: Uint8Array;

  constructor(size = DISK_SIZE) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  readSector(cluster: number): Uint8Array {
    const offset = cluster * CLUSTER_SIZE;
    return this.bytes.slice(offset, offset + CLUSTER_SIZE);
  }

  writeSector(cluster: number, data: Uint8Array) {
    const offset = cluster * CLUSTER_SIZE;
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
    // Initialize FAT table
    const fatView = new Uint8Array(this.disk.buffer, FAT_CLUSTER * CLUSTER_SIZE, CLUSTER_SIZE);
    fatView.fill(FAT_FREE);
    // Reserve system clusters
    fatView[0] = FAT_EOF; // Boot
    fatView[1] = FAT_EOF; // FAT
    fatView[2] = FAT_EOF; // Root dir
    fatView[3] = FAT_EOF;
    fatView[4] = FAT_EOF;
    fatView[5] = FAT_EOF;

    this.notify();
  }

  getFAT(): Uint8Array {
    return new Uint8Array(this.disk.buffer, FAT_CLUSTER * CLUSTER_SIZE, CLUSTER_SIZE);
  }

  setFAT(cluster: number, value: number) {
    const fat = new Uint8Array(this.disk.buffer, FAT_CLUSTER * CLUSTER_SIZE, CLUSTER_SIZE);
    fat[cluster] = value;
  }

  findFreeCluster(): number {
    const fat = this.getFAT();
    for (let i = 6; i < TOTAL_CLUSTERS; i++) {
      if (fat[i] === FAT_FREE) return i;
    }
    return -1;
  }

  parseDirEntry(offset: number, index: number): DirEntry {
    const nameBytes = new Uint8Array(this.disk.buffer, offset, 8);
    const extBytes = new Uint8Array(this.disk.buffer, offset + 8, 3);
    const attributes = this.disk.view.getUint8(offset + 11);

    if (nameBytes[0] === 0x00 || nameBytes[0] === 0xE5) {
      return { index, name: "", ext: "", attributes: 0, firstCluster: 0, fileSize: 0, isEmpty: true };
    }

    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim();
    const ext = new TextDecoder().decode(extBytes).replace(/\0/g, '').trim();
    const firstCluster = this.disk.view.getUint8(offset + 26);
    const fileSize = this.disk.view.getUint32(offset + 28, true);
    const isDir = (attributes & ATTR_DIRECTORY) !== 0;

    return { index, name, ext, attributes, firstCluster, fileSize, isEmpty: false, isDir };
  }

  writeDirEntry(dirCluster: number, index: number, name: string, ext: string, attributes: number, firstCluster: number, fileSize: number) {
    let offset = 0;
    if (dirCluster === 0) {
      offset = ROOT_DIR_CLUSTER_START * CLUSTER_SIZE + (index * DIR_ENTRY_SIZE);
    } else {
      // For simplicity, we assume subdirectory is only 1 cluster long (8 entries max).
      offset = dirCluster * CLUSTER_SIZE + (index * DIR_ENTRY_SIZE);
    }

    new Uint8Array(this.disk.buffer, offset, DIR_ENTRY_SIZE).fill(0);

    const encoder = new TextEncoder();
    const nameBuf = encoder.encode(name.padEnd(8, ' ').substring(0, 8));
    const extBuf = encoder.encode(ext.padEnd(3, ' ').substring(0, 3));

    this.disk.bytes.set(nameBuf, offset);
    this.disk.bytes.set(extBuf, offset + 8);
    this.disk.view.setUint8(offset + 11, attributes);
    this.disk.view.setUint8(offset + 26, firstCluster);
    this.disk.view.setUint32(offset + 28, fileSize, true);
  }

  deleteDirEntry(dirCluster: number, index: number) {
    let offset = 0;
    if (dirCluster === 0) {
      offset = ROOT_DIR_CLUSTER_START * CLUSTER_SIZE + (index * DIR_ENTRY_SIZE);
    } else {
      offset = dirCluster * CLUSTER_SIZE + (index * DIR_ENTRY_SIZE);
    }
    this.disk.view.setUint8(offset, 0xE5); // 0xE5 means deleted
  }

  notify() {
    if (this.onChange) this.onChange();
  }

  listDir(dirCluster: number): DirEntry[] {
    const entries: DirEntry[] = [];
    let maxEntries = 0;
    let baseOffset = 0;

    if (dirCluster === 0) {
      maxEntries = (ROOT_DIR_CLUSTER_COUNT * CLUSTER_SIZE) / DIR_ENTRY_SIZE;
      baseOffset = ROOT_DIR_CLUSTER_START * CLUSTER_SIZE;
    } else {
      maxEntries = CLUSTER_SIZE / DIR_ENTRY_SIZE; // 8 entries for a 1-cluster subdir
      baseOffset = dirCluster * CLUSTER_SIZE;
    }

    for (let i = 0; i < maxEntries; i++) {
      const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
      if (!entry.isEmpty) {
        entries.push(entry);
      }
    }
    return entries;
  }

  createFile(filename: string, blocksCount: number, dirCluster: number = 0): boolean {
    const parts = filename.split('.');
    let name = parts[0];
    let ext = parts[1] || '';

    let maxEntries = 0;
    let baseOffset = 0;
    if (dirCluster === 0) {
      maxEntries = (ROOT_DIR_CLUSTER_COUNT * CLUSTER_SIZE) / DIR_ENTRY_SIZE;
      baseOffset = ROOT_DIR_CLUSTER_START * CLUSTER_SIZE;
    } else {
      maxEntries = CLUSTER_SIZE / DIR_ENTRY_SIZE;
      baseOffset = dirCluster * CLUSTER_SIZE;
    }

    let freeEntryIndex = -1;
    let existingEntries = this.listDir(dirCluster);
    for (const e of existingEntries) {
      if (e.name === name.substring(0, 8).trim() && e.ext === ext.substring(0, 3).trim()) {
        this.deleteFile(filename, dirCluster);
        break;
      }
    }

    for (let i = 0; i < maxEntries; i++) {
      const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
      if (entry.isEmpty) {
        freeEntryIndex = i;
        break;
      }
    }

    if (blocksCount === 0) {
      this.writeDirEntry(dirCluster, freeEntryIndex, name, ext, 0, 0, 0);
      this.notify();
      return true;
    }

    // Pre-check for free space to prevent partial allocation
    const currentFat = this.getFAT();
    let freeCount = 0;
    for (let i = 6; i < TOTAL_CLUSTERS; i++) {
      if (currentFat[i] === FAT_FREE) freeCount++;
    }

    if (blocksCount > freeCount) {
      throw new Error(`Not enough free space. Requested: ${blocksCount} blocks, Available: ${freeCount} blocks.`);
    }

    let firstCluster = this.findFreeCluster();
    if (firstCluster === -1) {
      throw new Error("Disk is full");
    }

    let currentCluster = firstCluster;
    let remainingBlocks = blocksCount;

    while (remainingBlocks > 0) {
      this.setFAT(currentCluster, FAT_EOF);

      const paddedChunk = new Uint8Array(CLUSTER_SIZE);
      paddedChunk.fill(0); // empty data
      this.disk.writeSector(currentCluster, paddedChunk);

      remainingBlocks--;

      if (remainingBlocks > 0) {
        const nextCluster = this.findFreeCluster();
        if (nextCluster === -1) {
          throw new Error("Disk full during write");
        }
        this.setFAT(currentCluster, nextCluster);
        currentCluster = nextCluster;
      }
    }

    this.writeDirEntry(dirCluster, freeEntryIndex, name, ext, 0, firstCluster, blocksCount * CLUSTER_SIZE);
    this.notify();
    return true;
  }

  createFolder(foldername: string, dirCluster: number = 0): boolean {
    let name = foldername.substring(0, 8).trim();
    let ext = "";

    let maxEntries = 0;
    let baseOffset = 0;
    if (dirCluster === 0) {
      maxEntries = (ROOT_DIR_CLUSTER_COUNT * CLUSTER_SIZE) / DIR_ENTRY_SIZE;
      baseOffset = ROOT_DIR_CLUSTER_START * CLUSTER_SIZE;
    } else {
      maxEntries = CLUSTER_SIZE / DIR_ENTRY_SIZE;
      baseOffset = dirCluster * CLUSTER_SIZE;
    }
    let freeEntryIndex = -1;

    let existingEntries = this.listDir(dirCluster);
    for (const e of existingEntries) {
      if (e.name === name && e.isDir) {
        throw new Error("Folder already exists");
      }
    }

    for (let i = 0; i < maxEntries; i++) {
      const entry = this.parseDirEntry(baseOffset + i * DIR_ENTRY_SIZE, i);
      if (entry.isEmpty) {
        freeEntryIndex = i;
        break;
      }
    }

    if (freeEntryIndex === -1) {
      throw new Error("Directory is full");
    }

    const cluster = this.findFreeCluster();
    if (cluster === -1) {
      throw new Error("Disk is full");
    }

    this.setFAT(cluster, FAT_EOF);
    this.disk.writeSector(cluster, new Uint8Array(CLUSTER_SIZE)); // Empty dir table
    this.writeDirEntry(dirCluster, freeEntryIndex, name, ext, ATTR_DIRECTORY, cluster, 0);
    this.notify();
    return true;
  }

  deleteFile(filename: string, dirCluster: number = 0): boolean {
    const parts = filename.split('.');
    let name = parts[0];
    let ext = parts[1] || '';

    const entries = this.listDir(dirCluster);
    const entry = entries.find(e => e.name === name.substring(0, 8).trim() && e.ext === ext.substring(0, 3).trim());

    if (!entry) return false;

    let currentCluster = entry.firstCluster;
    const fat = this.getFAT();

    while (currentCluster !== 0 && currentCluster !== FAT_EOF && currentCluster >= 6 && currentCluster <= 255) {
      const nextCluster = fat[currentCluster];
      this.setFAT(currentCluster, FAT_FREE);
      currentCluster = nextCluster;
    }

    this.deleteDirEntry(dirCluster, entry.index);
    this.notify();
    return true;
  }
}
