export const ABSOLUTE_FILE_LIMIT = (100 * 1024 * 1024) - 1;

interface ResizeOptions {
  mode: 'cover' | 'contain';
  width: number;
  height: number;
  maxBytes: number;
  quality?: number;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode the resized image.')), 'image/webp', quality);
  });
}

function loadImage(file: File) {
  return new Promise<{ image: HTMLImageElement; release: () => void }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(objectUrl) });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected image could not be decoded.'));
    };
    image.src = objectUrl;
  });
}

export async function resizeImage(file: File, options: ResizeOptions): Promise<File> {
  if (file.size < 1 || file.size > ABSOLUTE_FILE_LIMIT) throw new Error('Choose a file smaller than 100 MiB.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');

  const loaded = await loadImage(file);
  try {
    const { naturalWidth, naturalHeight } = loaded.image;
    if (!naturalWidth || !naturalHeight || naturalWidth * naturalHeight > 60_000_000) {
      throw new Error('That image is too large to resize safely.');
    }

    const canvas = document.createElement('canvas');
    let targetWidth: number;
    let targetHeight: number;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = naturalWidth;
    let sourceHeight = naturalHeight;

    if (options.mode === 'cover') {
      const sourceRatio = naturalWidth / naturalHeight;
      const targetRatio = options.width / options.height;
      if (sourceRatio > targetRatio) {
        sourceWidth = naturalHeight * targetRatio;
        sourceX = (naturalWidth - sourceWidth) / 2;
      } else {
        sourceHeight = naturalWidth / targetRatio;
        sourceY = (naturalHeight - sourceHeight) / 2;
      }
      targetWidth = options.width;
      targetHeight = options.height;
    } else {
      const scale = Math.min(1, options.width / naturalWidth, options.height / naturalHeight);
      targetWidth = Math.max(1, Math.round(naturalWidth * scale));
      targetHeight = Math.max(1, Math.round(naturalHeight * scale));
    }

    let quality = options.quality ?? 0.86;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = Math.max(1, Math.round(targetWidth));
      canvas.height = Math.max(1, Math.round(targetHeight));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Image resizing is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(loaded.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= options.maxBytes) {
        const stem = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'image';
        return new File([blob], `${stem}.webp`, { type: 'image/webp', lastModified: Date.now() });
      }
      if (quality > 0.55) quality -= 0.1;
      else {
        targetWidth *= 0.82;
        targetHeight *= 0.82;
      }
    }
    throw new Error('The image could not be resized below the storage limit.');
  } finally {
    loaded.release();
  }
}

export const resizeProfilePhoto = (file: File) => resizeImage(file, {
  mode: 'cover', width: 512, height: 512, maxBytes: 750 * 1024, quality: 0.86,
});

export const resizeBackgroundImage = (file: File) => resizeImage(file, {
  mode: 'contain', width: 2560, height: 1440, maxBytes: 4 * 1024 * 1024, quality: 0.86,
});
