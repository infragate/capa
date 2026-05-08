import { useState, useCallback, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVariables, useSaveVariables } from '../hooks';
import { Spinner } from '../../../components/common/Spinner';
import { Alert } from '../../../components/common/Alert';

interface VariablesFormProps {
  projectId: string;
  returnUrl: string | null;
}

export function VariablesForm({ projectId, returnUrl }: VariablesFormProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useVariables(projectId);
  const saveMutation = useSaveVariables(projectId);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const variables: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        variables[key] = value as string;
      }

      try {
        await saveMutation.mutateAsync(variables);
        setMessage({ text: t('success.saved'), type: 'success' });
        if (returnUrl) {
          setTimeout(() => {
            window.location.href = returnUrl;
          }, 1500);
        }
      } catch (err) {
        setMessage({
          text: `${t('errors.saveFailed')}: ${(err as Error).message}`,
          type: 'error',
        });
      }
    },
    [saveMutation, t, returnUrl],
  );

  if (isLoading) return <Spinner className="py-8" />;
  if (error || !data?.required?.length) return null;

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="text-base font-medium text-text-primary">{t('projects:variables.title')}</h2>
      </div>
      <p className="mb-6 text-[13px] leading-relaxed text-text-secondary">
        {t('projects:variables.description')}
      </p>

      {message && (
        <Alert
          type={message.type}
          autoDismissMs={message.type === 'success' ? 3000 : undefined}
          onDismiss={() => setMessage(null)}
        >
          {message.text}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {data.required.map((varName) => (
            <VariableField
              key={varName}
              name={varName}
              defaultValue={data.values?.[varName] || ''}
            />
          ))}
        </div>
        <div className="mt-6">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="rounded-sm bg-accent-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-[var(--btn-disabled-bg)] disabled:text-[var(--btn-disabled-text)]"
          >
            {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function VariableField({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label
        htmlFor={`var-${name}`}
        className="mb-2 block text-[13px] font-medium text-text-primary"
      >
        {name}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          id={`var-${name}`}
          name={name}
          defaultValue={defaultValue}
          placeholder={`Enter ${name}`}
          required
          className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 pr-10 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm border-0 bg-transparent text-text-secondary transition-colors hover:bg-border-primary hover:text-text-primary cursor-pointer"
          aria-label={visible ? 'Hide value' : 'Show value'}
        >
          {visible ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
        </button>
      </div>
    </div>
  );
}
