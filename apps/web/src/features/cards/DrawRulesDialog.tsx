import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { CARD_DRAW_WEIGHTS, CARD_DRAW_WEIGHT_TOTAL, CARD_PITY_LIMITS } from '@lecpunch/shared';

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
      <section><h3 className="mb-3 font-semibold">基础概率</h3><table className="w-full text-left"><caption className="sr-only">每次普通抽卡的基础稀有度概率，保底触发时除外</caption><thead><tr className="border-b text-gray-500"><th scope="col" className="py-2 font-normal">等级</th><th scope="col" className="py-2 text-right font-normal">概率</th></tr></thead><tbody>{Object.entries(CARD_DRAW_WEIGHTS).map(([rarity, weight]) => <tr key={rarity} className="border-b border-gray-100"><th scope="row" className="py-2 font-medium">{rarity}</th><td className="py-2 text-right tabular-nums">{weight * 100 / CARD_DRAW_WEIGHT_TOTAL}%</td></tr>)}</tbody></table></section>
      <section><h3 className="font-semibold">保底进度 n / m</h3><p className="mt-2 text-gray-600">n 是连续未获得对应等级的抽数，m 是保底上限。SR 或以上为 {CARD_PITY_LIMITS.sr} 抽，SSR 为 {CARD_PITY_LIMITS.ssr} 抽。例如 {CARD_PITY_LIMITS.sr - 1} / {CARD_PITY_LIMITS.sr} 表示下一抽必得 SR 或 SSR。</p><p className="mt-2 text-gray-600">获得 SR 或 SSR 后，SR 进度归零；获得 SSR 后，SSR 进度也归零。两种保底同时到达时，SSR 优先。免费和赠送机会参与保底，随机换卡不参与。</p></section>
      <section><h3 className="font-semibold">SSR 与捕获明光</h3><p className="mt-2 text-gray-600">只有十连中的第 {CARD_PITY_LIMITS.ssr} 抽 SSR 硬保底有 30% 概率触发捕获明光：保留保底 SSR，将本批另一张非 SSR 提升为独立随机 SSR，允许重复，最终仍是 10 张卡。若十张已经全是 SSR，则保留原奖励。单抽不触发明光，硬保底也只获得一张 SSR。</p><p className="mt-2 text-gray-600">明光不额外消耗次数或积分；保底按最终十张的展示顺序累计和重置。动画、跳过和重试不会再次扣费。</p></section>
      <section><h3 className="font-semibold">十连抽</h3><p className="mt-2 text-gray-600">按顺序抽取 10 次，逐抽先消耗免费次数、再用赠送机会、最后每抽支付 60 积分。开始前需要足够完成全部十抽的次数与积分，不足则整笔不扣费、不发卡。保底逐抽累计和重置，没有额外的十连专属保底。</p><p className="mt-2 text-gray-600">只播放一次本批最高等级动画，捕获明光优先；明光仅在十连内第 {CARD_PITY_LIMITS.ssr} 抽硬保底按 30% 判定，以替换非 SSR 的方式保证至少两张 SSR，总数始终为 10 张。动画后逐张揭晓，可随时跳过直达十连汇总；汇总中重复卡合并显示数量，整批重试不会重复扣费或发卡。</p></section>
      <section><h3 className="font-semibold">综合时长与积分</h3><p className="mt-2 text-gray-600">考核、排行与抽卡使用同一本周综合时长：有效打卡 ＋ 管理员净调整 ＋ 卡牌净效果，允许为负数。积分额度为综合秒数除以 60 后向下取整，加时、扣时、偷取、转移与连环都会同步影响额度。</p><p className="mt-2 text-gray-600">积分余额为额度减去本周已消费积分，允许显示负数；负数表示欠额，后续加时先抵扣差额，消费记录不会清除。付费抽卡需足够余额，免费和赠送机会不受负积分影响。抽卡只消耗积分，不扣综合时长，也不改真实签到、签退记录。</p><p className="mt-2 text-gray-600">慈善家按自己的正综合时长分配，万箭穿心按目标的正综合时长计算比例；神偷奶爸固定转移 30 分钟，供给方可被扣成负数。比例效果不会因负时长反向变成增益。</p></section>
      <section><h3 className="font-semibold">用卡范围与防御顺序</h3><p className="mt-2 text-gray-600">慈善家、乐不思蜀、神偷奶爸、兵粮寸断、红桃 K 作用于当前应考两届的启用成员；团队出现新年级并切换考核范围后，名单同步更新。顺手牵羊由你指定同年级其他成员，其他卡按各自说明保留同年级范围。</p><p className="mt-2 text-gray-600">先判定是否产生不利结果，再按无懈可击 → 仁王盾（N）→ 名刀司命（N～R）→ 反弹的顺序处理，只触发第一个适用防御。自身不利判定也可被对应的盾或名刀挡住；反弹仅用于他人的单体攻击，不反弹自身或群体效果，也不能连续反弹。返还的攻击仍可被适用盾牌或无懈可击挡住。</p><p className="mt-2 text-gray-600">赌枪为 50% 加 30 分钟、50% 扣 30 分钟；获益不消耗防御卡。无懈可击是主动 24 小时保护，只阻挡他人的负面效果，正常接收加时和抽卡机会等增益，跨周保留至到期。自动防御及受卡牌影响的结果会在进入卡牌页时提示，关闭保留未读，确认不会重复结算。</p></section>
      <section><h3 className="font-semibold">抽取与跨周</h3><p className="mt-2 text-gray-600">每周前两抽免费，之后优先使用赠送机会，再支付 60 积分；每周没有抽卡上限。保底、卡片和发现记录跨周保留；积分、免费次数和赠送机会按北京时间周一重置。</p></section>
    </div>
  </dialog>;
};
