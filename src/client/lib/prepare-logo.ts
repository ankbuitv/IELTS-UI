/** Decode and resize large raster logos before sending them to D1. */
export async function prepareLogo(file: File): Promise<{ mime: string; base64: string }> {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Chọn ảnh PNG, JPG hoặc WebP.');
  if (file.size > 10_000_000) throw new Error('Ảnh gốc phải nhỏ hơn 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Không thể đọc ảnh logo.'));});
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Ảnh logo không hợp lệ.');
    const canvas = document.createElement('canvas');
    for (const size of [512,384,256,160]) {
      const factor = Math.min(1,size / Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width = Math.max(1,Math.round(image.naturalWidth * factor));
      canvas.height = Math.max(1,Math.round(image.naturalHeight * factor));
      const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [.85,.7,.5]) {
        const data=canvas.toDataURL('image/webp',quality);
        const [header, base64] = data.split(',');
        if (header === 'data:image/webp;base64' && base64 && Math.floor(base64.length*3/4) <= 100000) return {mime:'image/webp',base64};
      }
      const png=canvas.toDataURL('image/png').split(',')[1];
      if (png && Math.floor(png.length*3/4)<=100000) return {mime:'image/png',base64:png};
    }
    throw new Error('Không thể nén logo xuống kích thước cho phép. Vui lòng thử ảnh khác.');
  } finally { URL.revokeObjectURL(url); }
}
