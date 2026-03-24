import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, AlertCircle, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { WeChatQrPanel } from '@/components/channels/WeChatQrPanel';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
} from '@/types/channel';
import { usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

interface AgentItem {
  id: string;
  name: string;
}

interface DeleteTarget {
  channelType: string;
  accountId?: string;
}

function removeDeletedTarget(groups: ChannelGroupItem[], target: DeleteTarget): ChannelGroupItem[] {
  if (target.accountId) {
    return groups
      .map((group) => {
        if (group.channelType !== target.channelType) return group;
        return {
          ...group,
          accounts: group.accounts.filter((account) => account.accountId !== target.accountId),
        };
      })
      .filter((group) => group.accounts.length > 0);
  }

  return groups.filter((group) => group.channelType !== target.channelType);
}

export function Channels() {
  const { t } = useTranslation('channels');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // WeChat hero card state
  const [showWechatPanel, setShowWechatPanel] = useState(false);
  const [otherChannelsExpanded, setOtherChannelsExpanded] = useState(false);

  const displayedChannelTypes = getPrimaryChannels();

  const fetchPageData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, agentsRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>('/api/channels/accounts'),
        hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
      ]);

      if (!channelsRes.success) {
        throw new Error(channelsRes.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setChannelGroups(channelsRes.channels || []);
      setAgents(agentsRes.agents || []);
    } catch (fetchError) {
      setError(String(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void fetchPageData();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchPageData]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      void fetchPageData();
    }
  }, [fetchPageData, gatewayStatus.state]);

  const configuredTypes = useMemo(
    () => channelGroups.map((group) => group.channelType),
    [channelGroups],
  );

  const groupedByType = useMemo(() => {
    return Object.fromEntries(channelGroups.map((group) => [group.channelType, group]));
  }, [channelGroups]);

  const allConfiguredGroups = useMemo(() => {
    const known = displayedChannelTypes
      .map((type) => groupedByType[type])
      .filter((group): group is ChannelGroupItem => Boolean(group));
    const unknown = channelGroups.filter((group) => !displayedChannelTypes.includes(group.channelType as ChannelType));
    return [...known, ...unknown];
  }, [channelGroups, displayedChannelTypes, groupedByType]);

  const allUnsupportedTypes = displayedChannelTypes.filter((type) => !configuredTypes.includes(type));

  // WeChat-specific data
  const wechatGroup = groupedByType['wechat'] as ChannelGroupItem | undefined;

  // Other channels (excluding wechat)
  const otherConfiguredGroups = allConfiguredGroups.filter((g) => g.channelType !== 'wechat');
  const otherUnconfiguredTypes = allUnsupportedTypes.filter((type) => type !== 'wechat');

  const handleBindAgent = async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (!agentId) {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'DELETE',
          body: JSON.stringify({ channelType, accountId }),
        });
      } else {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'PUT',
          body: JSON.stringify({ channelType, accountId, agentId }),
        });
      }
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const suffix = deleteTarget.accountId
        ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}`
        : '';
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`, {
        method: 'DELETE',
      });
      setChannelGroups((prev) => removeDeletedTarget(prev, deleteTarget));
      toast.success(deleteTarget.accountId ? t('toast.accountDeleted') : t('toast.channelDeleted'));
      window.setTimeout(() => {
        void fetchPageData();
      }, 1200);
    } catch (deleteError) {
      toast.error(t('toast.configFailed', { error: String(deleteError) }));
    } finally {
      setDeleteTarget(null);
    }
  };

  const createNewAccountId = (channelType: string, existingAccounts: string[]): string => {
    let nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    while (existingAccounts.includes(nextAccountId)) {
      nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return nextAccountId;
  };

  const openModalForChannel = (type: ChannelType, opts: {
    accountId?: string;
    allowExisting?: boolean;
    allowEditAccountId?: boolean;
    existingAccountIds?: string[];
    initialConfigValues?: Record<string, string>;
  } = {}) => {
    setSelectedChannelType(type);
    setSelectedAccountId(opts.accountId);
    setAllowExistingConfigInModal(opts.allowExisting ?? true);
    setAllowEditAccountIdInModal(opts.allowEditAccountId ?? false);
    setExistingAccountIdsForModal(opts.existingAccountIds ?? []);
    setInitialConfigValuesForModal(opts.initialConfigValues);
    setShowConfigModal(true);
  };

  const closeModal = () => {
    setShowConfigModal(false);
    setSelectedChannelType(null);
    setSelectedAccountId(undefined);
    setAllowExistingConfigInModal(true);
    setAllowEditAccountIdInModal(false);
    setExistingAccountIdsForModal([]);
    setInitialConfigValuesForModal(undefined);
  };

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-full p-10 pt-16">
        {/* Page header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-10 shrink-0 gap-4">
          <div>
            <h1
              className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight"
              style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
            >
              {t('wechat.pageTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={() => void fetchPageData()}
              disabled={gatewayStatus.state !== 'running'}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t('refresh')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {/* Gateway warning */}
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">{error}</span>
            </div>
          )}

          {/* WeChat Hero Card */}
          <div className="mb-10 rounded-2xl border border-black/10 dark:border-white/10 bg-[#f3f1e9] dark:bg-card overflow-hidden">
            <div className="p-5">
              {/* Card header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                    <img src={wechatIcon} alt={t('wechat.name')} className="w-[24px] h-[24px] dark:invert" />
                  </div>
                  <div>
                    <h2 className="text-[18px] font-semibold text-foreground">{t('wechat.name')}</h2>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          wechatGroup
                            ? wechatGroup.status === 'connected'
                              ? 'bg-green-500'
                              : wechatGroup.status === 'connecting'
                                ? 'bg-yellow-500 animate-pulse'
                                : wechatGroup.status === 'error'
                                  ? 'bg-destructive'
                                  : 'bg-muted-foreground'
                            : 'bg-muted-foreground',
                        )}
                      />
                      <span className="text-[12px] text-muted-foreground">
                        {wechatGroup ? t('wechat.connected') : t('wechat.notConnected')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Top-right action buttons (when not showing QR panel) */}
                {!showWechatPanel && wechatGroup && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 shadow-none"
                      onClick={() => setShowWechatPanel(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {t('wechat.addAccount')}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget({ channelType: 'wechat' })}
                      title={t('account.deleteChannel')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Close button when QR panel is visible */}
                {showWechatPanel && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                    onClick={() => setShowWechatPanel(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* WeChat QR Panel (when user clicked connect / reconnect) */}
              {showWechatPanel ? (
                <WeChatQrPanel
                  autoStart={true}
                  onSuccess={async () => {
                    await fetchPageData();
                    setShowWechatPanel(false);
                  }}
                  className="py-4"
                />
              ) : wechatGroup ? (
                /* Connected: show accounts */
                <div className="space-y-2">
                  {wechatGroup.accounts.map((account) => {
                    const displayName =
                      account.accountId === 'default' && account.name === account.accountId
                        ? t('account.mainAccount')
                        : account.name;
                    return (
                      <div
                        key={`wechat-${account.accountId}`}
                        className="rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[13px] font-medium text-foreground truncate">
                                {displayName}
                              </p>
                              <div
                                className={cn(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  account.status === 'connected'
                                    ? 'bg-green-500'
                                    : account.status === 'connecting'
                                      ? 'bg-yellow-500 animate-pulse'
                                      : account.status === 'error'
                                        ? 'bg-destructive'
                                        : 'bg-muted-foreground',
                                )}
                              />
                            </div>
                            {account.lastError && (
                              <div className="text-[12px] text-destructive mt-1">{account.lastError}</div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{t('account.bindAgentLabel')}</span>
                            <select
                              className="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-background px-2 text-xs"
                              value={account.agentId || ''}
                              onChange={(event) => {
                                void handleBindAgent('wechat', account.accountId, event.target.value);
                              }}
                            >
                              <option value="">{t('account.unassigned')}</option>
                              {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 shadow-none"
                              onClick={() => setShowWechatPanel(true)}
                            >
                              {t('wechat.reconnect')}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() =>
                                setDeleteTarget({ channelType: 'wechat', accountId: account.accountId })
                              }
                              title={t('account.delete')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Not connected */
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <p className="text-[14px] text-muted-foreground max-w-xs">
                    {t('wechat.notConnectedDesc')}
                  </p>
                  <Button
                    onClick={() => setShowWechatPanel(true)}
                    disabled={gatewayStatus.state !== 'running'}
                    className="rounded-full px-6 shadow-none"
                  >
                    {t('wechat.connect')}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Other Channels — collapsible */}
          {(otherConfiguredGroups.length > 0 || otherUnconfiguredTypes.length > 0) && (
            <div>
              <button
                className="flex items-center gap-2 text-[15px] font-medium text-foreground/70 hover:text-foreground transition-colors mb-4 group"
                onClick={() => setOtherChannelsExpanded((prev) => !prev)}
              >
                {otherChannelsExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {t('wechat.otherChannels')}
                <span className="text-[12px] text-muted-foreground font-normal">
                  ({otherConfiguredGroups.length + otherUnconfiguredTypes.length})
                </span>
              </button>

              {otherChannelsExpanded && (
                <div className="space-y-8">
                  {/* Configured other channels */}
                  {otherConfiguredGroups.length > 0 && (
                    <div className="space-y-4">
                      {otherConfiguredGroups.map((group) => (
                        <div
                          key={group.channelType}
                          className="rounded-2xl border border-black/10 dark:border-white/10 p-4 bg-transparent"
                        >
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                                <ChannelLogo type={group.channelType as ChannelType} />
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-[16px] font-semibold text-foreground truncate">
                                  {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                                </h3>
                                <p className="text-[12px] text-muted-foreground">{group.channelType}</p>
                              </div>
                              <div
                                className={cn(
                                  'w-2 h-2 rounded-full shrink-0',
                                  group.status === 'connected'
                                    ? 'bg-green-500'
                                    : group.status === 'connecting'
                                      ? 'bg-yellow-500 animate-pulse'
                                      : group.status === 'error'
                                        ? 'bg-destructive'
                                        : 'bg-muted-foreground',
                                )}
                              />
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs rounded-full"
                                onClick={() => {
                                  const shouldUseGeneratedAccountId = !usesPluginManagedQrAccounts(group.channelType);
                                  const nextAccountId = shouldUseGeneratedAccountId
                                    ? createNewAccountId(
                                        group.channelType,
                                        group.accounts.map((item) => item.accountId),
                                      )
                                    : undefined;
                                  openModalForChannel(group.channelType as ChannelType, {
                                    accountId: nextAccountId,
                                    allowExisting: false,
                                    allowEditAccountId: shouldUseGeneratedAccountId,
                                    existingAccountIds: group.accounts.map((item) => item.accountId),
                                  });
                                }}
                              >
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                {t('account.add')}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget({ channelType: group.channelType })}
                                title={t('account.deleteChannel')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {group.accounts.map((account) => {
                              const displayName =
                                account.accountId === 'default' && account.name === account.accountId
                                  ? t('account.mainAccount')
                                  : account.name;
                              return (
                                <div
                                  key={`${group.channelType}-${account.accountId}`}
                                  className="rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="text-[13px] font-medium text-foreground truncate">
                                          {displayName}
                                        </p>
                                      </div>
                                      {account.lastError && (
                                        <div className="text-[12px] text-destructive mt-1">
                                          {account.lastError}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">
                                        {t('account.bindAgentLabel')}
                                      </span>
                                      <select
                                        className="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-background px-2 text-xs"
                                        value={account.agentId || ''}
                                        onChange={(event) => {
                                          void handleBindAgent(group.channelType, account.accountId, event.target.value);
                                        }}
                                      >
                                        <option value="">{t('account.unassigned')}</option>
                                        {agents.map((agent) => (
                                          <option key={agent.id} value={agent.id}>
                                            {agent.name}
                                          </option>
                                        ))}
                                      </select>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs rounded-full"
                                        onClick={() => {
                                          void (async () => {
                                            try {
                                              const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
                                              const result = await hostApiFetch<{
                                                success: boolean;
                                                values?: Record<string, string>;
                                              }>(
                                                `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`,
                                              );
                                              openModalForChannel(group.channelType as ChannelType, {
                                                accountId: account.accountId,
                                                allowExisting: true,
                                                initialConfigValues: result.success ? (result.values || {}) : undefined,
                                              });
                                            } catch {
                                              openModalForChannel(group.channelType as ChannelType, {
                                                accountId: account.accountId,
                                                allowExisting: true,
                                              });
                                            }
                                          })();
                                        }}
                                      >
                                        {t('account.edit')}
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        onClick={() =>
                                          setDeleteTarget({
                                            channelType: group.channelType,
                                            accountId: account.accountId,
                                          })
                                        }
                                        title={t('account.delete')}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unconfigured other channels */}
                  {otherUnconfiguredTypes.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      {otherUnconfiguredTypes.map((type) => {
                        const meta = CHANNEL_META[type];
                        return (
                          <button
                            key={type}
                            onClick={() => {
                              openModalForChannel(type, { allowExisting: true });
                            }}
                            className="group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
                              <ChannelLogo type={type} />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-[16px] font-semibold text-foreground truncate">
                                  {meta.name}
                                </h3>
                                {meta.isPlugin && (
                                  <Badge
                                    variant="secondary"
                                    className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                                  >
                                    {t('pluginBadge')}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                                {t(meta.description.replace('channels:', ''))}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showConfigModal && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          accountId={selectedAccountId}
          configuredTypes={configuredTypes}
          allowExistingConfig={allowExistingConfigInModal}
          allowEditAccountId={allowEditAccountIdInModal}
          existingAccountIds={existingAccountIdsForModal}
          initialConfigValues={initialConfigValuesForModal}
          showChannelName={false}
          onClose={closeModal}
          onChannelSaved={async () => {
            await fetchPageData();
            closeModal();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common.confirm', 'Confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

export default Channels;
