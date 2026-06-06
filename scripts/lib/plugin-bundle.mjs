import { Unzip, UnzipInflate } from "fflate";

export const pluginBundleReleaseManifestPath = "release.signed.json";
export const pluginBundleStoredMethod = 0;
export const pluginBundleDeflateMethod = 8;

export function parsePluginBundle(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const expectedEntries = inspectPluginBundleMetadata(bytes);
  const entries = new Map();
  let seenFileCount = 0;
  let firstError = null;

  const unzip = new Unzip((file) => {
    if (firstError) return;
    try {
      const expectedEntry = expectedEntries[seenFileCount];
      seenFileCount += 1;
      if (!expectedEntry) {
        throw new Error(
          `Unexpected file in .lapis-plugin bundle: ${file.name}`,
        );
      }
      if (
        file.name !== expectedEntry.path ||
        file.compression !== expectedEntry.compressionMethod
      ) {
        throw new Error(
          `Plugin bundle local entry order or method is invalid: ${file.name}`,
        );
      }
      assertBundlePath(file.name);
      if (entries.has(file.name)) {
        throw new Error(`Duplicate file in .lapis-plugin bundle: ${file.name}`);
      }
      if (!isSupportedCompressionMethod(file.compression)) {
        throw new Error(
          `Unsupported plugin bundle compression method ${file.compression}: ${file.name}`,
        );
      }

      const chunks = [];
      let byteLength = 0;
      file.ondata = (error, chunk, final) => {
        if (error) {
          firstError = new Error(
            `Unable to extract plugin bundle file: ${file.name}`,
            { cause: error },
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
        byteLength += chunk.byteLength;
        if (final) {
          entries.set(file.name, Buffer.concat(chunks, byteLength));
        }
      };
      file.start();
    } catch (error) {
      firstError = error;
    }
  });
  unzip.register(UnzipInflate);

  try {
    unzip.push(bytes, true);
  } catch (error) {
    firstError = error;
  }

  if (firstError) throw firstError;
  if (seenFileCount !== expectedEntries.length) {
    throw new Error(".lapis-plugin bundle entry count is invalid.");
  }
  for (const expectedEntry of expectedEntries) {
    if (!entries.has(expectedEntry.path)) {
      throw new Error(
        `.lapis-plugin bundle did not extract ${expectedEntry.path}.`,
      );
    }
  }
  if (!entries.has(pluginBundleReleaseManifestPath)) {
    throw new Error(".lapis-plugin bundle is missing release.signed.json.");
  }
  return entries;
}

function inspectPluginBundleMetadata(bytes) {
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

  const entries = [];
  const seenPaths = new Set();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assertSignature(bytes, offset, 0x02014b50, "central directory entry");
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
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
    if (seenPaths.has(entryPath)) {
      throw new Error(`Duplicate file in .lapis-plugin bundle: ${entryPath}`);
    }
    seenPaths.add(entryPath);
    if ((flags & 0x41) !== 0) {
      throw new Error(
        `Encrypted plugin bundle file is not supported: ${entryPath}`,
      );
    }
    if (!isSupportedCompressionMethod(compressionMethod)) {
      throw new Error(
        `Unsupported plugin bundle compression method ${compressionMethod}: ${entryPath}`,
      );
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error(
        `ZIP64 plugin bundle file metadata is not supported: ${entryPath}`,
      );
    }
    entries.push(
      inspectLocalEntry({
        bytes,
        entryPath,
        localHeaderOffset,
        compressionMethod,
        flags,
      }),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error(".lapis-plugin central directory size is invalid.");
  }

  const localOrder = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  const firstEntry = localOrder[0];
  if (firstEntry?.path !== pluginBundleReleaseManifestPath) {
    throw new Error(
      ".lapis-plugin bundle must store release.signed.json as the first entry.",
    );
  }
  if (firstEntry.compressionMethod !== pluginBundleStoredMethod) {
    throw new Error(".lapis-plugin release.signed.json entry must be stored.");
  }
  if (!seenPaths.has(pluginBundleReleaseManifestPath)) {
    throw new Error(".lapis-plugin bundle is missing release.signed.json.");
  }
  return localOrder;
}

function inspectLocalEntry({
  bytes,
  entryPath,
  localHeaderOffset,
  compressionMethod,
  flags,
}) {
  assertSignature(bytes, localHeaderOffset, 0x04034b50, "local file header");
  const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
  const localCompressionMethod = bytes.readUInt16LE(localHeaderOffset + 8);
  const nameLength = bytes.readUInt16LE(localHeaderOffset + 26);
  const extraLength = bytes.readUInt16LE(localHeaderOffset + 28);
  const nameStart = localHeaderOffset + 30;
  assertRange(nameStart, nameLength, bytes.byteLength, "local entry name");
  assertRange(
    nameStart + nameLength,
    extraLength,
    bytes.byteLength,
    "local entry extra",
  );
  const localPath = bytes
    .subarray(nameStart, nameStart + nameLength)
    .toString("utf8");
  if (
    localPath !== entryPath ||
    localFlags !== flags ||
    localCompressionMethod !== compressionMethod
  ) {
    throw new Error(`Plugin bundle local header mismatch: ${entryPath}`);
  }
  return { path: entryPath, compressionMethod, localHeaderOffset };
}

function isSupportedCompressionMethod(compressionMethod) {
  return (
    compressionMethod === pluginBundleStoredMethod ||
    compressionMethod === pluginBundleDeflateMethod
  );
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
