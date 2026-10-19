import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpLeft } from 'lucide-react';
import {
  getGetDashboardQueryKey, useDecidePurchaseSimulation, type PurchaseSimulation,
} from '@workspace/api-client-react';

export function PurchaseCooldown({ purchase }: { purchase: PurchaseSimulation }) {
  const client = useQueryClient();
  const [seconds, setSeconds] = useState(() => remaining(purchase));
  const [necessary, setNecessary] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const decision = useDecidePurchaseSimulation();

  useEffect(() => {
    // The server clock anchors the display; changing the device clock cannot skip it.
    const started = performance.now();
    const initial = remaining(purchase);
    const update = () => setSeconds(Math.max(0, initial - Math.floor((performance.now() - started) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [purchase.cooldownEndsAt, purchase.serverTime]);

  function decide(action: 'continue' | 'postpone') {
    setMessage('');
    decision.mutate({
      id: purchase.id,
      data: {
        action,
        ...(action === 'continue' ? { isNecessary: necessary === 'yes', fitsBudget: budget === 'yes' } : {}),
      },
    }, {
      onSuccess: (result) => {
        client.setQueryData(getGetDashboardQueryKey(), (previous: import('@workspace/api-client-react').Dashboard | undefined) =>
          previous ? {
            ...previous,
            pendingSimulations: previous.pendingSimulations.filter((item) => item.id !== result.id),
            recentSimulations: previous.recentSimulations.map((item) => item.id === result.id ? result : item),
          } : previous);
        void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
      onError: (error) => {
        const detail = (error as { data?: { error?: string } }).data?.error;
        setMessage(detail || 'تعذر حفظ القرار. تحققي من الاتصال ثم حاولي مجددًا.');
        void client.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
    });
  }

  return (
    <article className="cooldown-card" data-testid={`cooldown-${purchase.id}`}>
      <h3>{purchase.merchantName} · {new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3 }).format(purchase.amount)} د.ك</h3>
      {seconds > 0 ? (
        <div>
          <p>بدأت هذه المحاولة أثناء ساعات الحظر. خذي وقتًا للتفكير قبل المتابعة.</p>
          <div className="cooldown-clock" role="timer" aria-label="الوقت المتبقي للتهدئة" dir="ltr" data-testid={`timer-${purchase.id}`}>
            {Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}
          </div>
          <p>تنتهي التهدئة في {new Date(purchase.cooldownEndsAt!).toLocaleTimeString('ar-KW')} بتوقيت جهازك. تبقى المهلة محفوظة بعد تحديث الصفحة.</p>
        </div>
      ) : (
        <div>
          <p role="status">انتهت مهلة التهدئة. أجيبي عن السؤالين قبل اتخاذ قرارك.</p>
          <label className="field">
            <span className="field-label">هل هذه المشتريات حاجة ضرورية الآن؟</span>
            <select value={necessary} onChange={(event) => setNecessary(event.target.value)} data-testid={`question-need-${purchase.id}`}>
              <option value="">اختاري إجابة</option><option value="yes">نعم</option><option value="no">لا</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">هل يناسب المبلغ ميزانيتك المخططة؟</span>
            <select value={budget} onChange={(event) => setBudget(event.target.value)} data-testid={`question-budget-${purchase.id}`}>
              <option value="">اختاري إجابة</option><option value="yes">نعم</option><option value="no">لا</option>
            </select>
          </label>
          <p>لا توجد إجابة صحيحة أو خاطئة؛ الهدف اتخاذ قرار واعٍ.</p>
        </div>
      )}
      {message && <div className="form-message error" role="alert">{message}</div>}
      <div className="settings-actions">
        <button type="button" className="submit-button" disabled={seconds > 0 || !necessary || !budget || decision.isPending} onClick={() => decide('continue')} data-testid={`continue-${purchase.id}`}>
          <span>متابعة المحاكاة فقط</span><span className="btn-ico"><ArrowUpLeft size={17} /></span>
        </button>
        <button type="button" className="retry-button" disabled={decision.isPending} onClick={() => decide('postpone')} data-testid={`postpone-${purchase.id}`}>
          تأجيل الشراء
        </button>
      </div>
      <p>التأجيل ينهي هذه المحاولة دون شراء. يمكنك بدء محاولة جديدة لاحقًا. لا تُخصم أموال في أي من الخيارين.</p>
    </article>
  );
}

function remaining(purchase: PurchaseSimulation) {
  return Math.max(0, Math.ceil((new Date(purchase.cooldownEndsAt!).getTime() - new Date(purchase.serverTime).getTime()) / 1000));
}
