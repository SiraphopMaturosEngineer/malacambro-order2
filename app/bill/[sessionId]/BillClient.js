'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const ADULT_PRICE = 229;
const CHILD_PRICE = 129;

function formatMoney(n) {
  return Number(n).toLocaleString('th-TH');
}

function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

export default function BillClient({ sessionId }) {
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [summaryItems, setSummaryItems] = useState([]); // [{ name, quantity }]

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoading(true);
      setLoadError('');

      // Try to read closed_at too; if that column doesn't exist yet in this
      // project's sessions table, fall back to the columns we know exist.
      let { data, error } = await supabase
        .from('sessions')
        .select('id, table_number, adult_count, child_count, status, closed_at')
        .eq('id', sessionId)
        .single();

      if (error) {
        const fallback = await supabase
          .from('sessions')
          .select('id, table_number, adult_count, child_count, status')
          .eq('id', sessionId)
          .single();
        data = fallback.data;
        error = fallback.error;
      }

      if (cancelled) return;

      const isValidRow =
        !error && data && typeof data === 'object' && !Array.isArray(data);

      if (!isValidRow) {
        setLoadError('ไม่พบข้อมูลโต๊ะนี้');
        setSessionInfo(null);
      } else {
        setSessionInfo({
          id: data.id,
          tableNumber: Number(data.table_number),
          adultCount: Number(data.adult_count) || 0,
          childCount: Number(data.child_count) || 0,
          status: String(data.status ?? 'open'),
          closedAt: data.closed_at ?? null,
        });
      }
      setLoading(false);
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionInfo) return;

    let cancelled = false;

    async function loadOrderSummary() {
      const { data, error } = await supabase
        .from('orders')
        .select('items')
        .eq('session_id', sessionInfo.id);

      if (cancelled || error) return;

      const totals = new Map();
      (Array.isArray(data) ? data : []).forEach((order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        items.forEach((entry) => {
          const name = String(entry?.name ?? '');
          const quantity = Number(entry?.quantity) || 0;
          if (!name) return;
          totals.set(name, (totals.get(name) || 0) + quantity);
        });
      });

      setSummaryItems(
        Array.from(totals.entries()).map(([name, quantity]) => ({ name, quantity }))
      );
    }

    loadOrderSummary();
    return () => {
      cancelled = true;
    };
  }, [sessionInfo]);

  async function handleCloseTable() {
    if (!sessionInfo || sessionInfo.status === 'closed' || closing) return;

    setClosing(true);
    setCloseError('');

    const nowIso = new Date().toISOString();

    // Try to record closed_at; if the column isn't there, retry with just status.
    let { error } = await supabase
      .from('sessions')
      .update({ status: 'closed', closed_at: nowIso })
      .eq('id', sessionInfo.id);

    let closedAtToStore = nowIso;

    if (error) {
      const fallback = await supabase
        .from('sessions')
        .update({ status: 'closed' })
        .eq('id', sessionInfo.id);
      error = fallback.error;
      closedAtToStore = null;
    }

    if (error) {
      setCloseError('ปิดโต๊ะไม่สำเร็จ กรุณาลองใหม่');
      setClosing(false);
      return;
    }

    setSessionInfo((prev) => ({ ...prev, status: 'closed', closedAt: closedAtToStore }));
    setConfirmMessage('ปิดโต๊ะแล้ว ขอบคุณที่ใช้บริการ');
    setClosing(false);

    // Best-effort notification — a failure here must never affect the
    // table-closing flow above, which has already succeeded.
    try {
      const total = sessionInfo.adultCount * ADULT_PRICE + sessionInfo.childCount * CHILD_PRICE;
      await fetch('/api/notify-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableNumber: sessionInfo.tableNumber,
          adultCount: sessionInfo.adultCount,
          childCount: sessionInfo.childCount,
          total,
        }),
      });
    } catch {
      // Ignore — closing the table already succeeded above.
    }
  }

  if (loading) {
    return (
      <main className="page center">
        <p className="muted">กำลังโหลดข้อมูลโต๊ะ...</p>
        <style jsx>{pageStyles}</style>
      </main>
    );
  }

  if (loadError || !sessionInfo) {
    return (
      <main className="page center">
        <p className="error-text">{loadError || 'ไม่พบข้อมูลโต๊ะนี้'}</p>
        <style jsx>{pageStyles}</style>
      </main>
    );
  }

  const adultSubtotal = sessionInfo.adultCount * ADULT_PRICE;
  const childSubtotal = sessionInfo.childCount * CHILD_PRICE;
  const grandTotal = adultSubtotal + childSubtotal;
  const isClosed = sessionInfo.status === 'closed';

  return (
    <main className="page">
      <div className="card">
        <h1>เรียกเก็บเงิน · โต๊ะ {sessionInfo.tableNumber}</h1>

        <div className="lines">
          <div className="line">
            <span>ผู้ใหญ่ {sessionInfo.adultCount} คน x {ADULT_PRICE} บาท</span>
            <span>{formatMoney(adultSubtotal)} บาท</span>
          </div>
          <div className="line">
            <span>เด็ก {sessionInfo.childCount} คน x {CHILD_PRICE} บาท</span>
            <span>{formatMoney(childSubtotal)} บาท</span>
          </div>
        </div>

        <div className="total">
          <span>ยอดสุทธิ</span>
          <span className="total-amount">{formatMoney(grandTotal)} บาท</span>
        </div>

        {summaryItems.length > 0 && (
          <div className="summary">
            <p className="summary-title">รายการที่สั่งทั้งหมด (อ้างอิง ไม่รวมในยอดเงิน)</p>
            <ul>
              {summaryItems.map((item, idx) => (
                <li key={idx}>
                  <span>{item.name}</span>
                  <span>x{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isClosed ? (
          <p className="closed-text">
            โต๊ะนี้ปิดไปแล้ว
            {sessionInfo.closedAt ? ` เมื่อ ${formatDateTime(sessionInfo.closedAt)}` : ''}
          </p>
        ) : (
          <>
            {confirmMessage && <p className="confirm-text">{confirmMessage}</p>}
            {closeError && <p className="error-text small">{closeError}</p>}
            <button
              type="button"
              className="primary"
              onClick={handleCloseTable}
              disabled={closing}
            >
              {closing ? 'กำลังปิดโต๊ะ...' : 'ปิดโต๊ะ'}
            </button>
          </>
        )}
      </div>

      <style jsx>{pageStyles}</style>
    </main>
  );
}

const pageStyles = `
  .page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #150808;
    padding: 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .page.center {
    text-align: center;
  }

  .muted {
    color: #d99b9b;
  }

  .card {
    width: 100%;
    max-width: 460px;
    background: #1f0d0d;
    border: 1px solid #3a1414;
    border-radius: 16px;
    padding: 1.75rem 1.5rem 2rem;
    color: #f7ece7;
  }

  h1 {
    margin: 0 0 1.25rem;
    font-size: 1.5rem;
    color: #ffffff;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .line {
    display: flex;
    justify-content: space-between;
    font-size: 1.05rem;
    color: #e8c9c9;
    background: #2a1010;
    padding: 0.6rem 0.85rem;
    border-radius: 10px;
  }

  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    background: #2a1010;
    border: 1px solid #4a1c1c;
    border-radius: 12px;
    padding: 1rem 1rem;
    margin-bottom: 1.25rem;
  }

  .total span:first-child {
    font-size: 1.1rem;
    color: #d99b9b;
  }

  .total-amount {
    font-size: 2.1rem;
    font-weight: 700;
    color: #ffffff;
  }

  .summary {
    margin-bottom: 1.5rem;
  }

  .summary-title {
    font-size: 0.85rem;
    color: #d99b9b;
    margin: 0 0 0.5rem;
  }

  .summary ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .summary li {
    display: flex;
    justify-content: space-between;
    font-size: 0.95rem;
    color: #e8c9c9;
    padding: 0.4rem 0.7rem;
    background: #150808;
    border-radius: 8px;
  }

  .primary {
    width: 100%;
    padding: 1.1rem;
    font-size: 1.2rem;
    font-weight: 700;
    border: none;
    border-radius: 12px;
    background: #d9291c;
    color: #ffffff;
    cursor: pointer;
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .primary:active:not(:disabled) {
    background: #b81f14;
  }

  .confirm-text {
    color: #9be89b;
    background: #143a1a;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    text-align: center;
    margin-bottom: 1rem;
  }

  .closed-text {
    color: #d99b9b;
    background: #2a1010;
    padding: 1rem;
    border-radius: 10px;
    text-align: center;
    font-size: 1.05rem;
  }

  .error-text {
    color: #ff9a9a;
    background: #3a1414;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 1rem;
  }

  .error-text.small {
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
`;
