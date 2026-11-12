/**
 * ПК-МАСТЕР: Profile page
 * - fetch user details + saved cart + orders from /api/profile
 * - stays in sync with cart updates across tabs
 */
(function () {
  'use strict';

  const API = (window.PC && window.PC.API) || window.PC_API || 'http://localhost:3000';
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function getUser() {
    if (window.PC && window.PC.getUser) return window.PC.getUser();
    try { return JSON.parse(localStorage.getItem('pc_user') || 'null'); } catch (_) { return null; }
  }
  function getSessionId() {
    if (window.PC && window.PC.getSessionId) return window.PC.getSessionId();
    return localStorage.getItem('pc_session') || '';
  }

  const authBox = document.getElementById('profileAuth');
  const content = document.getElementById('profileContent');
  const userEl = document.getElementById('profileUser');
  const cartEl = document.getElementById('profileCart');
  const cartTotalEl = document.getElementById('profileCartTotal');
  const cartCountEl = document.getElementById('profileCartCount');
  const ordersEl = document.getElementById('profileOrders');

  async function loadProfile() {
    const user = getUser();
    if (!user) {
      if (authBox) authBox.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (authBox) authBox.hidden = true;
    if (content) content.hidden = false;

    const params = new URLSearchParams({
      userId: user.id || '',
      sessionId: getSessionId()
    });

    let data;
    try {
      const res = await fetch(`${API}/api/profile?${params.toString()}`);
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки профиля');
    } catch (err) {
      if (userEl) userEl.innerHTML = `<p style="color:#ff6b6b">${esc(err.message)}</p>`;
      return;
    }

    const u = data.user || user;
    if (userEl) {
      userEl.innerHTML = `
        <div><b>Имя:</b> ${esc((u.first_name || u.firstName || '') + ' ' + (u.last_name || u.lastName || ''))}</div>
        <div><b>Email:</b> ${esc(u.email || '—')}</div>
        <div><b>Телефон:</b> ${esc(u.phone || '—')}</div>
      `;
    }

    const cart = data.cart || { items: [], total: 0, count: 0 };
    if (cartCountEl) cartCountEl.textContent = cart.count ? `(${cart.count})` : '';
    if (cartTotalEl) cartTotalEl.textContent = fmt(cart.total);

    if (cartEl) {
      if (!cart.items || !cart.items.length) {
        cartEl.innerHTML = '<p style="color:var(--grey)">Корзина пуста</p>';
      } else {
        cartEl.innerHTML = cart.items.map((i) => `
          <div class="rv-item" style="display:flex;justify-content:space-between;gap:12px;align-items:center">
            <div>
              <b>${esc(i.name)}</b>
              <div style="color:var(--grey);font-size:14px">${fmt(i.price)} × ${i.qty}</div>
            </div>
            <div style="font-weight:700">${fmt(i.lineTotal)}</div>
          </div>
        `).join('');
      }
    }

    if (window.PC && window.PC.publishCartState) window.PC.publishCartState(cart);

    const orders = data.orders || [];
    if (ordersEl) {
      if (!orders.length) {
        ordersEl.innerHTML = '<p style="color:var(--grey)">Заказов пока нет</p>';
      } else {
        ordersEl.innerHTML = orders.map((o) => `
          <div class="rv-item">
            <div style="display:flex;justify-content:space-between"><b>Заказ #${esc(o.id)}</b><span>${esc(o.status || 'new')}</span></div>
            <div style="color:var(--grey);font-size:14px">${fmt(o.total)} · ${new Date(o.created_at).toLocaleDateString('ru-RU')}</div>
          </div>
        `).join('');
      }
    }
  }

  // keep profile in sync with cart changes from other tabs/pages
  window.addEventListener('storage', (e) => { if (e.key === 'pc_cart_sync') loadProfile(); });
  if ('BroadcastChannel' in window) {
    const ch = new BroadcastChannel('pc_cart');
    ch.addEventListener('message', (e) => { if (e.data && e.data.type === 'cart:update') loadProfile(); });
  }

  loadProfile();
})();
