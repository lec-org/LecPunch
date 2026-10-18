import { useEffect, useState } from 'react';
import { Button } from '@lecpunch/ui';
import { submitMessage } from '@/features/messages/messages.api';
import { getApiErrorMessage } from '@/shared/lib/api-error';

const AttachmentPreview = ({ file }: { file: File }) => {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <img className="h-24 w-32 rounded border object-contain" src={url} alt={file.name} /> : null;
};

export const SubmitMessagePage = () => {
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  return <div className="mx-auto max-w-3xl space-y-5 p-8">
    <h1 className="text-2xl font-bold">联系管理员</h1>
    <p className="text-sm text-gray-500">提交问题或说明，可附最多 3 张图片，每张不超过 3 MiB。图片保留 3 小时，文字与处理记录继续保留。</p>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError(''); setSuccess('');
      try {
        await submitMessage(description, images, requestKey);
        setDescription(''); setImages([]); setRequestKey(crypto.randomUUID()); setSuccess('消息已提交至管理员收件箱。');
      } catch (e) { setError(getApiErrorMessage(e, '提交结果未确认；内容已保留，可使用原内容重试')); }
      finally { setBusy(false); }
    }}>
      <label className="block">消息内容<textarea className="mt-2 block w-full rounded-lg border p-3" rows={7} required maxLength={2000} disabled={busy} value={description} onChange={e => { setDescription(e.target.value); setRequestKey(crypto.randomUUID()); setSuccess(''); }} /></label>
      <span className="text-xs text-gray-500">{description.length}/2000</span>
      <label className="block">添加图片<input className="mt-2 block" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e => {
        const next = [...images, ...Array.from(e.target.files ?? [])]; e.target.value = '';
        if (next.length > 3 || next.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 3 * 1024 * 1024)) {
          setError('最多 3 张 JPEG/PNG/WebP 图片，每张不超过 3 MiB'); return;
        }
        setImages(next); setRequestKey(crypto.randomUUID()); setError('');
      }} /></label>
      <div className="space-y-2">{images.map((image, i) => <div className="flex gap-3 text-sm" key={`${image.name}-${i}`}><AttachmentPreview file={image} /><span>{image.name}</span><button type="button" disabled={busy} className="text-red-600" onClick={() => { setImages(old => old.filter((_, index) => index !== i)); setRequestKey(crypto.randomUUID()); }}>移除</button></div>)}</div>
      {error && <p role="alert" className="text-red-600">{error}</p>}{success && <p role="status" className="text-green-700">{success}</p>}
      <Button type="submit" loading={busy} disabled={!description.trim()}>提交消息</Button>
    </form>
  </div>;
};
