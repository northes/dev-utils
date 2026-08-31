export type ImageOutputFormat = 'jpg' | 'png' | 'webp' | 'svg' | 'ico';

export type ImageOutputFormatInfo = Readonly<{
  mime: string;
  extension: string;
}>;

export const IMAGE_OUTPUT_FORMATS: Readonly<Record<ImageOutputFormat, ImageOutputFormatInfo>> = {
  jpg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
  svg: { mime: 'image/svg+xml', extension: 'svg' },
  ico: { mime: 'image/x-icon', extension: 'ico' },
};

export const IMAGE_FORMAT_MAP = IMAGE_OUTPUT_FORMATS;

export type ImageOutputErrorCode =
  'unsupportedFormat' | 'encodingFailed' | 'invalidBlobType' | 'invalidCanvas' | 'readFailed';

export class ImageOutputError extends Error {
  constructor(
    readonly code: ImageOutputErrorCode,
    message = code,
  ) {
    super(message);
    this.name = 'ImageOutputError';
  }
}

type CanvasBlobFormat = Exclude<ImageOutputFormat, 'svg' | 'ico'>;

function isCanvasBlobFormat(format: ImageOutputFormat): format is CanvasBlobFormat {
  return format === 'jpg' || format === 'png' || format === 'webp';
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ImageOutputFormat,
  quality?: number,
): Promise<Blob> {
  if (!isCanvasBlobFormat(format)) {
    return Promise.reject(new ImageOutputError('unsupportedFormat'));
  }

  const { mime } = IMAGE_OUTPUT_FORMATS[format];

  return new Promise<Blob>((resolve, reject) => {
    const complete = (blob: Blob | null) => {
      if (!blob) {
        reject(new ImageOutputError('encodingFailed'));
        return;
      }
      if (blob.type.toLowerCase() !== mime) {
        reject(new ImageOutputError('invalidBlobType'));
        return;
      }
      resolve(blob);
    };

    if (format === 'png') {
      canvas.toBlob(complete, mime);
    } else {
      canvas.toBlob(complete, mime, quality);
    }
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new ImageOutputError('readFailed'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new ImageOutputError('readFailed'));
    reader.onabort = () => reject(new ImageOutputError('readFailed'));
    reader.readAsDataURL(blob);
  });
}

export const blobToDataURL = blobToDataUrl;

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

function icoSizesForCanvas(canvas: HTMLCanvasElement): number[] {
  const sourceSize = Math.min(canvas.width, canvas.height);
  if (!Number.isFinite(sourceSize) || sourceSize <= 0) {
    throw new ImageOutputError('invalidCanvas');
  }

  const sizes = ICO_SIZES.filter((size) => size <= sourceSize);
  if (sizes.length > 0) return [...sizes];
  return [Math.max(1, Math.floor(sourceSize))];
}

function resizeCanvasForIco(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageOutputError('invalidCanvas');

  const scale = Math.min(size / source.width, size / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

export async function canvasToIco(canvas: HTMLCanvasElement): Promise<Blob> {
  const sizes = icoSizesForCanvas(canvas);
  const images = await Promise.all(
    sizes.map(async (size) => {
      const iconCanvas = resizeCanvasForIco(canvas, size);
      const blob = await canvasToBlob(iconCanvas, 'png');
      return { size, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }),
  );

  const directorySize = 6 + images.length * 16;
  const imageSize = images.reduce((total, image) => total + image.bytes.length, 0);
  const output = new Uint8Array(directorySize + imageSize);
  const view = new DataView(output.buffer);

  // ICO 文件头和目录项均为小端序；PNG 数据本身保持原始字节不变。
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);

  let offset = directorySize;
  images.forEach((image, index) => {
    const entryOffset = 6 + index * 16;
    view.setUint8(entryOffset, image.size === 256 ? 0 : image.size);
    view.setUint8(entryOffset + 1, image.size === 256 ? 0 : image.size);
    view.setUint8(entryOffset + 2, 0);
    view.setUint8(entryOffset + 3, 0);
    view.setUint16(entryOffset + 4, 1, true);
    view.setUint16(entryOffset + 6, 32, true);
    view.setUint32(entryOffset + 8, image.bytes.length, true);
    view.setUint32(entryOffset + 12, offset, true);
    output.set(image.bytes, offset);
    offset += image.bytes.length;
  });

  return new Blob([output], { type: IMAGE_OUTPUT_FORMATS.ico.mime });
}

export const canvasToIcoBlob = canvasToIco;

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toFixed(maximumFractionDigits).replace(/\.?0+$/, '');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 2)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 2)} MB`;
}
