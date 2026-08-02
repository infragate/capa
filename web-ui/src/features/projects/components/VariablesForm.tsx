import { useMemo, useState, useCallback, type FormEvent } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVariables, useSaveVariables, usePutVariable, useDeleteVariable } from '../hooks';
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
  const putMutation = usePutVariable(projectId);
  const deleteMutation = useDeleteVariable(projectId);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [newName, setNewName] = useState('');

  const names = useMemo(() => {
    const set = new Set<string>([
      ...(data?.required || []),
      ...(data?.catalog || []),
    ]);
    return Array.from(set).sort();
  }, [data]);

  const requiredSet = useMemo(() => new Set(data?.required || []), [data]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const variables: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (key.startsWith('__')) continue;
        variables[key] = value as string;
      }

      try {
        await saveMutation.mutateAsync(variables);
        setMessage({ text: t('success.saved'), type: 'success' });
        if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
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
  if (error) {
    return (
      <div id="variables-section" className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
        <Alert type="error">{(error as Error).message}</Alert>
      </div>
    );
  }

  return (
    <div id="variables-section" className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
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
          {names.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t('projects:variables.empty')}</p>
          ) : (
            names.map((varName) => (
              <VariableField
                key={varName}
                name={varName}
                defaultValue={data?.values?.[varName] || ''}
                referenced={requiredSet.has(varName)}
                onDelete={() => {
                  if (confirm(t('projects:variables.confirmDelete', { name: varName }))) {
                    deleteMutation.mutate(varName);
                  }
                }}
                deleting={deleteMutation.isPending}
              />
            ))
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border-secondary pt-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('projects:variables.newName')}
            className="min-w-0 flex-1 rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
          />
          <button
            type="button"
            disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || putMutation.isPending}
            onClick={async () => {
              try {
                await putMutation.mutateAsync({ name: newName.trim(), value: '' });
                setNewName('');
              } catch (err) {
                setMessage({ text: (err as Error).message, type: 'error' });
              }
            }}
            className="inline-flex items-center gap-1 rounded-sm border border-border-tertiary px-3 py-2 text-xs cursor-pointer hover:bg-hover-bg disabled:opacity-50"
          >
            <Plus size={14} />
            {t('projects:variables.add')}
          </button>
        </div>

        {names.length > 0 && (
          <div className="mt-6">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-sm bg-accent-primary px-4 py-2 text-sm font-medium text-white cursor-pointer disabled:opacity-50"
            >
              {saveMutation.isPending ? t('actions.saving') : t('actions.save')}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function VariableField({
  name,
  defaultValue,
  referenced,
  onDelete,
  deleting,
}: {
  name: string;
  defaultValue: string;
  referenced: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation('projects');
  const [show, setShow] = useState(false);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label htmlFor={`var-${name}`} className="font-mono text-xs font-medium text-text-primary">
          {name}
        </label>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] ${
            referenced
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'bg-bg-tertiary text-text-tertiary'
          }`}
        >
          {referenced ? t('variables.referenced') : t('variables.unused')}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title={t('variables.delete')}
          className="ml-auto rounded-sm p-1 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="relative">
        <input
          id={`var-${name}`}
          name={name}
          type={show ? 'text' : 'password'}
          defaultValue={defaultValue}
          autoComplete="off"
          className="w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-3 py-2 pr-10 font-mono text-sm text-text-primary"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}
