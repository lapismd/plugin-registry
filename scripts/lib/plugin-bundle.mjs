export const pluginBundleReleaseManifestPath = "release.signed.json";

export function parsePluginBundle(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);

  if (
    bytes.readUInt16LE(eocdOffset + 4) !== 0 ||
    bytes.readUInt16LE(eocdOffset + 6) !== 0 ||
    bytes.readUInt16LE(eocdOffset + 8) !== totalEntries
  ) {
    throw new Error("Multi-disk .lapis-plugin bundles are not supported.");
  }
  if (
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 .lapis-plugin bundles are not supported.");
  }
  assertRange(
    centralDirectoryOffset,
    centralDirectorySize,
    bytes.byteLength,
    "central directory",
  );

  const entries = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assertSignature(bytes, offset, 0x02014b50, "central directory entry");
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const crc32 = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    assertRange(nameStart, nameLength, bytes.byteLength, "entry name");
    const entryPath = bytes
      .subarray(nameStart, nameStart + nameLength)
      .toString("utf8");

    assertBundlePath(entryPath);
    if (entries.has(entryPath)) {
      throw new Error(`Duplicate file in .lapis-plugin bundle: ${entryPath}`);
    }
    if ((flags & 0x1) !== 0 || (flags & 0x8) !== 0) {
      throw new Error(
        `Unsupported ZIP flags for plugin bundle file: ${entryPath}`,
      );
    }
    if (compressionMethod !== 0) {
      throw new Error(
        `Plugin bundle file must use stored ZIP entries: ${entryPath}`,
      );
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error(
        `Plugin bundle file size metadata is invalid: ${entryPath}`,
      );
    }

    const data = readLocalEntry({
      bytes,
      entryPath,
      localHeaderOffset,
      size: uncompressedSize,
    });
    if (crc32For(data) !== crc32) {
      throw new Error(`Plugin bundle file CRC-32 mismatch: ${entryPath}`);
    }
    entries.set(entryPath, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error(".lapis-plugin central directory size is invalid.");
  }
  if (!entries.has(pluginBundleReleaseManifestPath)) {
    throw new Error(".lapis-plugin bundle is missing release.signed.json.");
  }
  return entries;
}

function readLocalEntry({ bytes, entryPath, localHeaderOffset, size }) {
  assertSignature(bytes, localHeaderOffset, 0x04034b50, "local file header");
  const flags = bytes.readUInt16LE(localHeaderOffset + 6);
  const compressionMethod = bytes.readUInt16LE(localHeaderOffset + 8);
  const compressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
  const nameLength = bytes.readUInt16LE(localHeaderOffset + 26);
  const extraLength = bytes.readUInt16LE(localHeaderOffset + 28);
  const nameStart = localHeaderOffset + 30;
  assertRange(nameStart, nameLength, bytes.byteLength, "local entry name");
  const localPath = bytes
    .subarray(nameStart, nameStart + nameLength)
    .toString("utf8");
  if (localPath !== entryPath || flags !== 0 || compressionMethod !== 0) {
    throw new Error(`Plugin bundle local header mismatch: ${entryPath}`);
  }
  if (compressedSize !== size) {
    throw new Error(`Plugin bundle local size mismatch: ${entryPath}`);
  }
  const dataStart = nameStart + nameLength + extraLength;
  assertRange(dataStart, size, bytes.byteLength, "local entry data");
  return bytes.subarray(dataStart, dataStart + size);
}

function findEndOfCentralDirectory(bytes) {
  const minimumSize = 22;
  const minOffset = Math.max(0, bytes.byteLength - 0xffff - minimumSize);
  for (
    let offset = bytes.byteLength - minimumSize;
    offset >= minOffset;
    offset -= 1
  ) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) {
      continue;
    }
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + minimumSize + commentLength === bytes.byteLength) {
      return offset;
    }
  }
  throw new Error(".lapis-plugin bundle is not a ZIP-compatible archive.");
}

function assertBundlePath(entryPath) {
  if (entryPath.endsWith("/")) {
    throw new Error(
      `Plugin bundle directories are not supported: ${entryPath}`,
    );
  }
  if (entryPath === pluginBundleReleaseManifestPath) {
    return;
  }
  assertSafePluginRelativePath(entryPath);
}

export function assertSafePluginRelativePath(relativePath) {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe plugin file path: ${relativePath}`);
  }
}

function assertSignature(bytes, offset, expected, label) {
  assertRange(offset, 4, bytes.byteLength, label);
  if (bytes.readUInt32LE(offset) !== expected) {
    throw new Error(`Invalid .lapis-plugin ${label}.`);
  }
}

function assertRange(offset, length, totalLength, label) {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > totalLength
  ) {
    throw new Error(`Invalid .lapis-plugin ${label} range.`);
  }
}

function crc32For(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
