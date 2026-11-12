/**
 * ПК-МАСТЕР: формы (оформление заказа, контакты)
 * - заказ создаётся из корзины в БД (sessionId)
 * - корректная обработка ошибок сервера
 */
(function () {
  'use strict';
  const API = (window.PC && window.PC.API) || window.PC_API || 'http://localhost:3000';

  function getSessionId() {
    if (window.PC && window.PC.getSessionId) return window.PC.getSessionId();
    return localStorage.getItem('pc_session') || '';
  }
  function getUser() {
    if (window.PC && window.PC.getUser) return window.PC.getUser();
    try { return JSON.parse(localStorage.getItem('pc_user') || 'null'); } catch (_) { return null; }
  }
  function getAppliedPromo() {
    try { return JSON.parse(localStorage.getItem('pc_promo') || 'null'); } catch (_) { return null; }
  }
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ---------- Checkout ----------
  const checkout = document.getElementById('checkoutForm');
  if (checkout) {
    const errEl = document.getElementById('formError');
    const okEl = document.getElementById('formSuccess');
    const orderBox = document.querySelector('.order-box');

    async function loadSummary() {
      try {
        const res = await fetch(`${API}/api/cart?sessionId=${encodeURIComponent(getSessionId())}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !orderBox) return;
        if (!data.items || !data.items.length) {
          orderBox.innerHTML = `<h3>Ваш заказ</h3><p style="color:var(--grey)">Корзина пуста. <a href="catalog.html" style="color:var(--green)">Выберите товары</a></p>`;
          return;
        }
        const subtotal = Number(data.total || 0);
        const promo = getAppliedPromo();
        const discount = (promo && promo.discountPercent) ? Math.round(subtotal * Number(promo.discountPercent) / 100 * 100) / 100 : 0;
        const finalTotal = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
        orderBox.innerHTML = `
          <h3>Ваш заказ</h3>
          ${data.items.map(i => `<p>${esc(i.name)} × ${i.qty}</p><p>${fmt(i.lineTotal || i.price * i.qty)}</p>`).join('')}
          ${discount > 0 ? `<p>Скидка (${esc(promo.code)} −${promo.discountPercent}%)</p><p style="color:#ffb347">−${fmt(discount)}</p>` : ''}
          <div class="price big" style="margin-top:12px">${fmt(finalTotal)}</div>
          <p class="small">Нажимая «Подтвердить заказ», вы соглашаетесь с условиями продажи.</p>`;
      } catch (_) { /* ignore */ }
    }
    loadSummary();

    checkout.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      if (okEl) okEl.hidden = true;

      const fd = new FormData(checkout);
      const user = getUser();
      const promo = getAppliedPromo();
      const payload = {
        firstName: String(fd.get('firstName') || '').trim(),
        lastName: String(fd.get('lastName') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        address: String(fd.get('address') || '').trim(),
        sessionId: getSessionId(),
        userId: user ? user.id : null,
        promoCode: promo ? promo.code : null
      };

      if (!payload.firstName || !payload.lastName || !payload.phone || !payload.email || !payload.address) {
        if (errEl) errEl.textContent = 'Заполните обязательные поля (*)';
        return;
      }
      if (!payload.email.includes('@')) {
        if (errEl) errEl.textContent = 'Укажите корректный e-mail';
        return;
      }

      const btn = checkout.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Оформляем...'; }

      try {
        const res = await fetch(`${API}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Ошибка сервера (${res.status})`);

        if (okEl) {
          okEl.textContent = `✅ Заказ #${data.orderId} оформлен на ${fmt(data.total)}!`;
          okEl.hidden = false;
        }
        // sync cart badge (cart cleared on server) and clear promo after successful order
        try { localStorage.removeItem('pc_promo'); } catch (_) {}
        if (window.PC && window.PC.publishCartState) window.PC.publishCartState({ count: 0, total: 0 });
        loadSummary();
      } catch (err) {
        if (errEl) {
          // show real server message; network failure gets a helpful hint
          errEl.textContent = (err && err.message && err.message !== 'Failed to fetch')
            ? err.message
            : 'Не удалось связаться с сервером. Проверьте, что бэкенд запущен: http://localhost:3000';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Подтвердить заказ'; }
      }
    });
  }

  // ---------- Contacts ----------
  const contact = document.getElementById('contactForm');
  if (contact) {
    const errEl = document.getElementById('cError');
    const okEl = document.getElementById('cSuccess');
    contact.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      if (okEl) okEl.hidden = true;
      const payload = {
        name: String(contact.name.value || '').trim(),
        email: String(contact.email.value || '').trim(),
        message: String(contact.message.value || '').trim()
      };
      if (!payload.name || !payload.email.includes('@') || !payload.message) {
        if (errEl) errEl.textContent = 'Заполните все поля корректно';
        return;
      }
      try {
        const res = await fetch(`${API}/api/contacts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
        if (okEl) okEl.hidden = false;
        contact.reset();
      } catch (err) {
        if (errEl) errEl.textContent = (err && err.message && err.message !== 'Failed to fetch')
          ? err.message
          : 'Не удалось связаться с сервером. Проверьте, что бэкенд запущен: http://localhost:3000';
      }
    });
  }
})();
