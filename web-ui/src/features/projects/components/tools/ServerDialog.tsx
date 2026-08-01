import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Server } from '../../../../types/api';
import { useAppendCapability, useUpdateCapability } from '../../hooks';
import { capaIdErrorMessage, sanitizeCapaIdInput } from '../../../../lib/ids';
import { KeyValueEditor } from './KeyValueEditor';

function pairsToRecord(pairs: Array<{ key: string; value: string }>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (!k) continue;
    out[k] = p.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function recordToPairs(
  record: Record<string, string> | null | undefined,
): Array<{ key: string; value: string }> {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function serverHasAdvanced(server: Server): boolean {
  return !!(
    server.displayName ||
    server.description ||
    (server.headers && Object.keys(server.headers).length > 0) ||
    (server.env && Object.keys(server.env).length > 0) ||
    server.cwd ||
    server.tlsSkipVerify ||
    server.oauth2
  );
}

export function ServerDialog({
  projectId,
  open,
  onOpenChange,
  server,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: Server | null;
}) {
  const { t } = useTranslation('projects');
  const isEdit = !!server;
  const [mode, setMode] = useState<'http' | 'stdio'>('http');
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [cmd, setCmd] = useState('');
  const [args, setArgs] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [cwd, setCwd] = useState('');
  const [tlsSkipVerify, setTlsSkipVerify] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthAuthUrl, setOauthAuthUrl] = useState('');
  const [oauthTokenUrl, setOauthTokenUrl] = useState('');
  const [oauthScopes, setOauthScopes] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');
  const [oauthPkce, setOauthPkce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appendMutation = useAppendCapability(projectId);
  const updateMutation = useUpdateCapability(projectId);
  const busy = appendMutation.isPending || updateMutation.isPending;

  function resetForm() {
    setMode('http');
    setId('');
    setUrl('');
    setCmd('');
    setArgs('');
    setDisplayName('');
    setDescription('');
    setHeaders([]);
    setEnv([]);
    setCwd('');
    setTlsSkipVerify(false);
    setAdvancedOpen(false);
    setOauthClientId('');
    setOauthClientSecret('');
    setOauthAuthUrl('');
    setOauthTokenUrl('');
    setOauthScopes('');
    setOauthRedirectUri('');
    setOauthPkce(false);
    setError(null);
  }

  function loadServer(s: Server) {
    const isHttp = !!s.url;
    setMode(isHttp ? 'http' : 'stdio');
    setId(s.id);
    setUrl(s.url || '');
    setCmd(s.cmd || '');
    setArgs((s.args || []).join(' '));
    setDisplayName(s.displayName || '');
    setDescription(s.description || '');
    setHeaders(recordToPairs(s.headers));
    setEnv(recordToPairs(s.env));
    setCwd(s.cwd || '');
    setTlsSkipVerify(!!s.tlsSkipVerify);
    setOauthClientId(s.oauth2?.clientId || '');
    setOauthClientSecret(s.oauth2?.clientSecret || '');
    setOauthAuthUrl(s.oauth2?.authorizationUrl || '');
    setOauthTokenUrl(s.oauth2?.tokenUrl || '');
    setOauthScopes((s.oauth2?.scopes || []).join(' '));
    setOauthRedirectUri(s.oauth2?.redirectUri || '');
    setOauthPkce(!!s.oauth2?.pkce);
    setAdvancedOpen(serverHasAdvanced(s));
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    if (server) loadServer(server);
    else resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server?.id]);

  function buildEntry(): Record<string, unknown> | null {
    const idErr = capaIdErrorMessage(id, t);
    if (idErr) {
      setError(idErr);
      return null;
    }
    const def: Record<string, unknown> =
      mode === 'http'
        ? { url: url.trim() }
        : {
            cmd: cmd.trim(),
            args: args
              .split(/\s+/)
              .map((a) => a.trim())
              .filter(Boolean),
          };

    if (mode === 'http') {
      const headerMap = pairsToRecord(headers);
      if (headerMap) def.headers = headerMap;
      if (tlsSkipVerify) def.tlsSkipVerify = true;

      const scopes = oauthScopes
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const oauth2: Record<string, unknown> = {};
      if (oauthClientId.trim()) oauth2.clientId = oauthClientId.trim();
      if (oauthClientSecret.trim()) oauth2.clientSecret = oauthClientSecret.trim();
      if (oauthAuthUrl.trim()) oauth2.authorizationUrl = oauthAuthUrl.trim();
      if (oauthTokenUrl.trim()) oauth2.tokenUrl = oauthTokenUrl.trim();
      if (scopes.length) oauth2.scopes = scopes;
      if (oauthRedirectUri.trim()) oauth2.redirectUri = oauthRedirectUri.trim();
      if (oauthPkce) oauth2.pkce = true;
      if (Object.keys(oauth2).length > 0) def.oauth2 = oauth2;
    } else {
      const envMap = pairsToRecord(env);
      if (envMap) def.env = envMap;
      if (cwd.trim()) def.cwd = cwd.trim();
    }

    const entry: Record<string, unknown> = {
      id: id.trim(),
      type: 'mcp',
      def,
      displayName: displayName.trim() || null,
      description: description.trim() || null,
    };
    return entry;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const entry = buildEntry();
    if (!entry) return;
    try {
      if (isEdit && server) {
        await updateMutation.mutateAsync({
          section: 'servers',
          entryId: server.id,
          patch: entry,
        });
      } else {
        await appendMutation.mutateAsync({ section: 'servers', entry });
      }
      onOpenChange(false);
      resetForm();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[min(90vh,720px)] w-[min(560px,92vw)] flex-col rounded-lg border border-border-primary bg-bg-secondary p-5 shadow-lg">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-base font-medium text-text-primary">
              {isEdit ? t('actions.editServer') : t('actions.addServer')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mb-3 flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setMode('http')}
              className={`rounded-sm px-3 py-1.5 text-xs cursor-pointer ${
                mode === 'http' ? 'bg-accent-primary/15 text-accent-primary' : 'bg-bg-tertiary text-text-secondary'
              }`}
            >
              HTTP
            </button>
            <button
              type="button"
              onClick={() => setMode('stdio')}
              className={`rounded-sm px-3 py-1.5 text-xs cursor-pointer ${
                mode === 'stdio' ? 'bg-accent-primary/15 text-accent-primary' : 'bg-bg-tertiary text-text-secondary'
              }`}
            >
              stdio
            </button>
          </div>

          {error && <p className="mb-3 shrink-0 text-xs text-error-text">{error}</p>}

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <label className="block text-xs text-text-secondary">
                {t('actions.serverId')}
                <input
                  value={id}
                  onChange={(e) => setId(sanitizeCapaIdInput(e.target.value))}
                  className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                />
              </label>
              {mode === 'http' ? (
                <label className="block text-xs text-text-secondary">
                  URL
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://… or ${API_URL}"
                    className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                  />
                </label>
              ) : (
                <>
                  <label className="block text-xs text-text-secondary">
                    Command
                    <input
                      value={cmd}
                      onChange={(e) => setCmd(e.target.value)}
                      className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                    />
                  </label>
                  <label className="block text-xs text-text-secondary">
                    Args
                    <input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="arg1 arg2"
                      className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                    />
                  </label>
                </>
              )}

              <div className="rounded-sm border border-border-tertiary">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs font-medium text-text-secondary hover:bg-hover-bg cursor-pointer"
                >
                  <ChevronRight
                    size={14}
                    className="ui-chevron"
                    data-open={advancedOpen ? 'true' : 'false'}
                  />
                  {t('actions.serverAdvanced')}
                </button>
                {advancedOpen && (
                  <div className="ui-panel-enter space-y-3 border-t border-border-tertiary px-2.5 py-3">
                    <label className="block text-xs text-text-secondary">
                      {t('actions.serverDisplayName')}
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                      />
                    </label>
                    <label className="block text-xs text-text-secondary">
                      {t('actions.serverDescription')}
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        className="mt-1 w-full resize-y rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary"
                      />
                    </label>

                    {mode === 'http' ? (
                      <>
                        <div>
                          <div className="mb-1.5 text-xs text-text-secondary">{t('actions.serverHeaders')}</div>
                          <KeyValueEditor
                            pairs={headers}
                            onChange={setHeaders}
                            keyLabel={t('actions.serverKvKey')}
                            valueLabel={t('actions.serverKvValue')}
                            addLabel={t('actions.serverAddPair')}
                          />
                        </div>
                        <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tlsSkipVerify}
                            onChange={(e) => setTlsSkipVerify(e.target.checked)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="text-text-primary">{t('actions.serverTlsSkipVerify')}</span>
                            <span className="mt-0.5 block text-[11px] text-text-tertiary">
                              {t('actions.serverTlsSkipVerifyHint')}
                            </span>
                          </span>
                        </label>

                        <div className="space-y-2 border-t border-border-secondary pt-3">
                          <div className="text-xs font-medium text-text-secondary">{t('actions.serverOauth')}</div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthClientId')}
                              <input
                                value={oauthClientId}
                                onChange={(e) => setOauthClientId(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthClientSecret')}
                              <input
                                type="password"
                                value={oauthClientSecret}
                                onChange={(e) => setOauthClientSecret(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary sm:col-span-2">
                              {t('actions.serverOauthAuthUrl')}
                              <input
                                value={oauthAuthUrl}
                                onChange={(e) => setOauthAuthUrl(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary sm:col-span-2">
                              {t('actions.serverOauthTokenUrl')}
                              <input
                                value={oauthTokenUrl}
                                onChange={(e) => setOauthTokenUrl(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthScopes')}
                              <input
                                value={oauthScopes}
                                onChange={(e) => setOauthScopes(e.target.value)}
                                placeholder={t('actions.serverOauthScopesHint')}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                            <label className="block text-xs text-text-secondary">
                              {t('actions.serverOauthRedirectUri')}
                              <input
                                value={oauthRedirectUri}
                                onChange={(e) => setOauthRedirectUri(e.target.value)}
                                className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
                              />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                            <input
                              type="checkbox"
                              checked={oauthPkce}
                              onChange={(e) => setOauthPkce(e.target.checked)}
                            />
                            {t('actions.serverOauthPkce')}
                          </label>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <div className="mb-1.5 text-xs text-text-secondary">{t('actions.serverEnv')}</div>
                          <KeyValueEditor
                            pairs={env}
                            onChange={setEnv}
                            keyLabel={t('actions.serverKvKey')}
                            valueLabel={t('actions.serverKvValue')}
                            addLabel={t('actions.serverAddPair')}
                          />
                        </div>
                        <label className="block text-xs text-text-secondary">
                          {t('actions.serverCwd')}
                          <input
                            value={cwd}
                            onChange={(e) => setCwd(e.target.value)}
                            placeholder="/path/to/workdir"
                            className="mt-1 w-full rounded-sm border border-border-tertiary bg-bg-tertiary px-2.5 py-2 font-mono text-sm text-text-primary"
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 shrink-0 border-t border-border-secondary pt-3">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-sm bg-accent-primary px-3 py-2 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {isEdit ? t('actions.saveServer') : t('actions.add')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
