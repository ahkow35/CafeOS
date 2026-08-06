'use client';

import { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';

/**
 * Lets a signed-in user mint a one-time Telegram link code and shows the exact
 * command to send the bot. Replaces the old (insecure) phone-number linking.
 */
export default function TelegramLinkButton({ isLinked = false }: { isLinked?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getCode() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/telegram-link', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? 'Could not generate a link code. Please try again.');
        return;
      }
      setCode(data.code);
    } catch {
      setError('Could not generate a link code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Send size={18} />
        <strong>Telegram notifications</strong>
        {isLinked && <span className="badge badge-success" style={{ marginLeft: 'auto' }}><CheckCircle2 size={12} /> Linked</span>}
      </div>
      {code ? (
        <div>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>
            In Telegram, open the CafeOS notifications bot and send this message:
          </p>
          <code
            style={{
              display: 'inline-block', padding: '8px 12px', borderRadius: '8px',
              background: 'var(--color-surface, #f3f4f6)', fontSize: '16px', fontWeight: 700, letterSpacing: '1px',
            }}
          >
            /link {code}
          </code>
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted, #6b7280)', marginTop: '8px' }}>
            This code expires in 10 minutes and can be used once.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted, #6b7280)', marginBottom: '12px' }}>
            {isLinked
              ? 'Your private chat is linked for alerts and secure PIN recovery. Generate a code only if you want to link a different chat.'
              : 'Link a private chat to receive alerts and securely recover a forgotten PIN.'}
          </p>
          <button className="btn btn-primary" onClick={getCode} disabled={loading}>
            {loading ? 'Generating…' : isLinked ? 'Relink Telegram' : 'Get link code'}
          </button>
        </>
      )}
      {error && <p style={{ fontSize: '13px', color: '#ef4444', marginTop: '8px' }}>{error}</p>}
    </div>
  );
}
