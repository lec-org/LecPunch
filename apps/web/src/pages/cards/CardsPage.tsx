import { useState } from 'react';
import { Gift, HelpCircle, Layers3, RefreshCw, Sparkles } from 'lucide-react';
import type { CardRarity } from '@lecpunch/shared';
import { CARD_PITY_LIMITS } from '@lecpunch/shared';
import { Button } from '@lecpunch/ui';
import { useAuthStore } from '@/app/store/auth-store';
import { CardArt, CardArtScope } from '@/features/cards/CardArt';
import { IdleCardOrbit, type IdleCardOrbitProps } from '@/features/cards/IdleCardOrbit';
import { DrawAnimation } from '@/features/cards/DrawAnimation';
import { CardDetailsDialog } from '@/features/cards/CardDetailsDialog';
import { CardActionResultDialog } from '@/features/cards/CardActionResultDialog';
import { CardGiftInboxDialog } from '@/features/cards/CardGiftInboxDialog';
import { CardInteractionInboxDialog } from '@/features/cards/CardInteractionInboxDialog';
import { CardDefenseInboxDialog } from '@/features/cards/CardDefenseInboxDialog';
import { DrawRulesDialog } from '@/features/cards/DrawRulesDialog';
import { useCardGame } from '@/features/cards/use-card-game';
import { useCardLiveUpdates } from '@/features/cards/use-card-live-updates';
import { formatComprehensiveDuration, formatDateTime } from '@/shared/lib/time';

const rarities: CardRarity[] = ['N', 'R', 'SR', 'SSR'];
const frames: Record<CardRarity, string> = {
  N: 'border-gray-200 bg-white', R: 'border-sky-200 bg-sky-50/40',
  SR: 'border-purple-200 bg-purple-50/40', SSR: 'border-amber-300 bg-amber-50/60'
};
const future = (value: string | null) => Boolean(value && new Date(value).getTime() > Date.now());

export const CardsPage = ({ renderDrawAnimation }: Pick<IdleCardOrbitProps, 'renderDrawAnimation'> = {}) => {
  const user = useAuthStore(s => s.auth.user);
  if (!user) return null;
  return <CardsWorkspace key={`${user.teamId}:${user.id}`} identity={`${user.teamId}:${user.id}`} userId={user.id} enrollYear={user.enrollYear} renderDrawAnimation={renderDrawAnimation} />;
};

const CardsWorkspace = ({ identity, userId, enrollYear, renderDrawAnimation }: { identity: string; userId: string; enrollYear: number } & Pick<IdleCardOrbitProps, 'renderDrawAnimation'>) => {
  const game = useCardGame(identity);
  const [filter, setFilter] = useState<CardRarity | 'all'>('all'), [selectedId, setSelectedId] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dismissedGifts, setDismissedGifts] = useState<Set<string>>(() => new Set());
  const [dismissedDefenses, setDismissedDefenses] = useState<Set<string>>(() => new Set());
  const [dismissedInteractions, setDismissedInteractions] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<'use' | 'gift'>('use'), [targetId, setTargetId] = useState(''), [secondTargetId, setSecondTargetId] = useState('');
  const view = game.view;
  const tenFree = Math.min(10, view?.freeRemaining ?? 0);
  const tenGifts = Math.min(10 - tenFree, view?.giftDraws ?? 0);
  const tenCost = (10 - tenFree - tenGifts) * 60;
  const selected = game.actionReveal ? undefined : view?.collection.find(card => card.id === selectedId && card.unlocked);
  const incomingGifts = (view?.incomingGifts ?? []).filter(notice => !dismissedGifts.has(notice.id));
  const giftKey = incomingGifts.map(gift => gift.id).join(':');
  const incomingDefenses = (view?.incomingDefenses ?? []).filter(notice => !dismissedDefenses.has(notice.id));
  const defenseKey = incomingDefenses.map(notice => notice.id).join(':');
  const canShowInbox = !selected && !rulesOpen && !game.drawReveal && !game.actionReveal;
  const showDefenses = Boolean(defenseKey && canShowInbox);
  const incomingInteractions = (view?.incomingInteractions ?? []).filter(notice => !dismissedInteractions.has(notice.id));
  const interactionKey = incomingInteractions.map(notice => notice.id).join(':');
  const showInteractions = Boolean(interactionKey && canShowInbox && !showDefenses);
  const showGifts = Boolean(giftKey && canShowInbox && !showDefenses && !showInteractions);
  const dismissDefenses = () => setDismissedDefenses(previous => new Set([...previous, ...incomingDefenses.map(notice => notice.id)]));
  const dismissInteractions = () => setDismissedInteractions(previous => new Set([...previous, ...incomingInteractions.map(notice => notice.id)]));
  const dismissGifts = () => setDismissedGifts(previous => new Set([...previous, ...incomingGifts.map(notice => notice.id)]));
  useCardLiveUpdates(game.refreshInBackground, game.busy || Boolean(game.pending) ||
    !canShowInbox || showDefenses || showInteractions || showGifts, Boolean(view));
  const locked = Boolean(view && future(view.statuses.lockedUntil)), starved = Boolean(view && future(view.statuses.starvedUntil));
  const disabled = game.busy || Boolean(game.pending) || Boolean(game.drawReveal) || Boolean(game.actionReveal) || Boolean(view?.capacityLimited);
  const targetMode = mode === 'gift' ? 'other' : selected?.targetMode ?? 'none';
  const assessmentScope = mode === 'use' && selected?.targetScope === 'assessment';
  const targetScopeLabel = assessmentScope ? '当前应考成员' : '同年级成员';
  const ownGrade = view?.players.find(player => player.id === userId)?.enrollYear ?? enrollYear;
  const targets = view?.players.filter(player => (assessmentScope ? view.requiredEnrollYears?.includes(player.enrollYear) : player.enrollYear === ownGrade) && (targetMode === 'self-or-other' || targetMode === 'two' || player.id !== userId)) ?? [];
  const needsTarget = targetMode !== 'none';
  const validTargets = !needsTarget || Boolean(targets.some(player => player.id === targetId) && (targetMode !== 'two' || targets.some(player => player.id === secondTargetId) && targetId !== secondTargetId));
  const canAct = Boolean(selected && selected.quantity > 0 && validTargets && !disabled && (mode === 'gift' || selected.usable !== false && !locked));
  const choose = (id: string, action: 'use' | 'gift' = 'use') => {
    game.clearFeedback();
    setSelectedId(id); setMode(action); setSecondTargetId('');
    setTargetId(action === 'use' && view?.collection.find(card => card.id === id)?.targetMode === 'self-or-other' ? userId : '');
  };
  return <CardArtScope><div className="mx-auto max-w-7xl p-5 md:p-8 space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-gray-900">积分与卡牌</h1><p className="mt-2 text-sm text-gray-500">打卡积累积分，慢慢揭开属于你的卡牌图鉴。</p></div>
      <Button variant="outline" disabled={game.busy || game.loading || Boolean(game.drawReveal)} onClick={() => void game.refresh()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{game.loading ? '正在刷新' : '刷新数据'}</Button>
    </header>
    {game.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{game.error}</p>}
    {game.syncError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{game.syncError}</p>}
    {game.success && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{game.success}</p>}
    {view?.capacityLimited && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">卡牌记录达到安全容量，暂时不能抽卡、使用或赠送卡片。现有图鉴和记录仍可查看，请联系维护者归档。</p>}
    {game.pending && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3" aria-label="待确认操作">
      <p className="text-sm text-amber-900">有一笔操作尚待确认。确认结果前暂停新操作，避免重复扣费或赠卡。</p>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={game.busy} onClick={() => void game.verify()}>核实操作结果</Button><Button variant="outline" disabled={game.busy} onClick={() => void game.retry()}>使用原请求重试</Button></div>
    </section>}
    {!view && game.loading && <p role="status" className="py-16 text-center text-gray-500">正在读取你的积分和图鉴…</p>}
    {!view && !game.loading && <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">暂时无法展示卡牌数据，请使用上方“刷新数据”重试。</div>}
    {view && <>
      <IdleCardOrbit collection={view.collection} animationState={{ pending: game.busy && game.pending?.action === 'draw', result: game.lastResult }} renderDrawAnimation={renderDrawAnimation} />
      <section className="rounded-2xl border border-gray-200 bg-white p-6" aria-label="本周积分与抽卡">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-gray-100 pb-6">
          <div><p className="text-sm text-gray-500">本周可用抽卡积分</p><p className={`mt-2 text-4xl font-medium tabular-nums ${view.points.balance < 0 ? 'text-red-700' : ''}`}>{view.points.balance}<span className="ml-2 text-sm font-normal text-gray-500">积分</span></p><p className="mt-3 text-xs text-gray-500">综合时长额度 {view.points.earned} − 已使用 {view.points.spent}</p>{view.points.balance < 0 && <p className="mt-2 text-xs text-red-700">当前欠额 {Math.abs(view.points.balance)} 积分，后续加时先抵扣差额；免费和赠送抽卡机会仍可使用。</p>}</div>
          <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button disabled={disabled || starved || view.freeRemaining <= 0 && view.giftDraws <= 0 && view.points.balance < 60} loading={game.busy} onClick={() => void game.submit({ action: 'draw' })}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />{view.freeRemaining > 0 ? `免费抽卡（剩 ${view.freeRemaining} 次）` : view.giftDraws > 0 ? `使用赠送机会（剩 ${view.giftDraws} 次）` : '抽取一张 · 60 积分'}
          </Button><Button variant="outline" disabled={disabled || starved || tenCost > 0 && view.points.balance < tenCost} loading={game.busy} onClick={() => void game.submit({ action: 'draw', count: 10 })}>
            <Layers3 className="h-4 w-4" aria-hidden="true" />十连抽 · {tenCost > 0 ? `${tenCost} 积分` : '无需积分'}
          </Button></div><p className="text-xs text-gray-500">每周前两抽免费，之后优先使用赠送机会。</p>
          <p className="text-xs text-gray-500">本次十连：免费 {tenFree} 次 ＋ 赠送 {tenGifts} 次 ＋ {tenCost} 积分；不足十抽不扣费。</p></div>
        </div>
        <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <p><span className="text-gray-500">当前周</span><br /><span className="mt-1 inline-block">{view.week} 起 · 北京时间</span></p>
          <p><span className="text-gray-500">本周综合时长</span><br /><span className={`mt-1 inline-block tabular-nums ${(view.points.comprehensiveSeconds ?? view.entertainmentSeconds) < 0 ? 'text-red-700' : 'text-gray-900'}`}>{formatComprehensiveDuration(view.points.comprehensiveSeconds ?? view.entertainmentSeconds)}</span><span className="mt-1 block text-xs text-gray-500">考核、排行与积分统一口径，可为负数</span></p>
          <p><span className="text-gray-500">SR 或以上保底</span><br /><span aria-label="SR 或以上保底进度" className="mt-1 inline-block font-mono text-lg tabular-nums">{view.pity.sinceSR} / {CARD_PITY_LIMITS.sr}</span></p>
          <p><span className="text-gray-500">SSR 保底</span><br /><span aria-label="SSR 保底进度" className="mt-1 inline-block font-mono text-lg tabular-nums">{view.pity.sinceSSR} / {CARD_PITY_LIMITS.ssr}</span></p>
        </div>
        <div className="mt-4 flex justify-end"><button type="button" aria-haspopup="dialog" disabled={game.busy || Boolean(game.drawReveal)} onClick={() => setRulesOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"><HelpCircle size={14} aria-hidden="true" />查看抽卡规则</button></div>
      </section>
      {(view.statuses.acceleration || future(view.statuses.immuneUntil) || locked || starved) && <section className="rounded-xl border bg-white p-4 text-sm space-y-1" aria-label="当前卡牌状态">
        <h2 className="font-semibold">当前状态</h2>
        {view.statuses.acceleration && <p>加速已就绪：等待下一次有效签退。</p>}
        {future(view.statuses.immuneUntil) && <p>无懈可击：持续至 {formatDateTime(view.statuses.immuneUntil!)}。</p>}
        {locked && <p>主动用卡暂停至 {formatDateTime(view.statuses.lockedUntil!)}，不影响打卡和抽卡。</p>}
        {starved && <p>新卡获取暂停至 {formatDateTime(view.statuses.starvedUntil!)}，可以积累积分并使用已有卡牌。</p>}
      </section>}
      <section className="space-y-4" aria-labelledby="collection-title">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 id="collection-title" className="text-lg font-semibold">我的卡牌图鉴</h2><p className="mt-1 text-sm text-gray-500">已发现 {view.collection.filter(card => card.unlocked).length} / {view.collection.length} 种。抽到或收到赠卡后永久揭晓。</p></div><Layers3 className="h-6 w-6 text-gray-400" aria-hidden="true" /></div>
        <div className="flex flex-wrap gap-2" aria-label="卡牌等级筛选">
          {(['all', ...rarities] as const).map(rarity => { const cards = view.collection.filter(card => rarity === 'all' || card.rarity === rarity); return <button type="button" key={rarity} aria-pressed={filter === rarity} onClick={() => setFilter(rarity)} className={`rounded-full border px-4 py-2 text-sm ${filter === rarity ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'}`}>{rarity === 'all' ? '全部' : rarity} {cards.filter(card => card.unlocked).length}/{cards.length}</button>; })}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {view.collection.filter(card => filter === 'all' || card.rarity === filter).map(card => <article key={card.id} className={`rounded-2xl border p-3 ${card.unlocked ? frames[card.rarity] : 'border-gray-200 bg-gray-50'}`}>
            <div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold tracking-wider text-gray-500">{card.rarity}</span><span className="text-gray-500">{card.unlocked ? `持有 ${card.quantity}` : '尚未发现'}</span></div>
            {card.unlocked ? <><button type="button" className="block w-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600" onClick={() => choose(card.id)} aria-label={`查看${card.name ?? '已发现卡牌'}卡面详情`}><CardArt key={`${identity}:${card.id}`} id={card.id} name={card.name ?? '已发现卡牌'} interactive={false} /></button><button type="button" className="mt-3 w-full text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600" onClick={() => choose(card.id)} aria-label={`查看${card.name ?? '已发现卡牌'}`}><h3 className="text-sm font-semibold">{card.name}</h3><p className="mt-1 text-xs text-gray-500">{card.type} · {card.stat}</p><span className="mt-2 inline-block text-xs text-blue-700">查看详情与使用 →</span></button>{card.quantity > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{card.usable === false ? <span className="flex items-center justify-center rounded-lg bg-gray-100 px-2 py-2.5 text-xs text-gray-500">自动生效</span> : <button type="button" disabled={disabled || locked} aria-label={`使用${card.name}`} onClick={() => choose(card.id, 'use')} className="min-h-11 rounded-lg bg-gray-900 px-2 py-2.5 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">使用</button>}<button type="button" disabled={disabled} aria-label={`赠送${card.name}`} onClick={() => choose(card.id, 'gift')} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"><Gift size={14} aria-hidden="true" />赠送</button></div>}</> : <div><div className="aspect-[2/3] rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-100 flex flex-col items-center justify-center gap-4 text-gray-400" aria-label={`${card.rarity}级未知卡牌`}><HelpCircle className="h-14 w-14 stroke-1" aria-hidden="true" /><span className="text-xs tracking-widest">LEC COLLECTION</span></div><h3 className="mt-3 text-sm text-gray-500">未知卡牌</h3><p className="mt-1 text-xs text-gray-500">获得后查看真容</p></div>}
          </article>)}
        </div>
      </section>
      {selected && <CardDetailsDialog card={selected} onClose={() => setSelectedId('')}>
        {game.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{game.error}</p>}
        {game.success && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{game.success}</p>}
        {game.pending && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm space-y-3">
          <p>操作结果待确认，请先核实；关闭弹窗不会取消已提交的操作。</p>
          <div className="flex flex-wrap gap-3"><Button disabled={game.busy} variant="outline" onClick={() => void game.verify()}>核实操作结果</Button><Button disabled={game.busy} variant="outline" onClick={() => void game.retry()}>使用原请求重试</Button></div>
        </div>}
        {selected.quantity > 0 ? <div className="border-t border-gray-100 pt-4 space-y-4">
          <div className="flex gap-3"><button type="button" disabled={disabled} aria-pressed={mode === 'use'} className={`rounded-lg border px-4 py-2 text-sm ${mode === 'use' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200'}`} onClick={() => { setMode('use'); setTargetId(''); setSecondTargetId(''); }}>使用卡片</button><button type="button" disabled={disabled} aria-pressed={mode === 'gift'} className={`rounded-lg border px-4 py-2 text-sm ${mode === 'gift' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200'}`} onClick={() => { setMode('gift'); setTargetId(''); setSecondTargetId(''); }}>赠送卡片</button></div>
          {mode === 'use' && selected.usable === false ? <p className="text-sm text-gray-500">这是一张被动卡，持有时自动生效，无需主动使用。</p> : <>
            <p className="text-xs leading-6 text-gray-500">作用范围：{targetScopeLabel}{assessmentScope && view.requiredEnrollYears?.length ? `（${view.requiredEnrollYears.join("、")} 级）` : ""}。以服务端当前名单为准。</p>{needsTarget && <label className="block text-sm">{targetMode === 'two' ? '第一位关联成员' : mode === 'gift' ? '赠送给' : '选择目标'}<select className="mt-2 block w-full max-w-md rounded-lg border border-gray-300 bg-white p-3" value={targetId} disabled={disabled} onChange={e => setTargetId(e.target.value)}><option value="">请选择{targetScopeLabel}</option>{targets.map(player => <option key={player.id} value={player.id}>{player.displayName} · {player.enrollYear} 级 · {player.username}{player.id === userId ? '（自己）' : ''}</option>)}</select></label>}
            {targetMode === 'two' && <label className="block text-sm">第二位关联成员<select className="mt-2 block w-full max-w-md rounded-lg border border-gray-300 bg-white p-3" value={secondTargetId} disabled={disabled} onChange={e => setSecondTargetId(e.target.value)}><option value="">请选择另一位成员</option>{targets.filter(player => player.id !== targetId).map(player => <option key={player.id} value={player.id}>{player.displayName} · {player.enrollYear} 级 · {player.username}</option>)}</select></label>}
            <Button disabled={!canAct} loading={game.busy} onClick={() => void game.submit({ action: mode, cardId: selected.id, ...(needsTarget ? { targetId } : {}), ...(targetMode === 'two' ? { secondTargetId } : {}) })}>{mode === 'gift' ? <Gift className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{mode === 'gift' ? '确认赠送一张' : '确认使用一张'}</Button>
          </>}
          {mode === 'use' && locked && <p className="text-sm text-amber-800">当前主动用卡被暂停，请在限制结束后刷新数据。</p>}
          {mode === 'gift' && <p className="text-xs text-gray-500">赠送成功后从你的库存移出一张，接收者永久解锁该卡，你的发现记录仍会保留。</p>}
        </div> : <p className="text-sm text-gray-500">已永久发现这张卡，当前没有库存。再次获得后即可使用或赠送。</p>}
      </CardDetailsDialog>}
      <details className="rounded-xl border border-gray-200 bg-white p-5 text-sm"><summary className="cursor-pointer font-medium">每周重置与跨周保留说明</summary><div className="mt-4 space-y-3 leading-7 text-gray-600"><p>北京时间周一 00:00 重置：抽卡积分、娱乐时长、免费抽卡次数（恢复 2 次）、当周赠送抽卡机会，以及加速、封卡、连环等临时状态。未使用的免费次数和赠送机会不补发。</p><p>跨周保留：已获得卡片、图鉴发现记录、SR / SSR 保底进度，以及历史操作记录。已主动开启的无懈可击跨周保留至 24 小时到期。卡牌用完或转赠后，图鉴也不会重新变成问号。</p><p>本周综合时长每满 1 分钟对应 1 积分额度；有效打卡、管理员净调整和卡牌净增减统一计算。加时、扣时、偷取、转移与连环都会影响考核、排行和积分额度。抽卡只消耗积分，不扣综合时长；本周已消费积分保留，额度降低后需先补足差额才能继续付费抽卡。卡牌不改原始签到、签退记录。</p></div></details>
      <section className="space-y-3"><h2 className="text-lg font-semibold">最近操作</h2>{view.events.length === 0 ? <p className="text-sm text-gray-500">还没有卡牌操作记录，从本周的免费抽卡开始吧。</p> : <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-5">{view.events.map(event => <li key={event.id} className="py-4 text-sm"><p>{event.message}</p><time className="mt-1 block text-xs text-gray-500" dateTime={event.at}>{formatDateTime(event.at)}</time></li>)}</ul>}</section>
    </>}
  </div>{rulesOpen && <DrawRulesDialog onClose={() => setRulesOpen(false)} />}{game.drawReveal && <DrawAnimation response={game.drawReveal} onComplete={game.finishReveal} />}{game.actionReveal && <CardActionResultDialog action={game.actionReveal.action} response={game.actionReveal.response} onClose={() => { setSelectedId(''); game.finishActionReveal(); }} />}{showDefenses && <CardDefenseInboxDialog key={defenseKey} notices={incomingDefenses} onClose={dismissDefenses} onConfirmed={() => { dismissDefenses(); void game.refresh(); }} />}{showInteractions && <CardInteractionInboxDialog key={interactionKey} notices={incomingInteractions} onClose={dismissInteractions} onConfirmed={() => { dismissInteractions(); void game.refresh(); }} />}{showGifts && <CardGiftInboxDialog key={giftKey} gifts={incomingGifts} onClose={dismissGifts} onConfirmed={() => { dismissGifts(); void game.refresh(); }} />}</CardArtScope>;
};
