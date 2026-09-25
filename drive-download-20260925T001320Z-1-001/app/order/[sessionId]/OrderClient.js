'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const STATUS_LABELS = {
  received: 'รับออเดอร์แล้ว',
  cooking: 'กำลังทำ',
  served: 'เสิร์ฟแล้ว',
};

function normalizeOrder(row) {
  return {
    id: row.id,
    status: String(row.status ?? 'received'),
    createdAt: row.created_at,
    items: Array.isArray(row.items)
      ? row.items.map((entry) => ({
          name: String(entry?.name ?? ''),
          quantity: Number(entry?.quantity) || 0,
        }))
      : [],
  };
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export default function OrderClient({ sessionId }) {
  const [sessionInfo, setSessionInfo] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);

  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [menuError, setMenuError] = useState('');

  const [cart, setCart] = useState({}); // { itemId: { name, quantity } }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');

  const [myOrders, setMyOrders] = useState([]); // this table's orders, newest first

  // Load session info
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoadingSession(true);
      setSessionError('');

      const { data, error } = await supabase
        .from('sessions')
        .select('id, table_number, adult_count, child_count, status')
        .eq('id', sessionId)
        .single();

      if (cancelled) return;

      // Guard against any unexpected shape from Supabase (null, array, or a
      // row missing the fields we need) — never store anything but a plain
      // object with primitive fields in state.
      const isValidRow =
        !error &&
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.status === 'open';

      if (!isValidRow) {
        setSessionError('โต๊ะนี้ปิดแล้วหรือไม่พบข้อมูล');
        setSessionInfo(null);
      } else {
        setSessionInfo({
          id: data.id,
          tableNumber: Number(data.table_number),
          adultCount: Number(data.adult_count) || 0,
          childCount: Number(data.child_count) || 0,
        });
      }
      setLoadingSession(false);
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Load menu (categories + items) once session is confirmed valid
  useEffect(() => {
    if (!sessionInfo) return;

    let cancelled = false;

    async function loadMenu() {
      setMenuError('');

      const { data: categoryRows, error: categoryError } = await supabase
        .from('menu_categories')
        .select('id, name, sort_order')
        .order('sort_order', { ascending: true });

      if (categoryError) {
        if (!cancelled) setMenuError('โหลดเมนูไม่สำเร็จ');
        return;
      }

      const { data: itemRows, error: itemError } = await supabase
        .from('menu_items')
        .select('id, category_id, name');

      if (itemError) {
        if (!cancelled) setMenuError('โหลดเมนูไม่สำเร็จ');
        return;
      }

      if (cancelled) return;

      const safeCategories = Array.isArray(categoryRows) ? categoryRows : [];
      const safeItems = Array.isArray(itemRows) ? itemRows : [];

      const grouped = safeCategories.map((category) => ({
        id: category.id,
        name: String(category.name ?? ''),
        items: safeItems
          .filter((item) => item.category_id === category.id)
          .map((item) => ({ id: item.id, name: String(item.name ?? '') })),
      }));

      setCategories(grouped);
      if (grouped.length > 0) {
        setActiveCategoryId(grouped[0].id);
      }
    }

    loadMenu();
    return () => {
      cancelled = true;
    };
  }, [sessionInfo]);

  // This table's orders + live status updates from the kitchen.
  // Same pattern as the kitchen screen: (re)load on every SUBSCRIBED.
  useEffect(() => {
    if (!sessionInfo) return;

    let cancelled = false;
    const sessionFilter = `session_id=eq.${sessionInfo.id}`;

    async function loadMyOrders() {
      const { data, error } = await supabase
        .from('orders')
        .select('id, items, status, created_at')
        .eq('session_id', sessionInfo.id)
        .order('created_at', { ascending: false });

      if (cancelled || error) return;
      setMyOrders((Array.isArray(data) ? data : []).map(normalizeOrder));
    }

    const channel = supabase
      .channel(`orders-${sessionInfo.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: sessionFilter },
        (payload) => {
          const incoming = normalizeOrder(payload.new);
          setMyOrders((prev) =>
            prev.some((o) => o.id === incoming.id) ? prev : [incoming, ...prev]
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: sessionFilter },
        (payload) => {
          const updated = normalizeOrder(payload.new);
          setMyOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') loadMyOrders();
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionInfo]);

  function changeQuantity(item, delta) {
    setCart((prev) => {
      const current = prev[item.id]?.quantity || 0;
      const nextQuantity = Math.max(0, current + delta);

      if (nextQuantity === 0) {
        const { [item.id]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [item.id]: { name: item.name, quantity: nextQuantity },
      };
    });
  }

  const cartEntries = Object.entries(cart);
  const totalItemCount = cartEntries.reduce((sum, [, v]) => sum + v.quantity, 0);

  async function handleSubmitOrder() {
    if (totalItemCount === 0 || !sessionInfo) return;

    setSubmitting(true);
    setSubmitError('');

    const items = cartEntries.map(([, v]) => ({ name: v.name, quantity: v.quantity }));

    try {
      // The table may have been closed (paid) after this page loaded.
      const { data: current, error: statusError } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionInfo.id)
        .single();

      if (statusError) throw statusError;
      if (current?.status !== 'open') {
        setSessionError('โต๊ะนี้ปิดแล้ว ไม่สามารถสั่งอาหารเพิ่มได้');
        return;
      }

      const { error } = await supabase.from('orders').insert({
        session_id: sessionInfo.id,
        table_number: sessionInfo.tableNumber,
        items,
        status: 'received',
      });

      if (error) throw error;

      setCart({});
      setConfirmMessage('ส่งออเดอร์แล้ว ครัวกำลังเตรียมอาหาร');
      setTimeout(() => setConfirmMessage(''), 4000);
    } catch (err) {
      setSubmitError('ส่งออเดอร์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  }

  const activeCategory = categories.find((c) => c.id === activeCategoryId);
  const showMenu = !loadingSession && !sessionError;

  return (
    <main className={showMenu ? 'page' : 'page center'}>
      {loadingSession && <p className="muted">กำลังโหลดข้อมูลโต๊ะ...</p>}

      {!loadingSession && sessionError && <p className="error-text">{sessionError}</p>}

      {showMenu && sessionInfo && (
        <>
          <header className="header">
            <h1>หม่าล่าแคมโบร๋</h1>
            <p className="table-line">
              โต๊ะ {sessionInfo.tableNumber} · ผู้ใหญ่ {sessionInfo.adultCount} คน · เด็ก{' '}
              {sessionInfo.childCount} คน
            </p>
          </header>

          {menuError && <p className="error-text center-text">{menuError}</p>}

          {categories.length > 0 && (
            <nav className="tabs">
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={category.id === activeCategoryId ? 'tab active' : 'tab'}
                  onClick={() => setActiveCategoryId(category.id)}
                  type="button"
                >
                  {category.name}
                </button>
              ))}
            </nav>
          )}

          <section className="menu-list">
            {activeCategory?.items.map((item) => {
              const quantity = cart[item.id]?.quantity || 0;
              return (
                <div key={item.id} className="menu-item">
                  <span className="item-name">{item.name}</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => changeQuantity(item, -1)}
                      disabled={quantity === 0}
                    >
                      −
                    </button>
                    <span className="qty">{quantity}</span>
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => changeQuantity(item, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
            {activeCategory && activeCategory.items.length === 0 && (
              <p className="muted center-text">ยังไม่มีเมนูในหมวดนี้</p>
            )}
          </section>

          {myOrders.length > 0 && (
            <section className="my-orders">
              <h2>ออเดอร์ของโต๊ะนี้</h2>
              {myOrders.map((order) => (
                <div key={order.id} className="my-order">
                  <div className="my-order-top">
                    <span className="muted">{formatTime(order.createdAt)}</span>
                    <span className={`badge ${order.status}`}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                  <p className="my-order-items">
                    {order.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}
                  </p>
                </div>
              ))}
            </section>
          )}

          {/* spacer so content isn't hidden behind the sticky cart bar */}
          <div className="bottom-spacer" />

          {confirmMessage && <div className="toast">{confirmMessage}</div>}

          <div className="cart-bar">
            {submitError && <p className="error-text small">{submitError}</p>}
            <div className="cart-row">
              <span className="cart-count">{totalItemCount} รายการ</span>
              <button
                type="button"
                className="primary"
                onClick={handleSubmitOrder}
                disabled={totalItemCount === 0 || submitting}
              >
                {submitting ? 'กำลังส่ง...' : 'ส่งออเดอร์เข้าครัว'}
              </button>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #150808;
          color: #f7ece7;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding-bottom: 1rem;
        }

        .page.center {
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 2rem 1.5rem;
        }

        .muted {
          color: #d99b9b;
        }

        .center-text {
          text-align: center;
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
          padding: 0.5rem 0.75rem;
          margin: 0 1rem 0.5rem;
        }

        .header {
          padding: 1.5rem 1.25rem 1rem;
          border-bottom: 1px solid #3a1414;
        }

        .header h1 {
          margin: 0 0 0.35rem;
          font-size: 1.4rem;
          color: #ffffff;
        }

        .table-line {
          margin: 0;
          color: #d99b9b;
          font-size: 0.95rem;
        }

        .tabs {
          display: flex;
          gap: 0.5rem;
          overflow-x: auto;
          padding: 1rem 1.25rem 0.5rem;
          -webkit-overflow-scrolling: touch;
        }

        .tab {
          flex: 0 0 auto;
          padding: 0.6rem 1rem;
          border-radius: 999px;
          border: 1px solid #4a1c1c;
          background: #1f0d0d;
          color: #e8c9c9;
          font-size: 0.95rem;
          white-space: nowrap;
          cursor: pointer;
        }

        .tab.active {
          background: #d9291c;
          border-color: #d9291c;
          color: #ffffff;
          font-weight: 600;
        }

        .menu-list {
          padding: 0.5rem 1.25rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .menu-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #1f0d0d;
          border: 1px solid #3a1414;
          border-radius: 12px;
          padding: 0.85rem 1rem;
        }

        .item-name {
          font-size: 1.05rem;
          color: #ffffff;
          padding-right: 0.75rem;
        }

        .stepper {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-shrink: 0;
        }

        .step-btn {
          width: 2.4rem;
          height: 2.4rem;
          border-radius: 10px;
          border: none;
          background: #d9291c;
          color: #ffffff;
          font-size: 1.4rem;
          line-height: 1;
          cursor: pointer;
        }

        .step-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .qty {
          min-width: 1.5rem;
          text-align: center;
          font-size: 1.15rem;
          font-weight: 600;
        }

        .my-orders {
          padding: 1.5rem 1.25rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }

        .my-orders h2 {
          margin: 0 0 0.25rem;
          font-size: 1.1rem;
          color: #ffffff;
        }

        .my-order {
          background: #1f0d0d;
          border: 1px solid #3a1414;
          border-radius: 12px;
          padding: 0.75rem 1rem;
        }

        .my-order-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.9rem;
        }

        .my-order-items {
          margin: 0.4rem 0 0;
          font-size: 0.95rem;
          color: #e8c9c9;
        }

        .badge {
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
          background: #3a1414;
          color: #ff9a9a;
        }

        .badge.cooking {
          background: #3a2408;
          color: #e8c48a;
        }

        .badge.served {
          background: #0f2a14;
          color: #8fd49c;
        }

        .bottom-spacer {
          height: 6rem;
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 6.5rem;
          transform: translateX(-50%);
          background: #2a1010;
          border: 1px solid #4a1c1c;
          color: #ffffff;
          padding: 0.75rem 1.25rem;
          border-radius: 10px;
          font-size: 0.95rem;
          text-align: center;
          max-width: 90%;
          z-index: 20;
        }

        .cart-bar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          background: #1f0d0d;
          border-top: 1px solid #3a1414;
          padding: 0.75rem 1.25rem 1rem;
          z-index: 10;
        }

        .cart-row {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .cart-count {
          color: #d99b9b;
          font-size: 0.95rem;
          flex-shrink: 0;
        }

        .primary {
          flex: 1;
          padding: 1rem;
          font-size: 1.1rem;
          font-weight: 600;
          border: none;
          border-radius: 12px;
          background: #d9291c;
          color: #ffffff;
          cursor: pointer;
        }

        .primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .primary:active:not(:disabled) {
          background: #b81f14;
        }
      `}</style>
    </main>
  );
}
