import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetProtectionSettings, useUpdateProtectionSettings,
  getGetProtectionSettingsQueryKey, getGetDashboardQueryKey,
  type ProtectionSettings, type Dashboard,
} from '@workspace/api-client-react';

type SettingsDraft = Omit<ProtectionSettings, 'cooldownMinutes'> & { cooldownMinutes: string };
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

export function ProtectionSettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useGetProtectionSettings({
    query: { queryKey: getGetProtectionSettingsQueryKey(), staleTime: 30_000, refetchInterval: 30_000 },
  });
  const save = useUpdateProtectionSettings();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const values = draft ?? (settings.data ? { ...settings.data, cooldownMinutes: String(settings.data.cooldownMinutes) } : null);

  function change(patch: Partial<SettingsDraft>) {
    if (values) setDraft({ ...values, ...patch });
    setError('');
    setSuccess(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values) return;
    setError('');
    setSuccess(false);
    const cooldownMinutes = Number(values.cooldownMinutes);
    if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 1 || cooldownMinutes > 120) {
      setError('أدخل مدة تهدئة من ١ إلى ١٢٠ دقيقة، دون كسور.');
      return;
    }
    if (values.blockStartHour === values.blockEndHour) {
      setError('يجب أن تختلف ساعة بداية الحظر عن ساعة نهايته.');
      return;
    }
    try {
      const saved = await save.mutateAsync({ data: { ...values, cooldownMinutes } });
      await Promise.all([
        queryClient.cancelQueries({ queryKey: getGetProtectionSettingsQueryKey() }),
        queryClient.cancelQueries({ queryKey: getGetDashboardQueryKey() }),
      ]);
      queryClient.setQueryData(getGetProtectionSettingsQueryKey(), saved);
      queryClient.setQueryData<Dashboard>(getGetDashboardQueryKey(), (previous) =>
        previous ? { ...previous, protectionEnabled: saved.enabled } : previous);
      void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      setDraft(null);
      setSuccess(true);
    } catch {
      setError('تعذّر تأكيد حفظ الإعدادات. بقيت تعديلاتك هنا؛ أعد المحاولة عند عودة الاتصال.');
    }
  }

  return (
    <section className="panel settings-panel" aria-labelledby="protection-settings-heading" data-testid="panel-protection-settings">
      <h2 className="panel-heading" id="protection-settings-heading">إعدادات الحماية العاطفية</h2>
      <p className="panel-subheading">اضبط الدرع وساعات الحظر اليومية ومدة التهدئة. الإعدادات مشتركة للحساب التجريبي.</p>
      {!values ? (
        settings.isError ? (
          <div className="error-state" role="alert">
            تعذّر تحميل إعدادات الحماية. لا يمكن تعديلها قبل تحميل القيم المحفوظة.
            <br /><button className="retry-button" type="button" onClick={() => settings.refetch()}>إعادة تحميل الإعدادات</button>
          </div>
        ) : <p role="status" aria-busy="true">جارٍ تحميل إعدادات الحماية...</p>
      ) : (
        <form onSubmit={submit} noValidate>
          {settings.isError && <p className="form-message error" role="alert">تعذّر تحديث الإعدادات من الخادم؛ هذه آخر قيم تم تحميلها.</p>}
          <fieldset disabled={save.isPending} className="settings-fields">
            <label className="settings-toggle">
              <input type="checkbox" role="switch" checked={values.enabled} onChange={(event) => change({ enabled: event.target.checked })} data-testid="switch-protection" />
              <span>تشغيل الدرع</span>
              <small>{values.enabled ? 'مفعّل' : 'متوقف'}{draft ? ' — لم تُحفظ التعديلات بعد' : ''}</small>
            </label>
            <div className="settings-grid">
              <label className="field">
                <span className="field-label">بداية الحظر</span>
                <select value={values.blockStartHour} onChange={(event) => change({ blockStartHour: Number(event.target.value) })} data-testid="select-block-start">
                  {hours.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">نهاية الحظر</span>
                <select value={values.blockEndHour} onChange={(event) => change({ blockEndHour: Number(event.target.value) })} data-testid="select-block-end">
                  {hours.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">مدة التهدئة بالدقائق</span>
                <input type="number" min={1} max={120} step={1} inputMode="numeric" value={values.cooldownMinutes} onChange={(event) => change({ cooldownMinutes: event.target.value })} data-testid="input-cooldown-minutes" />
              </label>
            </div>
            <p className="settings-hint">بنظام ٢٤ ساعة، حسب التوقيت المحلي للجهاز. تبدأ الفترة عند ساعة البداية وتنتهي عند ساعة النهاية{values.blockStartHour > values.blockEndHour ? ' في اليوم التالي (عبر منتصف الليل)' : ''}. يجب أن تختلف الساعتان.</p>
            <p className="settings-hint">هذه المرحلة تحفظ الإعدادات فقط؛ تطبيق الحظر والتهدئة على محاكاة الشراء سيُضاف لاحقًا. لا توجد مدفوعات حقيقية.</p>
            {error && <div className="form-message error" role="alert" data-testid="message-settings-error">{error}</div>}
            {success && <div className="form-message success" role="status" data-testid="message-settings-success">تم حفظ إعدادات الحماية. ستبقى محفوظة بعد إعادة تحميل الصفحة.</div>}
            <div className="settings-actions">
              <button className="submit-button" type="submit" disabled={!draft || save.isPending} data-testid="button-save-protection">{save.isPending ? 'جارٍ الحفظ...' : 'حفظ إعدادات الحماية'}</button>
              {draft && <button className="retry-button" type="button" onClick={() => { setDraft(null); setError(''); setSuccess(false); }}>إلغاء التعديلات</button>}
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
