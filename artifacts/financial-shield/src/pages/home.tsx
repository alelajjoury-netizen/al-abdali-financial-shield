import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreatePurchaseSimulation, useGetDashboard, getGetDashboardQueryKey, type Dashboard, type PurchaseSimulation } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpLeft, Check, CircleHelp, Clock3, CreditCard, Home, Hourglass, LockKeyhole, PiggyBank, Plus, ReceiptText, ShieldCheck, SlidersHorizontal, Store, Wallet } from 'lucide-react';
import { ProtectionSettingsPanel } from '@/components/protection-settings';
import { PurchaseCooldown } from '@/components/purchase-cooldown';
import { clearPurchaseRequest, restorePurchaseRequest, savePurchaseRequest } from '@/lib/purchase-request';

function formatMoney(amount: number, currency: string) {
  const label = currency === 'KWD' ? 'د.ك' : currency;
  return new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount) + ' ' + label;
}

function currencyLabel(currency: string) {
  return currency === 'KWD' ? 'د.ك' : currency;
}

function formatDate(date: string) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat('ar-KW', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(value);
}

function readableStatus(status: string) {
  return ({ simulated: 'محاكاة مسجلة', cooling_down: 'بانتظار القرار · تهدئة', postponed: 'تم تأجيل الشراء' } as Record<string, string>)[status] || status;
}

function readableCardStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'enabled') return 'نشطة · تجريبية';
  if (normalized === 'inactive' || normalized === 'disabled') return 'غير نشطة';
  return status;
}

function reconcileCreation(purchase: PurchaseSimulation, dashboard: Dashboard | undefined) {
  const known = dashboard?.recentSimulations.find((item) => item.id === purchase.id);
  // A creation response can be serialized before another window saves a
  // decision, then delivered after polling has already supplied that decision.
  return purchase.status === 'cooling_down' && known && known.status !== 'cooling_down'
    ? known : purchase;
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const [restored] = useState(restorePurchaseRequest);
  const [pendingRequest, setPendingRequest] = useState(restored.request);
  const submitting = useRef(false);
  const { data: dashboard, isLoading, isError, refetch } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey(), staleTime: 30_000, refetchInterval: 30_000 },
  });
  // React Query retains cached data after a failed refresh. Do not present
  // that account/card snapshot as a currently confirmed financial overview.
  const overview = isError ? undefined : dashboard;
  const createSimulation = useCreatePurchaseSimulation({
    mutation: {
      onSuccess: (purchase) => {
        queryClient.setQueryData<Dashboard>(getGetDashboardQueryKey(), (previous) => {
          const resolved = reconcileCreation(purchase, previous);
          return previous ? {
            ...previous,
            recentSimulations: [resolved, ...previous.recentSimulations.filter((p) => p.id !== purchase.id)].slice(0, 10),
            pendingSimulations: resolved.status === 'cooling_down'
              ? [resolved, ...previous.pendingSimulations.filter((p) => p.id !== purchase.id)]
              : previous.pendingSimulations.filter((p) => p.id !== purchase.id),
          } : previous;
        });
        return queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
    },
  });
  const [merchantName, setMerchantName] = useState(restored.request?.merchantName ?? '');
  const [amount, setAmount] = useState(restored.request ? String(restored.request.amount) : '');
  const [formError, setFormError] = useState(restored.error);
  const [restoreError, setRestoreError] = useState(Boolean(restored.error));
  const [successMessage, setSuccessMessage] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || restoreError) return;
    setFormError('');
    setSuccessMessage('');
    const trimmedName = merchantName.trim();
    const parsedAmount = Number(amount);
    if (!trimmedName || trimmedName.length > 80) {
      setFormError('أدخلي اسم المتجر، بحد أقصى ٨٠ حرفاً.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 10000) {
      setFormError('أدخلي مبلغاً أكبر من صفر ولا يتجاوز ١٠٬٠٠٠ د.ك.');
      return;
    }
    let request = pendingRequest;
    try {
      request ??= {
        idempotencyKey: crypto.randomUUID(), merchantName: trimmedName,
        amount: parsedAmount, currency: 'KWD',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      // Persist before the network call so a reload cannot lose the retry key.
      savePurchaseRequest(request);
    } catch {
      setFormError('تعذر حفظ مفتاح إعادة المحاولة في هذا التبويب. لم نرسل الطلب؛ اسمحي بتخزين الجلسة وحاولي مجددًا.');
      return;
    }
    setPendingRequest(request);
    submitting.current = true;
    createSimulation.mutate(
      { data: request },
      {
        onSuccess: (purchase) => {
          const resolved = reconcileCreation(purchase, queryClient.getQueryData<Dashboard>(getGetDashboardQueryKey()));
          try {
            clearPurchaseRequest();
            setPendingRequest(null);
          } catch {
            setFormError('المحاولة محفوظة، لكن تعذر مسح طلب الإعادة. لا تبدئي محاولة جديدة قبل السماح بتخزين الجلسة.');
            return;
          }
          setMerchantName('');
          setAmount('');
          setSuccessMessage(resolved.status === 'cooling_down'
            ? 'المحاولة محفوظة بموعد التهدئة الأصلي. يمكنك تأجيل الشراء الآن أو الانتظار للإجابة عن أسئلة التوعية.'
            : resolved.status === 'postponed' ? 'استُعيدت المحاولة المؤجلة نفسها. لم يتم إنشاء محاولة أخرى أو خصم أموال.'
            : 'المحاكاة محفوظة. لم يتم إنشاء نسخة مكررة أو خصم أي مبلغ من رصيدك.');
        },
        onError: () => setFormError('لم نتلقَّ تأكيدًا لحفظ المحاولة. أعيدي إرسال الطلب نفسه لاستعادتها دون سجل أو تهدئة جديدة.'),
        onSettled: () => { submitting.current = false; },
      },
    );
  }

  function startNewAttempt() {
    if (submitting.current) return;
    try {
      clearPurchaseRequest();
      setPendingRequest(null);
      setRestoreError(false);
      setMerchantName('');
      setAmount('');
      setFormError('');
      setSuccessMessage('');
      createSimulation.reset();
    } catch {
      setFormError('تعذر مسح الطلب السابق. اسمحي بتخزين الجلسة قبل بدء محاولة جديدة.');
    }
  }

  const postponedSubtotal = overview ? postponedSummary(overview) : null;

  return (
    <div className="app-shell" dir="rtl" lang="ar" id="top">
      <header className="topbar">
        <div className="brand" data-testid="brand-financial-shield">
          <div className="brand-mark"><ShieldCheck size={20} strokeWidth={2} /></div>
          <div>
            <div className="brand-title">بنك العبدلي الدولي</div>
            <div className="brand-caption">مساحة آمنة لقراراتك المالية</div>
          </div>
        </div>
        <div className="demo-pill" data-testid="status-demo-mode"><span /> وضع تجريبي</div>
      </header>

      <main className="page-wrap">
        <section className="welcome-row reveal" aria-label="ترحيب" id="section-overview">
          <div>
            <h1 data-testid="text-welcome">مرحباً، {isLoading ? '...' : (overview?.account.displayName === 'مستخدم الدرع' ? 'عبدالرحمن' : overview?.account.displayName || 'بك')}</h1>
            <p>نظرة هادئة على حسابك ومحاولات الشراء التجريبية.</p>
          </div>
          <div className="today-date">{new Intl.DateTimeFormat('ar-KW', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</div>
        </section>

        <article className="balance-hero reveal" aria-label="الرصيد المتاح">
          <div className="hero-label"><span><Wallet size={15} /> الرصيد المتاح</span><CircleHelp size={14} /></div>
          {isLoading ? <div className="skeleton" style={{ height: 50, width: '62%', margin: '14px 0 8px auto' }} /> : overview ?
            <div className="balance-number" data-testid="text-available-balance">
              <small>{currencyLabel(overview.account.currency)}</small>{new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(overview.account.availableBalance)}
            </div> :
            <div className="overview-unavailable" role="status" data-testid="message-balance-unavailable">
              <strong>الرصيد غير متاح</strong>
              <p>تعذر تحميل بيانات الحساب أو تأكيد الرصيد الحالي.</p>
              <button className="retry-button" type="button" data-testid="button-retry-account" onClick={() => refetch()}>إعادة المحاولة</button>
            </div>}
          <div className="balance-caption">رصيد عرض تجريبي — لا توجد أموال فعلية في الحساب</div>
          <nav className="hero-actions" aria-label="اختصارات">
            <a className="hero-action is-primary" href="#section-purchase" data-testid="link-hero-purchase"><i><Plus size={18} /></i>تسجيل محاولة</a>
            <a className="hero-action" href="#section-settings" data-testid="link-hero-settings"><i><SlidersHorizontal size={17} /></i>ضبط الدرع</a>
            <a className="hero-action" href="#section-history" data-testid="link-hero-history"><i><ReceiptText size={17} /></i>السجل</a>
          </nav>
        </article>

        <section className="savings-card reveal" aria-label="مجموع المحاولات المؤجلة" data-testid="card-postponed-subtotal">
          <div className="savings-icon"><PiggyBank size={22} /></div>
          <div>
            <div className="savings-label">مبالغ أجّلتِها في السجل المحمّل</div>
            {postponedSubtotal ? (
              <div className="savings-value" data-testid="text-postponed-subtotal">
                <small>د.ك</small>{new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(postponedSubtotal.total)}
              </div>
            ) : (
              <div className="savings-value is-muted" data-testid="text-postponed-subtotal-unavailable">{isLoading ? 'جارٍ الحساب...' : 'غير متاح حالياً'}</div>
            )}
          </div>
          <p className="savings-scope">
            {postponedSubtotal
              ? `مجموع ${postponedSubtotal.count} من المحاولات المؤجلة ضمن آخر المحاولات المحمّلة فقط، وليس إجمالي ادخارك. مبالغ تجريبية لم تُخصم أصلاً.`
              : 'يُحسب من المحاولات المؤجلة في السجل الأخير المحمّل فقط عند توفر بيانات الحساب.'}
          </p>
        </section>

        <div className="section-title"><h2>بطاقتك الافتراضية</h2><span>للعرض فقط</span></div>
        <article className="card-panel reveal" data-testid="card-virtual-card">
          <div className="card-top">
            <div>
              <div className="card-label">درع الأمان المالي</div>
              <div className="card-brand"><span className="card-tag">SHIELD</span></div>
            </div>
            <div className="card-chip" aria-hidden="true" />
          </div>
          {overview ? <div className="card-number" dir="ltr">•••• •••• •••• {overview.virtualCard.lastFour}</div> :
            <div className="overview-unavailable" role="status" data-testid="message-card-unavailable">
              {isLoading ? 'جارٍ تحميل بيانات البطاقة' : 'بيانات البطاقة غير متاحة'}
            </div>}
          <div className="card-bottom">
            <div>
              {overview && <><div className="card-holder-label">حامل البطاقة</div><div className="card-holder">{overview.virtualCard.holderName === 'SAFETY SHIELD DEMO' ? 'ABDULRAHMAN ALMUTAIRI' : overview.virtualCard.holderName}</div></>}
            </div>
            <div style={{ display: 'grid', justifyItems: 'end', gap: 6 }}>
              {overview && <span className="card-status">{readableCardStatus(overview.virtualCard.status)}</span>}
              <span className="network-mark">DEMO</span>
            </div>
          </div>
        </article>

        <section className="protection-strip reveal" data-testid="status-protection">
          <div className="protection-copy">
            <div className="protection-icon"><LockKeyhole size={18} /></div>
            <div>
              <div className="protection-title">وضع درع الأمان</div>
              <div className="protection-note">يساعدك على التوقف والتفكير قبل الشراء.</div>
            </div>
          </div>
          <div className={`enabled-state ${dashboard?.protectionEnabled ? '' : 'is-disabled'}`}><i />{isLoading ? 'جارٍ التحقق' : isError ? 'حالة الحماية غير متاحة' : dashboard?.protectionEnabled ? 'الدرع مفعّل · إعداد تجريبي' : 'الدرع غير مفعّل'}</div>
        </section>

        {!!dashboard?.pendingSimulations.length && (
          <section className="panel settings-panel cooldown-section" aria-label="المحاولات قيد التهدئة" id="section-cooldown">
            <h2 className="panel-heading"><Hourglass size={18} /> توقفي لحظة قبل الشراء</h2>
            <p className="settings-hint">محاولات محفوظة للحساب التجريبي المشترك. تغيير الإعدادات لا يلغي مهلة بدأت بالفعل.</p>
            {dashboard.pendingSimulations.map((purchase) => <PurchaseCooldown key={purchase.id} purchase={purchase} />)}
          </section>
        )}

        <div id="section-settings"><ProtectionSettingsPanel /></div>

        <section className="content-grid">
          <article className="panel form-panel" id="section-purchase">
            <h2 className="panel-heading"><Store size={18} /> سجّلي محاولة شراء</h2>
            <p className="panel-subheading">اكتبي تفاصيل مشترياتك لتسجليها كمحاكاة فقط.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label className="field">
                <span className="field-label">اسم المتجر</span>
                <input data-testid="input-merchant-name" disabled={Boolean(pendingRequest) || createSimulation.isPending || restoreError} type="text" autoComplete="off" maxLength={80} placeholder="مثال: متجر الكتب" value={merchantName} onChange={(event) => setMerchantName(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">المبلغ</span>
                <div className="amount-wrap">
                  <input data-testid="input-purchase-amount" disabled={Boolean(pendingRequest) || createSimulation.isPending || restoreError} type="number" inputMode="decimal" min="0.001" max="10000" step="0.001" placeholder="٠٫٠٠٠" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  <span className="amount-unit">د.ك</span>
                </div>
              </label>
              <div className="form-hint"><AlertCircle size={13} /> هذه محاكاة للعرض فقط. لا تتم أي عملية دفع أو خصم أموال.</div>
              {formError && <div className="form-message error" role="alert" data-testid="message-form-error">{formError}</div>}
              {successMessage && <div className="form-message success" role="status" data-testid="message-form-success">{successMessage}</div>}
              <button className="submit-button" data-testid="button-submit-simulation" type="submit" disabled={createSimulation.isPending || isLoading || restoreError}>
                {createSimulation.isPending ? <><span>جارٍ تسجيل المحاكاة...</span><span className="btn-ico"><Clock3 size={17} /></span></> : <><span>{pendingRequest ? 'إعادة إرسال المحاولة نفسها' : 'تسجيل المحاكاة'}</span><span className="btn-ico"><ArrowUpLeft size={17} /></span></>}
              </button>
              {(pendingRequest || restoreError) && <>
                <p className="form-hint">قد تكون المحاولة السابقة محفوظة بالفعل. بدء محاولة جديدة مقصود ينشئ سجلًا مستقلًا؛ لا يلغِي السابقة.</p>
                <button className="retry-button" data-testid="button-new-simulation" type="button" disabled={createSimulation.isPending} onClick={startNewAttempt}>بدء محاولة جديدة بمفتاح جديد</button>
              </>}
            </form>
          </article>

          <article className="panel history-panel" id="section-history">
            <div className="history-head">
              <div>
                <h2 className="panel-heading">محاولات الشراء الأخيرة</h2>
                <p className="panel-subheading">سجلّك التجريبي، دون أي تأثير على الرصيد.</p>
              </div>
              <div className="count-badge">{dashboard?.recentSimulations.length ?? 0} عمليات</div>
            </div>
            {isError ? (
              <div className="error-state" role="alert" data-testid="message-dashboard-error">
                لم نتمكن من تحميل بيانات الحساب. يرجى المحاولة مجدداً.
                <br /><button className="retry-button" type="button" data-testid="button-retry-dashboard" onClick={() => refetch()}>إعادة المحاولة</button>
              </div>
            ) : isLoading ? (
              <div aria-label="جارٍ تحميل المحاولات" aria-busy="true">
                {[1, 2, 3].map((item) => <div className="loading-row" key={item}><div className="skeleton skel-mark" /><div className="skel-lines"><i className="skeleton" /><i className="skeleton" /></div></div>)}
              </div>
            ) : dashboard?.recentSimulations.length ? (
              <div className="simulation-list" data-testid="list-recent-simulations">
                {dashboard.recentSimulations.map((simulation) => (
                  <div className="simulation-row" key={simulation.id} data-testid={`row-simulation-${simulation.id}`}>
                    <div className="simulation-info">
                      <div className="merchant-mark"><Store size={17} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div className="merchant-name" data-testid={`text-merchant-${simulation.id}`}>{simulation.merchantName}</div>
                        <div className="simulation-date">{formatDate(simulation.createdAt)}</div>
                      </div>
                    </div>
                    <div className="simulation-meta">
                      <div className="simulation-amount" data-testid={`text-amount-${simulation.id}`}>{formatMoney(simulation.amount, simulation.currency)}</div>
                      <div className={`simulation-status is-${simulation.status}`}><Check />{readableStatus(simulation.status)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" data-testid="empty-recent-simulations">
                <div className="empty-symbol"><ReceiptText size={22} /></div>
                <strong>لا توجد محاولات مسجلة بعد</strong>
                <p>عند تسجيل محاولة شراء تجريبية، ستظهر تفاصيلها هنا.</p>
              </div>
            )}
          </article>
        </section>

        <footer className="page-foot">
          <span><CreditCard /> بطاقة افتراضية للعرض فقط</span>
          <span><LockKeyhole /> لا يتم التواصل مع البنوك أو تنفيذ المدفوعات</span>
        </footer>
      </main>

      <BottomNav />
    </div>
  );
}

const navItems = [
  { id: 'top', label: 'الرئيسية', icon: Home },
  { id: 'section-purchase', label: 'محاولة', icon: Plus },
  { id: 'section-settings', label: 'الدرع', icon: ShieldCheck },
  { id: 'section-history', label: 'السجل', icon: ReceiptText },
];

function BottomNav() {
  const [active, setActive] = useState('top');
  useEffect(() => {
    const onScroll = () => {
      let current = 'top';
      let nearestTop = -Infinity;
      for (const item of navItems.slice(1)) {
        const el = document.getElementById(item.id);
        const top = el?.getBoundingClientRect().top;
        if (top !== undefined && top < window.innerHeight * 0.45 && top > nearestTop) {
          current = item.id;
          nearestTop = top;
        }
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className="bottom-nav" aria-label="أقسام الصفحة">
      {navItems.map(({ id, label, icon: Icon }) => (
        <a key={id} href={`#${id}`} className={active === id ? 'is-active' : ''} aria-current={active === id ? 'location' : undefined} data-testid={`link-nav-${id}`}>
          <i><Icon size={18} /></i>{label}
        </a>
      ))}
    </nav>
  );
}

// Subtotal of postponed attempts in the loaded dashboard lists only (deduplicated by ID).
function postponedSummary(dashboard: Dashboard) {
  const byId = new Map<string, PurchaseSimulation>();
  for (const item of [...dashboard.pendingSimulations, ...dashboard.recentSimulations]) byId.set(String(item.id), item);
  const postponed = [...byId.values()].filter((item) => item.status === 'postponed');
  return { count: postponed.length, total: postponed.reduce((sum, item) => sum + item.amount, 0) };
}
