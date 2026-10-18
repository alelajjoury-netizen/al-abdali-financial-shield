import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreatePurchaseSimulation, useGetDashboard, getGetDashboardQueryKey } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpLeft, Check, CircleHelp, Clock3, CreditCard, LockKeyhole, ReceiptText, ShieldCheck, Store } from 'lucide-react';

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
  return status === 'simulated' ? 'محاكاة مسجلة' : status;
}

function readableCardStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'enabled') return 'نشطة · تجريبية';
  if (normalized === 'inactive' || normalized === 'disabled') return 'غير نشطة';
  return status;
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading, isError, refetch } = useGetDashboard();
  const createSimulation = useCreatePurchaseSimulation({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
    },
  });
  const [merchantName, setMerchantName] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    createSimulation.mutate(
      { data: { merchantName: trimmedName, amount: parsedAmount, currency: 'KWD' } },
      {
        onSuccess: () => {
          setMerchantName('');
          setAmount('');
          setSuccessMessage('تم تسجيل المحاكاة. لم يتم خصم أي مبلغ من رصيدك.');
        },
        onError: () => setFormError('تعذر تسجيل المحاكاة الآن. تحققي من الاتصال وحاولي مرة أخرى.'),
      },
    );
  }

  return (
    <div className="app-shell" dir="rtl" lang="ar">
      <header className="topbar">
        <div className="brand" data-testid="brand-financial-shield">
          <div className="brand-mark"><ShieldCheck size={21} strokeWidth={1.8} /></div>
          <div>
            <div className="brand-title">دِرع الأمان المالي</div>
            <div className="brand-caption">مساحة آمنة لقراراتك المالية</div>
          </div>
        </div>
        <div className="demo-pill" data-testid="status-demo-mode"><span /> وضع تجريبي</div>
      </header>

      <main className="page-wrap">
        <section className="welcome-row" aria-label="ترحيب">
          <div>
            <div className="eyebrow">لوحة حسابك</div>
            <h1 data-testid="text-welcome">مرحباً، {isLoading ? '...' : (dashboard?.account.displayName || 'بك')}</h1>
            <p>نظرة هادئة على حسابك ومحاولات الشراء التجريبية.</p>
          </div>
          <div className="today-date">{new Intl.DateTimeFormat('ar-KW', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</div>
        </section>

        <section className="overview-grid" aria-label="ملخص الحساب والبطاقة">
          <article className="panel balance-panel">
            <div className="section-kicker"><span>الرصيد المتاح</span><CircleHelp size={14} /></div>
            {isLoading ? <div className="skeleton" style={{ height: 48, width: '58%', marginTop: 20 }} /> :
              <div className="balance-number" data-testid="text-available-balance">
                <small>{currencyLabel(dashboard?.account.currency || 'KWD')}</small>{new Intl.NumberFormat('ar-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(dashboard?.account.availableBalance ?? 0)}
              </div>}
            <div className="balance-caption">رصيد عرض تجريبي — لا توجد أموال فعلية في الحساب</div>
          </article>

          <article className="panel card-panel" data-testid="card-virtual-card">
            <div className="card-top">
              <div>
                <div className="card-label">بطاقتك الافتراضية</div>
                <div className="card-holder">{isLoading ? 'جارٍ التحميل' : dashboard?.virtualCard.holderName || '—'}</div>
              </div>
              <div className="card-chip" aria-hidden="true" />
            </div>
            <div className="card-number" dir="ltr">•••• &nbsp;•••• &nbsp;•••• &nbsp;{dashboard?.virtualCard.lastFour || '••••'}</div>
            <div className="card-bottom">
              <span className="card-status">{dashboard?.virtualCard.status ? readableCardStatus(dashboard.virtualCard.status) : 'بطاقة تجريبية'}</span>
              <span className="network-mark">DEMO</span>
            </div>
          </article>
        </section>

        <section className="protection-strip" data-testid="status-protection">
          <div className="protection-copy">
            <div className="protection-icon"><LockKeyhole size={17} /></div>
            <div>
              <div className="protection-title">درع الأمان المالي</div>
              <div className="protection-note">تسجيل تجريبي يساعدك على التوقف والتفكير قبل الشراء.</div>
            </div>
          </div>
          <div className="enabled-state"><i />{dashboard?.protectionEnabled ? 'الحماية مفعّلة' : isLoading ? 'جارٍ التحقق' : 'الحماية غير مفعّلة'}</div>
        </section>

        <section className="content-grid">
          <article className="panel form-panel">
            <h2 className="panel-heading">سجّلي محاولة شراء</h2>
            <p className="panel-subheading">اكتبي تفاصيل مشترياتك لتسجليها كمحاكاة فقط.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label className="field">
                <span className="field-label">اسم المتجر</span>
                <input data-testid="input-merchant-name" type="text" autoComplete="off" maxLength={80} placeholder="مثال: متجر الكتب" value={merchantName} onChange={(event) => setMerchantName(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">المبلغ</span>
                <div className="amount-wrap">
                  <input data-testid="input-purchase-amount" type="number" inputMode="decimal" min="0.001" max="10000" step="0.001" placeholder="٠٫٠٠٠" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  <span className="amount-unit">د.ك</span>
                </div>
              </label>
              <div className="form-hint"><AlertCircle size={13} /> هذه محاكاة للعرض فقط. لا تتم أي عملية دفع أو خصم أموال.</div>
              {formError && <div className="form-message error" role="alert" data-testid="message-form-error">{formError}</div>}
              {successMessage && <div className="form-message success" role="status" data-testid="message-form-success">{successMessage}</div>}
              <button className="submit-button" data-testid="button-submit-simulation" type="submit" disabled={createSimulation.isPending || isLoading}>
                {createSimulation.isPending ? <><Clock3 size={16} /> جارٍ تسجيل المحاكاة...</> : <>تسجيل المحاكاة <ArrowUpLeft size={16} /></>}
              </button>
            </form>
          </article>

          <article className="panel history-panel">
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
                      <div className="simulation-status"><Check />{readableStatus(simulation.status)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" data-testid="empty-recent-simulations">
                <div className="empty-symbol"><ReceiptText size={20} /></div>
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
    </div>
  );
}
