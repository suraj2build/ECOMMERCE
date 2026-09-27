'use client';

import { useEffect, useState } from 'react';
import { getLoyaltyBalance, getLoyaltyLedger, type LoyaltyBalance, type LoyaltyLedgerEntry } from '@/lib/account';

const ENTRY_LABEL: Record<LoyaltyLedgerEntry['type'], string> = {
  EARN: 'Earned',
  REDEEM: 'Redeemed',
  REVERSE: 'Reversed',
  EXPIRE: 'Expired',
  ADJUST: 'Adjusted',
};

export default function LoyaltyPage() {
  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getLoyaltyBalance(), getLoyaltyLedger()])
      .then(([balanceData, ledgerData]) => {
        setBalance(balanceData);
        setLedger(ledgerData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your loyalty points.'));
  }, []);

  return (
    <section>
      <h2 className="font-display text-lg text-ink">Loyalty Points</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {balance === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {balance && (
        <>
          <p className="mt-4 text-2xl font-medium text-ink">{balance.balance} pts</p>
          <p className="text-sm text-ink-muted">
            {balance.tier ? `${balance.tier.name} tier` : 'No tier yet'} - {balance.lifetimeEarnedPoints} lifetime points earned
          </p>

          <h3 className="mt-8 font-display text-base text-ink">History</h3>
          {ledger && ledger.length === 0 ? (
            <p className="mt-6 text-sm text-ink-muted">No loyalty activity yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {ledger?.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between rounded-sm border border-border p-3">
                  <div>
                    <span className="block text-sm text-ink">{entry.reason}</span>
                    <span className="block text-xs text-ink-muted">
                      {ENTRY_LABEL[entry.type]} - {new Date(entry.createdAt).toLocaleDateString()}
                      {entry.expiresAt ? ` - expires ${new Date(entry.expiresAt).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                  <span className={`text-sm font-medium ${entry.pointsDelta >= 0 ? 'text-ink' : 'text-ink-muted'}`}>
                    {entry.pointsDelta >= 0 ? '+' : ''}
                    {entry.pointsDelta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
