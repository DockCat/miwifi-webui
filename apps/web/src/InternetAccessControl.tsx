/**
 * Internet-access control UI (Task 0006): confirmation dialog + action
 * button reflecting current state. The only v1 mutation.
 */
import { useState } from 'react';
import { api, ApiError } from './api.js';
import { useI18n } from './i18n-context.js';

export interface InternetAccessControlProps {
  readonly routerId: string;
  readonly deviceId: string;
  readonly internetAccess: boolean;
  readonly canControl: boolean;
  readonly onChanged: (blocked: boolean | null) => void;
}

export function InternetAccessControl({
  routerId,
  deviceId,
  internetAccess,
  canControl,
  onChanged
}: InternetAccessControlProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = internetAccess
        ? await api.blockDevice(routerId, deviceId)
        : await api.unblockDevice(routerId, deviceId);
      onChanged(result.state === 'blocked');
      setConfirming(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === 'readback_mismatch') {
        setError(t('status.unknown'));
        onChanged(null);
      } else {
        setError(t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!canControl) {
    return <span className="muted">—</span>;
  }

  return (
    <span className="access-control">
      <span className={`badge ${internetAccess ? 'is-online' : 'is-offline'}`}>
        {internetAccess ? 'Internet: allowed' : 'Internet: blocked'}
      </span>
      <button
        className="link-button"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {internetAccess ? 'Block Internet' : 'Allow Internet'}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      {confirming && (
        <span className="confirm-inline" role="dialog" aria-label="confirm mutation">
          <span>
            {internetAccess ? 'Block this device’s Internet?' : 'Restore Internet access?'}
          </span>
          <button className="confirm-yes" disabled={busy} onClick={() => void act()}>
            {t('common.save')}
          </button>
          <button className="link-button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      )}
    </span>
  );
}
