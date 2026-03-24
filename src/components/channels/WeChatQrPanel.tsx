import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, QrCode, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { buildQrChannelEventName, UI_WECHAT_CHANNEL_TYPE } from '@/lib/channel-alias';
import { CHANNEL_NAMES } from '@/types/channel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

type PanelState = 'idle' | 'loading' | 'qr' | 'success' | 'error';

/** Map a raw error string to a friendly i18n key under the wechat.error.* namespace. */
function mapErrorKey(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('timeout') || s.includes('expired') || s.includes('过期') || s.includes('expire')) {
    return 'wechat.error.timeout';
  }
  if (s.includes('cancel') || s.includes('取消') || s.includes('キャンセル')) {
    return 'wechat.error.cancelled';
  }
  if (
    s.includes('plugin') || s.includes('install') || s.includes('插件') ||
    s.includes('not found') || s.includes('プラグイン')
  ) {
    return 'wechat.error.plugin';
  }
  return 'wechat.error.generic';
}

export interface WeChatQrPanelProps {
  accountId?: string;
  /** Auto-start QR flow on mount (skip the idle/button state) */
  autoStart?: boolean;
  onSuccess?: (data: { accountId?: string }) => void;
  /** When provided, a "skip" button is shown. Label: t('wechat.skip') */
  onSkip?: () => void;
  className?: string;
}

function normalizeQrImageSource(data: { qr?: string; raw?: string }): string | null {
  const qr = typeof data.qr === 'string' ? data.qr.trim() : '';
  if (qr) {
    if (qr.startsWith('data:image') || qr.startsWith('http://') || qr.startsWith('https://')) {
      return qr;
    }
    return `data:image/png;base64,${qr}`;
  }
  const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
  if (!raw) return null;
  if (raw.startsWith('data:image') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return null;
}

export function WeChatQrPanel({ accountId, autoStart, onSuccess, onSkip, className }: WeChatQrPanelProps) {
  const { t } = useTranslation('channels');
  const [state, setState] = useState<PanelState>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string>('wechat.error.generic');
  // Track whether we're mid-flow so we can cancel on unmount
  const activeRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const startQr = useCallback(async () => {
    setState('loading');
    setQrCode(null);
    activeRef.current = true;
    try {
      await hostApiFetch(`/api/channels/${encodeURIComponent(UI_WECHAT_CHANNEL_TYPE)}/start`, {
        method: 'POST',
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
    } catch (err) {
      setErrorKey(mapErrorKey(String(err)));
      setState('error');
      activeRef.current = false;
    }
  }, [accountId]);

  // Auto-start on mount when requested
  useEffect(() => {
    if (autoStart) {
      void startQr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to WeChat QR events for the lifetime of the panel
  useEffect(() => {
    const removeQr = subscribeHostEvent(
      buildQrChannelEventName(UI_WECHAT_CHANNEL_TYPE, 'qr'),
      (...args: unknown[]) => {
        const data = args[0] as { qr?: string; raw?: string };
        const src = normalizeQrImageSource(data);
        if (src) {
          setQrCode(src);
          setState('qr');
        }
      },
    );

    const removeSuccess = subscribeHostEvent(
      buildQrChannelEventName(UI_WECHAT_CHANNEL_TYPE, 'success'),
      (...args: unknown[]) => {
        const data = args[0] as { accountId?: string } | undefined;
        activeRef.current = false;
        setState('success');
        onSuccessRef.current?.(data ?? {});
      },
    );

    const removeError = subscribeHostEvent(
      buildQrChannelEventName(UI_WECHAT_CHANNEL_TYPE, 'error'),
      (...args: unknown[]) => {
        const raw =
          typeof args[0] === 'string'
            ? args[0]
            : String((args[0] as { message?: string } | undefined)?.message || args[0]);
        activeRef.current = false;
        setErrorKey(mapErrorKey(raw));
        setState('error');
      },
    );

    return () => {
      removeQr();
      removeSuccess();
      removeError();
      if (activeRef.current) {
        hostApiFetch(`/api/channels/${encodeURIComponent(UI_WECHAT_CHANNEL_TYPE)}/cancel`, {
          method: 'POST',
          body: JSON.stringify(accountId ? { accountId } : {}),
        }).catch(() => {});
        activeRef.current = false;
      }
    };
  }, [accountId]);

  const primaryButtonClasses = 'rounded-full px-6 shadow-none';
  const outlineButtonClasses =
    'rounded-full px-5 shadow-none border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground';

  if (state === 'idle') {
    return (
      <div className={cn('flex flex-col items-center gap-4 py-6', className)}>
        <p className="text-[14px] text-muted-foreground text-center max-w-xs">
          {t('meta.wechat.description')}
        </p>
        <Button onClick={() => void startQr()} className={primaryButtonClasses}>
          <QrCode className="h-4 w-4 mr-2" />
          {t('wechat.connect')}
        </Button>
        {onSkip && (
          <Button
            variant="ghost"
            onClick={onSkip}
            className="text-[13px] text-muted-foreground hover:text-foreground rounded-full"
          >
            {t('wechat.skip')}
          </Button>
        )}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className={cn('flex flex-col items-center gap-4 py-8', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-[14px] text-muted-foreground">{t('wechat.connecting')}</p>
        {onSkip && (
          <Button
            variant="ghost"
            onClick={onSkip}
            className="text-[13px] text-muted-foreground hover:text-foreground rounded-full mt-2"
          >
            {t('wechat.skip')}
          </Button>
        )}
      </div>
    );
  }

  if (state === 'qr' && qrCode) {
    return (
      <div className={cn('flex flex-col items-center gap-3', className)}>
        <div className="bg-white dark:bg-background p-3 rounded-2xl shadow-sm border border-black/10 dark:border-white/10 inline-block">
          <img
            src={qrCode}
            alt={CHANNEL_NAMES['wechat']}
            className="w-44 h-44 object-contain rounded-xl"
          />
        </div>
        <p className="text-[13px] text-muted-foreground text-center">{t('wechat.scanInstructions')}</p>
        <p className="text-[12px] text-muted-foreground/70 text-center">{t('wechat.qrExpiry')}</p>
        <p className="text-[12px] text-muted-foreground animate-pulse">{t('wechat.waitingForScan')}</p>
        <div className="flex items-center gap-3 mt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void startQr()}
            className="rounded-full text-[12px] h-8 px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 shadow-none"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('wechat.refreshQr')}
          </Button>
          {onSkip && (
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-[13px] text-muted-foreground hover:text-foreground rounded-full h-8 px-3"
            >
              {t('wechat.skip')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className={cn('flex flex-col items-center gap-3 py-6', className)}>
        <CheckCircle className="h-10 w-10 text-green-500" />
        <p className="text-[15px] font-medium text-foreground">{t('wechat.connected')}</p>
      </div>
    );
  }

  // error state
  return (
    <div className={cn('flex flex-col items-center gap-4 py-6', className)}>
      <AlertCircle className="h-8 w-8 text-destructive" />
      <div className="text-center">
        <p className="text-[14px] font-medium text-foreground">{t('wechat.errorTitle')}</p>
        <p className="text-[13px] text-muted-foreground mt-1">{t(errorKey)}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void startQr()} className={primaryButtonClasses}>
          {t('wechat.retry')}
        </Button>
        {onSkip && (
          <Button variant="outline" onClick={onSkip} className={outlineButtonClasses}>
            {t('wechat.skip')}
          </Button>
        )}
      </div>
    </div>
  );
}
