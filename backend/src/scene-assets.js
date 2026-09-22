'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const sharp = require('sharp');

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_STORED_BYTES = 30 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 250 * 1024 * 1024;
const MAX_ASSETS = 100;
const MAX_PIXELS = 16 * 1024 * 1024;
const IMAGE_ID = /^img-[a-f0-9]{48}$/;
const BACKGROUND_ID = /^[a-z][a-z0-9-]{0,63}$/;
const WEBP_QUALITIES = new Set([88, 94]);
// Exact sanitized upload identities; labels cannot grant motion capability.
const REVIEW_BUNDLES = Object.freeze({
  '91f1a000a349c342677b471a04a55648a4c8c39749a8283a9901de17a6a1e1d2': 'wildlife-preserve-v2',
  'fbb5858ca3511c00a37c717a6cd879d1bb2a56a9ba5f4aabe19e9d063ba58708': 'orbital-observatory-v2',
  '8ff662743e16b7cdcd7446fe410f50846b56c62eed5ed3f4fe0cc46824cdc2ff': 'submerged-city-v2',
});

function cleanLabel(value) {
  if (typeof value !== 'string') throw new Error('Image label is required');
  const label = value.trim();
  if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Invalid image label');
  return label;
}

function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > MAX_UPLOAD_BYTES || !bytes.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Invalid or oversized PNG');
  }
  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;
  let width;
  let height;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG chunk');
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Invalid PNG header');
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > 4096 || height > 4096 || width * height > MAX_PIXELS) throw new Error('PNG dimensions exceed limit');
      sawHeader = true;
    } else if (type === 'IHDR' || type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new Error('Unsupported PNG structure');
    }
    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) throw new Error('Trailing PNG data');
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error('Incomplete PNG');
  return { width, height };
}

function sanitizePng(bytes) {
  const dimensions = inspectPng(bytes);
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error('PNG dimensions changed');
  const body = PNG.sync.write(decoded, { colorType: 6, inputColorType: 6, bitDepth: 8 });
  if (body.length > MAX_STORED_BYTES) throw new Error('Stored PNG exceeds limit');
  return { body, ...dimensions };
}

class ImageLibrary {
  constructor(dataDirectory) {
    this.directory = path.join(dataDirectory, 'scene-management', 'images');
    this.blobs = path.join(this.directory, 'blobs');
    this.manifestFile = path.join(this.directory, 'manifest.json');
    fs.mkdirSync(this.blobs, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.manifestFile)) this._save({ schemaVersion: 1, images: [] });
    this._read();
  }

  _read() {
    const manifest = JSON.parse(fs.readFileSync(this.manifestFile, 'utf8'));
    if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.images)) throw new Error('Invalid image manifest');
    const ids = new Set();
    for (const image of manifest.images) {
      if (!IMAGE_ID.test(image.id) || ids.has(image.id) || !/^[a-f0-9]{64}$/.test(image.sha256)
        || image.id !== 'img-' + image.sha256.slice(0, 48) || !['available', 'archived'].includes(image.status)
        || !['image/png', 'image/webp'].includes(image.mediaType)
        || image.url !== '/assets/uploads/' + image.id + (image.mediaType === 'image/webp' ? '.webp' : '.png')
        || !Number.isSafeInteger(image.bytes) || image.bytes < 1 || image.bytes > MAX_STORED_BYTES
        || !Number.isInteger(image.width) || !Number.isInteger(image.height)
        || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096
        || image.width * image.height > MAX_PIXELS) throw new Error('Invalid image manifest');
      if (image.mediaType === 'image/webp' &&
          (!BACKGROUND_ID.test(image.optimizedFrom || '') && !IMAGE_ID.test(image.optimizedFrom || '') ||
           !WEBP_QUALITIES.has(image.quality))) throw new Error('Invalid optimized image manifest');
      if (image.bundleId !== undefined && !Object.values(REVIEW_BUNDLES).includes(image.bundleId)) throw new Error('Invalid image motion binding');
      cleanLabel(image.label);
      ids.add(image.id);
    }
    return manifest;
  }

  _save(manifest) {
    const temporary = this.manifestFile + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.manifestFile);
  }

  list() {
    return structuredClone(this._read().images);
  }

  catalog() {
    return Object.fromEntries(this.list().map((image) => [image.id, {
      id: image.id, mediaType: image.mediaType, width: image.width, height: image.height,
      bytes: image.bytes, url: image.url, status: image.status, label: image.label,
      ...(image.optimizedFrom ? { optimizedFrom: image.optimizedFrom } : {}),
      ...(image.bundleId || REVIEW_BUNDLES[image.sha256] ? { bundleId: image.bundleId || REVIEW_BUNDLES[image.sha256] } : {}),
    }]));
  }

  async optimizePng(bytes, { sourceId, label, bundleId = null, quality = 94 } = {}) {
    if ((!BACKGROUND_ID.test(sourceId || '') && !IMAGE_ID.test(sourceId || '')) ||
        (bundleId !== null && !Object.values(REVIEW_BUNDLES).includes(bundleId)) ||
        !WEBP_QUALITIES.has(quality)) throw new Error('Invalid image optimization request');
    const { body, width, height } = sanitizePng(bytes);
    const optimized = await sharp(body, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .webp({ quality, alphaQuality: 100, effort: 5, smartSubsample: true })
      .toBuffer();
    const metadata = await sharp(optimized, { limitInputPixels: MAX_PIXELS }).metadata();
    if (metadata.format !== 'webp' || metadata.width !== width || metadata.height !== height ||
        metadata.pages > 1 || optimized.length > MAX_STORED_BYTES) throw new Error('Optimized image validation failed');
    if (optimized.length >= bytes.length * 0.9) {
      return { unchanged: true, sourceBytes: bytes.length, optimizedBytes: optimized.length };
    }
    const sha256 = crypto.createHash('sha256').update(optimized).digest('hex');
    const id = 'img-' + sha256.slice(0, 48);
    const manifest = this._read();
    const existing = manifest.images.find((image) => image.id === id);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.mediaType !== 'image/webp' ||
          (bundleId && existing.bundleId !== bundleId)) throw new Error('Optimized image identity conflict');
      if (existing.status === 'archived') throw new Error('Optimized copy is archived; restore it in the image library');
      return { ...structuredClone(existing), duplicate: true, sourceBytes: bytes.length };
    }
    if (manifest.images.length >= MAX_ASSETS || manifest.images.reduce((sum, image) => sum + image.bytes, 0) + optimized.length > MAX_LIBRARY_BYTES) {
      throw new Error('Image library capacity reached');
    }
    const blob = path.join(this.blobs, sha256 + '.webp');
    fs.writeFileSync(blob, optimized, { flag: 'wx', mode: 0o600 });
    const image = {
      id, label: cleanLabel((label || sourceId).slice(0, 65) + ' · optimized'),
      mediaType: 'image/webp', width, height, bytes: optimized.length,
      sha256, status: 'available', createdAt: new Date().toISOString(),
      url: '/assets/uploads/' + id + '.webp', optimizedFrom: sourceId, quality,
      ...(bundleId ? { bundleId } : {}),
    };
    try {
      manifest.images.push(image);
      this._save(manifest);
    } catch (error) {
      fs.unlinkSync(blob);
      throw error;
    }
    return { ...structuredClone(image), sourceBytes: bytes.length };
  }

  upload(bytes, label) {
    label = cleanLabel(label);
    const { body, width, height } = sanitizePng(bytes);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const id = 'img-' + sha256.slice(0, 48);
    const manifest = this._read();
    const existing = manifest.images.find((image) => image.id === id);
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error('Image ID collision');
      return { ...structuredClone(existing), duplicate: true };
    }
    if (manifest.images.length >= MAX_ASSETS || manifest.images.reduce((sum, image) => sum + image.bytes, 0) + body.length > MAX_LIBRARY_BYTES) {
      throw new Error('Image library capacity reached');
    }
    const blob = path.join(this.blobs, sha256 + '.png');
    fs.writeFileSync(blob, body, { flag: 'wx', mode: 0o600 });
    const image = {
      id, label, mediaType: 'image/png', width, height, bytes: body.length,
      sha256, status: 'available', createdAt: new Date().toISOString(),
      url: '/assets/uploads/' + id + '.png',
    };
    try {
      manifest.images.push(image);
      this._save(manifest);
    } catch (error) {
      fs.unlinkSync(blob);
      throw error;
    }
    return structuredClone(image);
  }

  image(id) {
    if (!IMAGE_ID.test(id || '')) return null;
    return structuredClone(this._read().images.find((item) => item.id === id) || null);
  }

  body(id) {
    const image = this.image(id);
    if (!image) return null;
    const bytes = fs.readFileSync(path.join(this.blobs, image.sha256 + (image.mediaType === 'image/webp' ? '.webp' : '.png')));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('Stored image checksum mismatch');
    return bytes;
  }

  archive(id) {
    if (!IMAGE_ID.test(id || '')) throw new Error('Unknown image');
    const manifest = this._read();
    const image = manifest.images.find((item) => item.id === id);
    if (!image) throw new Error('Unknown image');
    image.status = 'archived';
    this._save(manifest);
    return structuredClone(image);
  }

  restore(id) {
    if (!IMAGE_ID.test(id || '')) throw new Error('Unknown image');
    const manifest = this._read();
    const image = manifest.images.find((item) => item.id === id);
    if (!image) throw new Error('Unknown image');
    image.status = 'available';
    this._save(manifest);
    return structuredClone(image);
  }

  purge(id, referencedIds, backupConfirmed = false) {
    if (!IMAGE_ID.test(id || '') || !(referencedIds instanceof Set)) throw new Error('Invalid purge request');
    const manifest = this._read();
    const index = manifest.images.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Unknown image');
    const image = manifest.images[index];
    if (image.status !== 'archived' || referencedIds.has(id) || backupConfirmed !== true) throw new Error('Image is not safe to purge');
    manifest.images.splice(index, 1);
    this._save(manifest);
    fs.unlinkSync(path.join(this.blobs, image.sha256 + (image.mediaType === 'image/webp' ? '.webp' : '.png')));
  }
}

module.exports = { ImageLibrary, REVIEW_BUNDLES, inspectPng, sanitizePng };
