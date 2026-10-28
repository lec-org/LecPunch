import type { CardActionEffect } from '@lecpunch/shared';
import { formatComprehensiveDuration } from '@/shared/lib/time';

export const CardEffectSummary = ({ effects }: { effects: CardActionEffect[] }) => <ul className="space-y-2 text-sm leading-7">{effects.map((effect, index) => <li key={index}>
  {effect.source && <p className="text-gray-700">连带效果来自 <span className="font-semibold">{effect.source.user.displayName}</span>（{effect.source.user.username}）使用的 <span className="font-semibold">{effect.source.card.name}</span>。</p>}
  {effect.kind === 'judgement' ? <p className="font-medium">{effect.detail ?? '判定已完成'}</p> : effect.outcome === 'blocked' ? <p className="text-gray-600">该次效果被防御或免疫抵消，未生效。</p> : <>
    {effect.outcome === 'reflected' && effect.actualTarget && <p className="text-amber-800">已反弹，实际作用于 {effect.actualTarget.displayName}（{effect.actualTarget.username}）。</p>}
    <p className={effect.kind === 'time' && (effect.deltaSeconds ?? 0) < 0 ? 'text-red-700' : 'text-gray-600'}>{effect.kind === 'time' && effect.outcome !== 'no-effect'
      ? `${(effect.actualTarget ?? effect.target).displayName}：${(effect.deltaSeconds ?? 0) < 0 ? '扣除' : '增加'} ${formatComprehensiveDuration(Math.abs(effect.deltaSeconds ?? 0))} 综合时长`
      : effect.detail ?? '未产生时长变化。'}</p>
  </>}
</li>)}</ul>;
