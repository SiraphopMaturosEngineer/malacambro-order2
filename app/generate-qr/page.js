'use client';

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import generatePayload from 'promptpay-qr';
import { supabase } from '../../lib/supabaseClient';

const ADULT_PRICE = 229;
const CHILD_PRICE = 129;

// ใส่เบอร์โทร (10 หลัก) หรือเลขบัตรประชาชน (13 หลัก) ที่ผูก PromptPay ของร้าน
// ถ้าเว้นว่างไว้ หน้าบิลจะแสดงแค่ยอดเงิน ไม่แสดง QR
const PROMPTPAY_ID = '';

function billOf(s) {
  const adults = Number(s.adult_count) || 0;
  const children = Number(s.child_count) || 0;
  return { adults, children, total: adults * ADULT_PRICE + children * CHILD_PRICE };
}

const initialForm = {
  tableNumber: '',
  adultCount: '',
  childCount: '',
};

export default function GenerateQrPage() {
  const [form, setForm] = useState(initialForm);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [openSessions, setOpenSessions] = useState([]);
  const [closingId, setClosingId] = useState(null);
  const [tablesError, setTablesError] = useState('');
  const [billSession, setBillSession] = useState(null); // session shown in the bill popup

  async function loadOpenSessions() {
    const { data, error: fetchError } = await supabase
      .from('sessions')
      .select('id, table_number, adult_count, child_count, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (fetchError) {
      setTablesError('โหลดรายการโต๊ะไม่สำเร็จ');
      return;
    }
    setTablesError('');
    setOpenSessions(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadOpenSessions();
  }, []);

  async function handleCloseTable(s) {
    setBillSession(null);
    setClosingId(s.id);
    setTablesError('');

    // .select() so a silent no-op (row already closed, or blocked by RLS)
    // shows up as an empty result instead of a false success.
    const { data, error: closeError } = await supabase
      .from('sessions')
      .update({ status: 'closed' })
      .eq('id', s.id)
      .eq('status', 'open')
      .select('id');

    setClosingId(null);

    if (closeError || !data || data.length === 0) {
      setTablesError(`ปิดโต๊ะ ${s.table_number} ไม่สำเร็จ กรุณาลองใหม่`);
    }
    if (session?.id === s.id) setSession(null);
    loadOpenSessions();
  }

  function handleChange(field) {
    return (e) => {
      const value = e.target.value.replace(/[^0-9]/g, '');
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  function resetForm() {
    setForm(initialForm);
    setSession(null);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const tableNumber = Number(form.tableNumber);
    const adultCount = Number(form.adultCount || 0);
    const childCount = Number(form.childCount || 0);

    if (!tableNumber) {
      setError('กรุณากรอกหมายเลขโต๊ะ');
      return;
    }
    if (adultCount === 0 && childCount === 0) {
      setError('กรุณากรอกจำนวนลูกค้าอย่างน้อย 1 คน');
      return;
    }

    setLoading(true);
    try {
      const { data, error: insertError } = await supabase
        .from('sessions')
        .insert({
          table_number: tableNumber,
          adult_count: adultCount,
          child_count: childCount,
          status: 'open',
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      const orderUrl = `${window.location.origin}/order/${data.id}`;

      setSession({
        id: data.id,
        tableNumber,
        adultCount,
        childCount,
        url: orderUrl,
      });
      loadOpenSessions();
    } catch (err) {
      setError('เปิดโต๊ะไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="card">
        <h1>เปิดโต๊ะ / สร้าง QR</h1>
        <p className="subtitle">หม่าล่าแคมโบร๋ — ผู้ใหญ่ {ADULT_PRICE} บาท · เด็ก {CHILD_PRICE} บาท</p>

        {!session && (
          <form onSubmit={handleSubmit} className="form">
            <label>
              หมายเลขโต๊ะ
              <input
                type="text"
                inputMode="numeric"
                value={form.tableNumber}
                onChange={handleChange('tableNumber')}
                placeholder="เช่น 5"
              />
            </label>

            <label>
              จำนวนผู้ใหญ่
              <input
                type="text"
                inputMode="numeric"
                value={form.adultCount}
                onChange={handleChange('adultCount')}
                placeholder="0"
              />
            </label>

            <label>
              จำนวนเด็ก
              <input
                type="text"
                inputMode="numeric"
                value={form.childCount}
                onChange={handleChange('childCount')}
                placeholder="0"
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button type="submit" className="primary" disabled={loading}>
              {loading ? 'กำลังเปิดโต๊ะ...' : 'เปิดโต๊ะ / สร้าง QR'}
            </button>
          </form>
        )}

        {session && (
          <div className="result">
            <div className="qr-wrap">
              <QRCodeSVG value={session.url} size={220} level="M" />
            </div>

            <div className="details">
              <p>
                <span>โต๊ะ</span>
                <strong>{session.tableNumber}</strong>
              </p>
              <p>
                <span>ผู้ใหญ่</span>
                <strong>{session.adultCount} คน</strong>
              </p>
              <p>
                <span>เด็ก</span>
                <strong>{session.childCount} คน</strong>
              </p>
            </div>

            <p className="url-text">{session.url}</p>

            <button type="button" className="primary" onClick={resetForm}>
              เปิดโต๊ะใหม่
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>โต๊ะที่เปิดอยู่</h2>

        {tablesError && <p className="error">{tablesError}</p>}

        {openSessions.length === 0 && <p className="subtitle">ยังไม่มีโต๊ะที่เปิดอยู่</p>}

        <div className="tables">
          {openSessions.map((s) => {
            const { adults, children, total } = billOf(s);
            return (
              <div key={s.id} className="table-row">
                <div className="table-info">
                  <strong>โต๊ะ {s.table_number}</strong>
                  <span>
                    ผู้ใหญ่ {adults} · เด็ก {children}
                  </span>
                  <span className="total">{total} บาท</span>
                </div>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setBillSession(s)}
                  disabled={closingId === s.id}
                >
                  {closingId === s.id ? 'กำลังปิด...' : 'ปิดโต๊ะ / ชำระเงิน'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {billSession && (
        <div className="overlay" onClick={() => setBillSession(null)}>
          <div className="card bill" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const { adults, children, total } = billOf(billSession);
              return (
                <>
                  <h2>บิลโต๊ะ {billSession.table_number}</h2>

                  <div className="details">
                    <p>
                      <span>
                        ผู้ใหญ่ {adults} × {ADULT_PRICE}
                      </span>
                      <strong>{adults * ADULT_PRICE} บาท</strong>
                    </p>
                    <p>
                      <span>
                        เด็ก {children} × {CHILD_PRICE}
                      </span>
                      <strong>{children * CHILD_PRICE} บาท</strong>
                    </p>
                    <p className="bill-total">
                      <span>ยอดชำระ</span>
                      <strong>{total} บาท</strong>
                    </p>
                  </div>

                  {PROMPTPAY_ID ? (
                    <div className="result">
                      <div className="qr-wrap">
                        <QRCodeSVG
                          value={generatePayload(PROMPTPAY_ID, { amount: total })}
                          size={220}
                          level="M"
                        />
                      </div>
                      <p className="subtitle">สแกนจ่ายผ่าน PromptPay</p>
                    </div>
                  ) : (
                    <p className="subtitle">
                      ยังไม่ได้ตั้งค่า PromptPay (ใส่เลขที่ PROMPTPAY_ID ใน app/generate-qr/page.js)
                    </p>
                  )}

                  <button
                    type="button"
                    className="primary full"
                    onClick={() => handleCloseTable(billSession)}
                  >
                    ยืนยันรับเงินแล้ว · ปิดโต๊ะ
                  </button>
                  <button
                    type="button"
                    className="close-btn full"
                    onClick={() => setBillSession(null)}
                  >
                    ยกเลิก
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          z-index: 50;
          overflow-y: auto;
        }

        .bill {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .bill h2 {
          margin: 0;
        }

        .details .bill-total span,
        .details .bill-total strong {
          font-size: 1.2rem;
          font-weight: 700;
          color: #ffffff;
        }

        .full {
          width: 100%;
          margin-top: 0;
        }

        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          align-items: center;
          justify-content: center;
          background: #150808;
          padding: 1.5rem;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .card {
          width: 100%;
          max-width: 420px;
          background: #1f0d0d;
          border: 1px solid #3a1414;
          border-radius: 16px;
          padding: 1.75rem 1.5rem 2rem;
          color: #f7ece7;
        }

        h1 {
          margin: 0 0 0.25rem;
          font-size: 1.6rem;
          color: #ffffff;
        }

        .subtitle {
          margin: 0 0 1.5rem;
          color: #d99b9b;
          font-size: 0.95rem;
        }

        .form {
          display: flex;
          flex-direction: column;
          gap: 1.1rem;
        }

        label {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          font-size: 0.95rem;
          color: #e8c9c9;
        }

        input {
          font-size: 1.4rem;
          padding: 0.75rem 0.9rem;
          border-radius: 10px;
          border: 1px solid #4a1c1c;
          background: #2a1010;
          color: #ffffff;
          outline: none;
        }

        input:focus {
          border-color: #e34848;
        }

        .primary {
          margin-top: 0.5rem;
          padding: 1rem;
          font-size: 1.15rem;
          font-weight: 600;
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

        .primary:active {
          background: #b81f14;
        }

        .error {
          color: #ff9a9a;
          background: #3a1414;
          padding: 0.6rem 0.8rem;
          border-radius: 8px;
          font-size: 0.9rem;
          margin: 0;
        }

        .result {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.2rem;
        }

        .qr-wrap {
          background: #ffffff;
          padding: 1rem;
          border-radius: 12px;
        }

        .details {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .details p {
          display: flex;
          justify-content: space-between;
          margin: 0;
          padding: 0.5rem 0.75rem;
          background: #2a1010;
          border-radius: 8px;
          font-size: 1rem;
        }

        .details span {
          color: #d99b9b;
        }

        .details strong {
          color: #ffffff;
        }

        .url-text {
          width: 100%;
          word-break: break-all;
          text-align: center;
          font-size: 0.85rem;
          color: #d99b9b;
          background: #2a1010;
          padding: 0.6rem 0.75rem;
          border-radius: 8px;
          margin: 0;
        }

        h2 {
          margin: 0 0 1rem;
          font-size: 1.3rem;
          color: #ffffff;
        }

        .tables {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .table-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.75rem 0.9rem;
          background: #2a1010;
          border-radius: 10px;
        }

        .table-info {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          font-size: 0.9rem;
          color: #d99b9b;
        }

        .table-info strong {
          font-size: 1.15rem;
          color: #ffffff;
        }

        .table-info .total {
          color: #ffffff;
          font-weight: 600;
        }

        .close-btn {
          flex-shrink: 0;
          padding: 0.7rem 0.9rem;
          font-size: 0.95rem;
          font-weight: 600;
          border: 1px solid #d9291c;
          border-radius: 10px;
          background: transparent;
          color: #ff9a9a;
          cursor: pointer;
        }

        .close-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .close-btn:active:not(:disabled) {
          background: #3a1414;
        }
      `}</style>
    </main>
  );
}
