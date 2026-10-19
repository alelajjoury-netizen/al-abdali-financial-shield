import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpLeft, Hourglass, PiggyBank, ShieldAlert } from 'lucide-react';
import {
  getGetDashboardQueryKey, useDecidePurchaseSimulation, type Dashboard, type PurchaseSimulation,
} from '@workspace/api-client-react';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DISPLAY_LOCALE, formatAmount } from '@/lib/formatting';

// Monotonic deadlines retained per attempt for the life of the tab. Closing and
// reopening the dialog (or remounting) must not re-anchor on an older serverTime.
const anchors = new Map<string, { serverTime: number; deadline: number }>();

function deadlineFor(purchase: PurchaseSimulation) {
  const key = String(purchase.id);
  const serverTime = new Date(purchase.serverTime).getTime();
  const known = anchors.get(key);
  // Only a newer server observation may refine the anchor.
  if (known && !(serverTime > known.serverTime)) return known.deadline;
  const deadline = performance.now() + remaining(purchase) * 1000;
  anchors.set(key, { serverTime, deadline });
  return deadline;
}

function secondsLeft(deadline: number) {
  return Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
}

export function useCooldownSeconds(purchase: PurchaseSimulation) {
  const deadline = deadlineFor(purchase);
  const [seconds, setSeconds] = useState(() => secondsLeft(deadline));
  useEffect(() => {
    const update = () => setSeconds(secondsLeft(deadline));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return seconds;
}

export function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function money(purchase: PurchaseSimulation) {
  const label = purchase.currency === 'KWD' ? 'د.ك' : purchase.currency;
  return formatAmount(purchase.amount) + ' ' + label;
}

type Props = { purchase: PurchaseSimulation; onDecided?: (result: PurchaseSimulation) => void };

/** Server-backed cooldown decision body (countdown, awareness questions, continue/postpone). */
export function PurchaseCooldown({ purchase, onDecided }: Props) {
  const client = useQueryClient();
  const seconds = useCooldownSeconds(purchase);
  const [necessary, setNecessary] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [budgetImpact, setBudgetImpact] = useState('');
  const [message, setMessage] = useState('');
  const decision = useDecidePurchaseSimulation();

  function decide(action: 'continue' | 'postpone') {
    if (decision.isPending || (action === 'continue' && (seconds > 0 || !necessary || !tomorrow || !budgetImpact))) return;
    setMessage('');
    decision.mutate({
      id: purchase.id,
      data: {
        action,
        ...(action === 'continue' ? {
          isNecessary: necessary === 'yes',
          stillWantsTomorrow: tomorrow === 'yes',
          understandsBudgetImpact: budgetImpact === 'yes',
        } : {}),
      },
    }, {
      onSuccess: (result) => {
        client.setQueryData<Dashboard>(getGetDashboardQueryKey(), (previous) =>
          previous ? {
            ...previous,
            pendingSimulations: previous.pendingSimulations.filter((item) => item.id !== result.id),
            recentSimulations: previous.recentSimulations.some((item) => item.id === result.id)
              ? previous.recentSimulations.map((item) => item.id === result.id ? result : item)
              : [result, ...previous.recentSimulations].slice(0, 10),
          } : previous);
        onDecided?.(result);
        void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
      onError: (error) => {
        const detail = (error as { data?: { error?: string } }).data?.error;
        setMessage(detail || 'تعذر حفظ القرار. تحققي من الاتصال ثم حاولي مجددًا.');
        void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
    });
  }

  const cooling = seconds > 0;

  return (
    <div className="brake-body" data-testid={`cooldown-${purchase.id}`}>
      <div className="brake-receipt" data-testid={`details-${purchase.id}`}>
        <div>
          <span className="brake-receipt-label">المتجر</span>
          <strong data-testid={`text-cooldown-merchant-${purchase.id}`}>{purchase.merchantName}</strong>
        </div>
        <div className="brake-receipt-amount">
          <span className="brake-receipt-label">المبلغ المعلّق</span>
          <strong className="num" data-testid={`text-cooldown-amount-${purchase.id}`}>{money(purchase)}</strong>
        </div>
      </div>

      <div className={`brake-timer ${cooling ? '' : 'is-done'}`}>
        <span className="brake-timer-label"><Hourglass size={14} /> {cooling ? 'مهلة التهدئة المتبقية' : 'انتهت مهلة التهدئة'}</span>
        <div className="cooldown-clock" role="timer" aria-live="off" aria-label="الوقت المتبقي للتهدئة" dir="ltr" data-testid={`timer-${purchase.id}`}>
          {formatClock(seconds)}
        </div>
        {purchase.cooldownEndsAt && <p>تنتهي في {new Date(purchase.cooldownEndsAt).toLocaleTimeString(DISPLAY_LOCALE)} بتوقيت جهازك، وتبقى محفوظة بعد إغلاق النافذة أو تحديث الصفحة.</p>}
      </div>

      <div className="brake-questions">
        <h3>قبل قرارك، خذ لحظة للتفكير</h3>
        <p id={`awareness-help-${purchase.id}`}>اقرأ الأسئلة الثلاثة وأجب عنها قبل التأكيد. نعم أو لا مقبولتان؛ التأجيل متاح فورًا دون إجابات.</p>
        {[
          { key: 'need', text: 'هل هذا المنتج ضرورة ملحة الآن أم رغبة مؤقتة بسبب السهر؟', value: necessary, update: setNecessary },
          { key: 'tomorrow', text: 'هل ستشعر بنفس الشغف وحاجة الشراء له غداً صباحاً؟', value: tomorrow, update: setTomorrow },
          { key: 'budget-impact', text: 'هل تدرك أن هذه القيمة ستخصم من ميزانيتك وستندم عليها لاحقاً؟', value: budgetImpact, update: setBudgetImpact },
        ].map((question, index) => (
          <fieldset className="brake-question" key={question.key} aria-describedby={`awareness-help-${purchase.id}`} disabled={decision.isPending} data-testid={`question-${question.key}-${purchase.id}`}>
            <legend>{index + 1}. {question.text}</legend>
            <div className="brake-choices">
              {['yes', 'no'].map((answer) => (
                <label className={`brake-choice ${question.value === answer ? 'is-selected' : ''}`} key={answer}>
                  <input type="radio" name={`${purchase.id}-${question.key}`} value={answer} checked={question.value === answer} onChange={() => question.update(answer)} />
                  <span>{answer === 'yes' ? 'نعم' : 'لا'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p role="status">{[necessary, tomorrow, budgetImpact].filter(Boolean).length} / 3 إجابات مكتملة{cooling ? ' · التأكيد مقفول حتى انتهاء العداد' : ' · انتهت المهلة'}</p>
      </div>

      {message && <div className="form-message error" role="alert" data-testid={`message-decision-error-${purchase.id}`}>{message}</div>}

      <div className="brake-actions">
        <button type="button" className="brake-postpone" disabled={decision.isPending} onClick={() => decide('postpone')} data-testid={`postpone-${purchase.id}`}>
          <PiggyBank size={17} /> {decision.isPending ? 'جارٍ حفظ القرار...' : 'طق بريك وأجل الشراء 🛡️'}
        </button>
        <button type="button" className="submit-button brake-confirm" disabled={cooling || !necessary || !tomorrow || !budgetImpact || decision.isPending} onClick={() => decide('continue')} data-testid={`continue-${purchase.id}`}>
          <span>{cooling ? 'تأكيد الشراء (مقفول مؤقتاً حتى انتهاء العداد)' : !necessary || !tomorrow || !budgetImpact ? 'تأكيد الشراء (أجب عن الأسئلة الثلاثة أولاً)' : 'تأكيد الشراء'}</span><span className="btn-ico"><ArrowUpLeft size={17} /></span>
        </button>
      </div>
      <p className="brake-fine">عرض تجريبي: لا توجد أموال حقيقية ولا يُخصم أي مبلغ في أي من الخيارين. التأجيل ينهي هذه المحاولة دون شراء.</p>
    </div>
  );
}

/** Controlled modal wrapper. Dismissing never touches the deadline (anchors are tab-level). */
export function PurchaseCooldownDialog({ purchase, open, onOpenChange, onDecided }: {
  purchase: PurchaseSimulation | null; open: boolean; onOpenChange: (open: boolean) => void;
  onDecided?: (result: PurchaseSimulation) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="brake-overlay" />
        <DialogPrimitive.Content className="brake-dialog" dir="rtl" lang="ar" data-testid="dialog-cooldown">
          <div className="brake-scroll">
            <div className="brake-head">
              <div className="brake-badge"><ShieldAlert size={22} /></div>
              <DialogTitle className="brake-title">لحظة! أنت بحاجة إلى فرامل مالية 🛡️</DialogTitle>
            </div>
            <div className="brake-alert" role="alert">اكتشف درع الأمان محاولة شراء قد تندم عليها لاحقًا في ساعات السهر.</div>
            <div className="brake-advisor">
              <span className="brake-advisor-label">🤖 المستشار الودود</span>
              <p>يتجاوز سقفك الليلي المحدد، هل أنت بحاجة حقيقية إليها الآن أم تؤجلها للصبح ببال هادي؟ 💡</p>
            </div>
            <DialogDescription className="brake-note">
              ملاحظة: هذا نص توعوي؛ الدرع يطبّق حاليًا ساعات الحماية فقط ولا يفرض سقفًا ماليًا فعليًا.
            </DialogDescription>
            {purchase && <PurchaseCooldown key={purchase.id} purchase={purchase} onDecided={onDecided} />}
            <DialogPrimitive.Close className="brake-later" data-testid="button-close-cooldown">
              إغلاق مؤقتًا، المهلة مستمرة
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function remaining(purchase: PurchaseSimulation) {
  if (!purchase.cooldownEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(purchase.cooldownEndsAt).getTime() - new Date(purchase.serverTime).getTime()) / 1000));
}
