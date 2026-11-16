import { upload } from '@vercel/blob/client';

window.tscartBlobUpload = async function uploadTscartAsset(file, kind) {
  if (!(file instanceof File)) throw new TypeError('Choose a file to upload.');
  if (!['product-image', 'description-media'].includes(kind)) throw new TypeError('Invalid upload type.');
  const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null;
  if (!type) throw new Error('Choose a supported image, video or audio file.');
  const allowed = kind === 'product-image'
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/x-wav'];
  const maxBytes = kind === 'product-image' ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!allowed.includes(file.type) || file.size > maxBytes) throw new Error('This file type or size is not allowed.');
  const result = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/admin/blob-upload',
    clientPayload: JSON.stringify({ kind })
  });
  return { url: result.url, type };
};
