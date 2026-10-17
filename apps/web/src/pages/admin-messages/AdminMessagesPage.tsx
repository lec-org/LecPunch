import { useEffect, useState } from 'react';
import { Button } from '@lecpunch/ui';
import { downloadMessageImage, getAdminMessages, processMessage, type MemberMessage } from '@/features/messages/messages.api';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime } from '@/shared/lib/time';

const ProtectedImage = ({ path, expired }: { path: string; expired: boolean }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (expired) return;
    let active = true, objectUrl = '';
    void downloadMessageImage(path).then(blob => {
      if (!active) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setError('图片已过期或暂时无法读取'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, expired]);
  return expired ? <span>附件已过期</span> : error ? <span>{error}</span> : url ? <a href={url} target="_blank" rel="noreferrer"><img className="h-36 max-w-xs rounded border object-contain" alt="成员消息附件" src={url} /></a> : <span>正在加载图片…</span>;
};

const MessageCard = ({ message, onUpdate, onError }: { message: MemberMessage; onUpdate: (m: MemberMessage) => void; onError: (s: string) => void }) => {
  const [draft, setDraft] = useState({ base: message.processingNote, value: message.processingNote });
  const [busy, setBusy] = useState(false);
  const dirty = draft.value !== draft.base;
  const note = dirty ? draft.value : message.processingNote;
  const conflict = dirty && draft.base !== message.processingNote;
  return <article className="rounded-xl border bg-white p-5 space-y-3">
    <div className="flex justify-between"><strong>{message.reporter.displayName} · @{message.reporter.username}</strong><span>{message.processingStatus === 'processed' ? '已处理' : '待处理'}</span></div>
    <p className="text-xs text-gray-500">{formatDateTime(message.createdAt)}</p>
    <p className="whitespace-pre-wrap break-words">{message.description}</p>
    <div className="flex gap-3 flex-wrap">{message.images.map(image => <ProtectedImage key={image.id} path={image.downloadPath} expired={Boolean(message.imagesExpireAt && new Date(message.imagesExpireAt).getTime() <= Date.now())} />)}</div>
    {!message.images.length && message.imagesExpireAt && <p className="text-sm text-gray-500">附件已过期并清理。</p>}
    <label className="block text-sm">处理备注<textarea maxLength={2000} className="mt-1 block w-full rounded border p-2" value={note} disabled={busy} onChange={e => setDraft({ base: dirty ? draft.base : message.processingNote, value: e.target.value })} /></label>
    {conflict && <div role="alert" className="space-y-2 text-sm text-amber-700">
      <p>服务器备注已更新，本地草稿已保留。请先复制需要保留的内容，再载入最新备注后编辑。</p>
      <Button size="sm" variant="outline" onClick={() => setDraft({ base: message.processingNote, value: message.processingNote })}>载入最新备注</Button>
    </div>}
    {message.processedAt && <p className="text-xs text-gray-500">最近处理：{formatDateTime(message.processedAt)} · 操作人 {message.processedByDisplayName || '历史管理员'}</p>}
    <Button size="sm" loading={busy} disabled={conflict} onClick={async () => {
      if (busy || conflict) return;
      setBusy(true);
      try {
        const updated = await processMessage(message.id, message.processingStatus === 'processed' ? 'open' : 'processed', note);
        setDraft({ base: updated.processingNote, value: updated.processingNote });
        onUpdate(updated);
      }
      catch (e) { onError(getApiErrorMessage(e, '保存处理状态失败')); }
      finally { setBusy(false); }
    }}>{message.processingStatus === 'processed' ? '重新打开' : '标记处理完成'}</Button>
  </article>;
};
export const AdminMessagesPage = () => {
  const [items, setItems] = useState<MemberMessage[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true); setError('');
    try { const result = await getAdminMessages(page); setItems(result.items); setTotal(result.total); }
    catch (e) { setError(getApiErrorMessage(e, '加载收件箱失败')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [page]);
  return <div className="mx-auto max-w-4xl space-y-5 p-8">
    <h1 className="text-2xl font-bold">管理员收件箱</h1>
    <p className="text-sm text-gray-500">共 {total} 条消息。通知已读不代表消息已处理；关闭接收提醒不删除消息。</p>
    <Button variant="outline" disabled={loading} onClick={() => void load()}>刷新</Button>
    {error && <p role="alert" className="text-red-600">{error}</p>}{loading && <p>正在加载…</p>}
    {!loading && !items.length && <p>暂无成员消息。</p>}
    {items.map(m => <MessageCard key={m.id} message={m} onError={setError} onUpdate={updated => setItems(old => old.map(m => m.id === updated.id ? updated : m))} />)}
    <div className="flex gap-4"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(n => n - 1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={page * 20 >= total || loading} onClick={() => setPage(n => n + 1)}>下一页</Button></div>
  </div>;
};
