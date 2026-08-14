import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const DOS_EPOCH_DATE = 0x0021;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }

  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff];
  }

  return (value ^ 0xffffffff) >>> 0;
}

function validateEntry(entry, seenNames) {
  if (!entry || typeof entry.name !== 'string' || !Buffer.isBuffer(entry.data)) {
    throw new TypeError('ZIP entries require a string name and Buffer data');
  }

  if (
    entry.name.length === 0 ||
    entry.name.startsWith('/') ||
    entry.name.includes('\\') ||
    entry.name.split('/').includes('..')
  ) {
    throw new Error(`Unsafe ZIP entry name: ${entry.name}`);
  }

  if (seenNames.has(entry.name)) {
    throw new Error(`Duplicate ZIP entry name: ${entry.name}`);
  }

  const nameLength = Buffer.byteLength(entry.name, 'utf8');

  if (nameLength > MAX_UINT16 || entry.data.length > MAX_UINT32) {
    throw new Error(`ZIP entry exceeds classic ZIP limits: ${entry.name}`);
  }

  seenNames.add(entry.name);
}

async function listFiles(directory) {
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
    const entryPath = join(directory, entry);
    const entryStats = await stat(entryPath);

    if (entryStats.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entryStats.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Create a deterministic, uncompressed classic ZIP archive from validated file entries. */
export function createZipArchive(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_UINT16) {
    throw new Error('A classic ZIP archive requires between 1 and 65,535 entries');
  }

  const seenNames = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    validateEntry(entry, seenNames);
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_EPOCH_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_HEADER_SIGNATURE, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_EPOCH_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.data.length;

    if (localOffset > MAX_UINT32) {
      throw new Error('ZIP archive exceeds classic ZIP offset limits');
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

/** Write a deterministic ZIP whose root contains the files from the supplied directory. */
export async function writeDirectoryZip(sourceDirectory, outputPath) {
  const filePaths = await listFiles(sourceDirectory);
  const entries = await Promise.all(
    filePaths.map(async (filePath) => ({
      data: await readFile(filePath),
      name: relative(sourceDirectory, filePath).replaceAll('\\', '/'),
    })),
  );
  const archive = createZipArchive(entries);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive);
  return { entryNames: entries.map((entry) => entry.name), size: archive.length };
}
