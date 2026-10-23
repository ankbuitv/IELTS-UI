/**
 * Client-side image prep for avatar uploads: cover-crop to a square and
 * downscale before the bytes ever leave the browser. A phone camera picture
 * becomes a small WebP (or PNG when the browser cannot encode WebP), always
 * well under the server's 2 MB avatar limit.
 */
export async function squareAvatarDataUrl(file: File, size = 512): Promise<{ mime: string; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare images.');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    const dataUrl = canvas.toDataURL('image/webp', 0.88);
    const separator = dataUrl.indexOf(',');
    if (separator < 0) throw new Error('This browser could not prepare the image.');
    return {
      mime: dataUrl.slice('data:'.length, separator).split(';')[0] || 'image/png',
      dataBase64: dataUrl.slice(separator + 1),
    };
  } finally {
    bitmap.close();
  }
}
