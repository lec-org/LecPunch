import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export const DrawRulesDialog = ({ onClose }: { onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    return () => { element?.close?.(); returnFocus.current?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="draw-rules-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto w-[min(620px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/55">
    <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-5">
      <h2 id="draw-rules-title" className="text-lg font-semibold">抽卡规则与概率</h2>
      <button type="button" autoFocus aria-label="关闭抽卡规则" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="space-y-6 p-6 text-sm leading-7">
      <section><h3 className="mb-3 font-semibold">基础概率</h3><table className="w-full text-left"><caption className="sr-only">每次普通抽卡的基础稀有度概率，保底触发时除外</caption><thead><tr className="border-b text-gray-500"><th scope="col" className="py-2 font-normal">等级</th><th scope="col" className="py-2 text-right font-normal">概率</th></tr></thead><tbody>{[['N','60%'],['R','28%'],['SR','10%'],['SSR','2%']].map(([rarity, probability]) => <tr key={rarity} className="border-b border-gray-100"><th scope="row" className="py-2 font-medium">{rarity}</th><td className="py-2 text-right tabular-nums">{probability}</td></tr>)}</tbody></table></section>
      <section><h3 className="font-semibold">保底进度 n / m</h3><p className="mt-2 text-gray-600">n 是连续未获得对应等级的抽数，m 是保底上限。SR 或以上为 10 抽，SSR 为 50 抽。例如 9 / 10 表示下一抽必得 SR 或 SSR。</p><p className="mt-2 text-gray-600">获得 SR 或 SSR 后，SR 进度归零；获得 SSR 后，SSR 进度也归零。两种保底同时到达时，SSR 优先。免费和赠送机会参与保底，随机换卡不参与。</p></section>
      <section><h3 className="font-semibold">SSR 与捕获明光</h3><p className="mt-2 text-gray-600">只有第 50 抽 SSR 硬保底有 30% 概率触发捕获明光，获得两张独立随机 SSR，允许重复；其余 70% 播放金光，获得一张 SSR。提前获得的普通 SSR 只有一张。</p><p className="mt-2 text-gray-600">捕获明光只消耗一次抽卡机会或 60 积分，保底也只重置一次。动画、跳过和重试不会再次扣费。</p></section>
      <section><h3 className="font-semibold">抽取与跨周</h3><p className="mt-2 text-gray-600">每周前两抽免费，之后优先使用赠送机会，再支付 60 积分；每周没有抽卡上限。保底、卡片和发现记录跨周保留；积分、免费次数和赠送机会按北京时间周一重置。</p></section>
    </div>
  </dialog>;
};
