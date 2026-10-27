import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { CardGameActionInput, CardGameActionResponse, CardGameActionResult, CardGameView } from '@lecpunch/shared';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { getCardAction, getCardGame, performCardAction } from './cards.api';

export type CardAction = Omit<CardGameActionInput, 'requestKey'>;
const definitive = (error: unknown) => axios.isAxiosError(error) && [400, 403, 404, 409, 422].includes(error.response?.status ?? 0);
const isPending = (value: unknown): value is CardGameActionInput => {
  if (!value || typeof value !== 'object') return false;
  const item = value as CardGameActionInput;
  return typeof item.requestKey === 'string' && /^[a-z\d-]{36}$/i.test(item.requestKey) && ['draw', 'use', 'gift'].includes(item.action);
};

export const useCardGame = (identity: string) => {
  const storageKey = `lecpunch-card-pending:${identity}`;
  const [view, setView] = useState<CardGameView | null>(null), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [pending, setPending] = useState<CardGameActionInput | null>(null);
  const [lastResult, setLastResult] = useState<CardGameActionResult | null>(null);
  const [drawReveal, setDrawReveal] = useState<CardGameActionResponse | null>(null);
  const revealRef = useRef<CardGameActionResponse | null>(null);
  const alive = useRef(true), gate = useRef(false), readId = useRef(0);
  const pendingRef = useRef<CardGameActionInput | null>(null), lastAttempt = useRef<CardGameActionInput | null>(null);
  const storePending = useCallback((input: CardGameActionInput | null) => {
    pendingRef.current = input; setPending(input);
    try { if (input) sessionStorage.setItem(storageKey, JSON.stringify(input)); else sessionStorage.removeItem(storageKey); }
    catch { if (input) setError('浏览器无法保存待确认操作；请在离开页面前核实本次结果。'); }
  }, [storageKey]);
  const apply = useCallback((result: CardGameActionResponse) => {
    // Invalidate any read started before this committed mutation.
    readId.current += 1;
    const draw = (pendingRef.current ?? lastAttempt.current)?.action === 'draw';
    if (draw && result.result.drawAnimation) {
      // The response is already committed. Keep its new names/collection behind the reveal.
      revealRef.current = result; setDrawReveal(result); setSuccess('');
    } else { setView(result.state); setLastResult(draw ? result.result : null); setSuccess(result.result.message); }
    setError(''); setLoading(false);
    storePending(null); lastAttempt.current = null;
  }, [storePending]);
  const refresh = useCallback(async () => {
    if (revealRef.current) return;
    const sequence = ++readId.current; setLoading(true);
    try { const result = await getCardGame(); if (alive.current && sequence === readId.current) { setView(result); setError(''); } }
    catch (e) { if (alive.current && sequence === readId.current) setError(getApiErrorMessage(e, '卡牌数据加载失败，请重试。')); }
    finally { if (alive.current && sequence === readId.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    try { const raw = sessionStorage.getItem(storageKey); if (raw) { const saved: unknown = JSON.parse(raw); if (isPending(saved)) { pendingRef.current = saved; setPending(saved); } } } catch { /* The in-memory gate remains available. */ }
    void refresh();
    return () => { alive.current = false; readId.current += 1; };
  }, [refresh, storageKey]);
  const submit = useCallback(async (action: CardAction, retry = false) => {
    if (gate.current || revealRef.current || (!retry && pendingRef.current)) return;
    gate.current = true; setBusy(true); setError(''); setSuccess(''); setLastResult(null); readId.current += 1; setLoading(false);
    const previous = retry ? pendingRef.current : lastAttempt.current;
    const same = previous && JSON.stringify({ ...previous, requestKey: undefined }) === JSON.stringify(action);
    const input = retry && previous ? previous : same ? previous! : { ...action, requestKey: crypto.randomUUID() };
    lastAttempt.current = input; storePending(input);
    try { const result = await performCardAction(input); if (alive.current) apply(result); }
    catch (e) {
      if (!alive.current) return;
      if (definitive(e)) { storePending(null); setError(getApiErrorMessage(e, '本次操作未执行，请检查条件后重试。')); }
      else setError('操作结果尚未确认。请先核实结果，或使用原请求重试；系统不会重复扣费或发卡。');
    } finally { gate.current = false; if (alive.current) setBusy(false); }
  }, [apply, storePending]);
  const verify = useCallback(async () => {
    const input = pendingRef.current; if (!input || gate.current) return;
    gate.current = true; setBusy(true);
    try { const result = await getCardAction(input.requestKey); if (alive.current) apply(result); }
    catch (e) { if (alive.current) setError(axios.isAxiosError(e) && e.response?.status === 404 ? '暂未查到本次操作，请保留原请求重试；不要再次发起新操作。' : getApiErrorMessage(e, '仍无法核实本次操作，请稍后重试核实。')); }
    finally { gate.current = false; if (alive.current) setBusy(false); }
  }, [apply]);
  const finishReveal = useCallback(() => {
    const result = revealRef.current; if (!result) return;
    revealRef.current = null; setDrawReveal(null); readId.current += 1;
    setView(result.state); setLastResult(result.result); setSuccess(result.result.message);
  }, []);
  return { view, loading, busy, error, success, pending, lastResult, drawReveal, finishReveal, refresh, submit, verify,
    retry: () => pendingRef.current && submit(pendingRef.current, true) };
};
