'use client';

import { useEffect, useState } from 'react';
import { buttonClassName } from '@/components/ui/Button';
import {
  getCommunicationPreferences,
  setCommunicationPreferences,
  type CommunicationPreferenceRow,
  type CommunicationChannel,
  type CommunicationMessageType,
} from '@/lib/account';

const CHANNEL_LABEL: Record<CommunicationChannel, string> = { SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Email', PUSH: 'Push' };
const MESSAGE_TYPE_LABEL: Record<CommunicationMessageType, string> = {
  ORDER_UPDATES: 'Order updates',
  OFFERS_AND_PROMOTIONS: 'Offers & promotions',
  PRODUCT_RECOMMENDATIONS: 'Product recommendations',
  NEWSLETTER: 'Newsletter',
};
const CHANNELS: CommunicationChannel[] = ['SMS', 'WHATSAPP', 'EMAIL', 'PUSH'];
const MESSAGE_TYPES: CommunicationMessageType[] = ['ORDER_UPDATES', 'OFFERS_AND_PROMOTIONS', 'PRODUCT_RECOMMENDATIONS', 'NEWSLETTER'];

export default function CommunicationPreferencesPage() {
  const [matrix, setMatrix] = useState<CommunicationPreferenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getCommunicationPreferences()
      .then(setMatrix)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your preferences.'));
  }, []);

  function toggle(channel: CommunicationChannel, messageType: CommunicationMessageType) {
    setMatrix((prev) =>
      prev
        ? prev.map((row) => (row.channel === channel && row.messageType === messageType ? { ...row, optedIn: !row.optedIn } : row))
        : prev,
    );
  }

  async function handleSave() {
    if (!matrix) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await setCommunicationPreferences(
        matrix.map(({ channel, messageType, optedIn }) => ({ channel, messageType, optedIn })),
      );
      setMatrix(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg text-ink">Communication Preferences</h2>
      <p className="mt-1 text-sm text-ink-muted">Choose which messages you receive, per channel and message type.</p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {matrix === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {matrix && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-ink">Message type</th>
                {CHANNELS.map((channel) => (
                  <th key={channel} className="p-2 text-center text-ink">
                    {CHANNEL_LABEL[channel]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MESSAGE_TYPES.map((messageType) => (
                <tr key={messageType} className="border-t border-border">
                  <th scope="row" className="p-2 text-left font-normal text-ink">
                    {MESSAGE_TYPE_LABEL[messageType]}
                  </th>
                  {CHANNELS.map((channel) => {
                    const row = matrix.find((r) => r.channel === channel && r.messageType === messageType);
                    if (!row) return <td key={channel} />;
                    return (
                      <td key={channel} className="p-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${CHANNEL_LABEL[channel]} - ${MESSAGE_TYPE_LABEL[messageType]}`}
                          checked={row.optedIn}
                          onChange={() => toggle(channel, messageType)}
                          className="h-5 w-5"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <button type="button" onClick={handleSave} disabled={saving} className={buttonClassName('primary', 'mt-6')}>
            {saving ? 'Saving...' : 'Save preferences'}
          </button>
          {saved && (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              Saved.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
