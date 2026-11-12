/**
 * ПК-МАСТЕР: global scripts
 * - burger menu
 * - session/user helpers
 * - add-to-cart (POST /api/cart)
 * - header cart badge sync across ALL pages/tabs (BroadcastChannel + localStorage)
 */
(function () {
  'use strict';

  const API = window.PC_API || 'http://localhost:3000';
  window.PC_API = API;

  // ---------- Burger ----------
  const burger = document.getElementById('burger');
  const nav = document.getElementById('mainNav');
  if (burger && nav) burger.addEventListener('click', () => nav.classList.toggle('open'));

  // ---------- Session & User ----------
  function getSessionId() {
    let sid = localStorage.getItem('pc_session');
    if (!sid) {
      sid = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('pc_session', sid);
    }
    window.PC_SESSION = sid;
    return sid;
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem('pc_user') || 'null'); } catch (_) { return null; }
  }

  getSessionId();

  // ---------- Cross-tab cart sync ----------
  const CART_SYNC_KEY = 'pc_cart_sync';
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('pc_cart') : null;

  function setBadge(count) {
    const value = String(Math.max(0, Number(count) || 0));
    document.querySelectorAll('#cartBadge, .cart-badge, [data-cart-badge]').forEach((el) => {
      el.textContent = value;
    });
  }

  function publishCartState(cart) {
    const state = {
      count: Number((cart && cart.count) != null ? cart.count : 0),
      total: Number((cart && cart.total) != null ? cart.total : 0),
      ts: Date.now()
    };
    try { localStorage.setItem(CART_SYNC_KEY, JSON.stringify(state)); } catch (_) {}
    if (channel) channel.postMessage({ type: 'cart:update', state });
    setBadge(state.count);
    document.dispatchEvent(new CustomEvent('pc:cart-updated', { detail: { cart, state } }));
  }

  async function refreshCartBadge() {
    try {
      const res = await fetch(`${API}/api/cart?sessionId=${encodeURIComponent(getSessionId())}`);
      if (!res.ok) return;
      const cart = await res.json();
      publishCartState(cart);
      return cart;
    } catch (_) {
      // backend offline — keep last known badge
    }
  }

  // Listen for updates from other tabs/pages
  window.addEventListener('storage', (e) => {
    if (e.key === CART_SYNC_KEY && e.newValue) {
      try {
        const state = JSON.parse(e.newValue);
        setBadge(state.count || 0);
        document.dispatchEvent(new CustomEvent('pc:cart-updated', { detail: { state } }));
      } catch (_) {}
    }
  });
  if (channel) {
    channel.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'cart:update') {
        const state = e.data.state || {};
        setBadge(state.count || 0);
        document.dispatchEvent(new CustomEvent('pc:cart-updated', { detail: { state } }));
      }
    });
  }

  // Expose API for other scripts
  window.PC = Object.assign(window.PC || {}, {
    API,
    getSessionId,
    getUser,
    setBadge,
    publishCartState,
    refreshCartBadge
  });

  // ---------- Add to cart (event delegation) ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add], [data-add-to-cart], [data-product-id], [data-product-slug]');
    if (!btn) return;
    // ignore non-cart buttons that happen to be inside
    if (!btn.hasAttribute('data-add') && !btn.hasAttribute('data-add-to-cart') && !btn.classList.contains('add-to-cart')) {
      // allow if has product slug/id and explicit intent
      if (!btn.dataset.productSlug && !btn.dataset.productId) return;
    }

    e.preventDefault();
    const productId = btn.dataset.productId ? Number(btn.dataset.productId) : undefined;
    const productSlug = btn.dataset.productSlug || btn.dataset.slug || undefined;
    const productName = (btn.dataset.add || btn.dataset.productName || '').trim() || undefined;

    if (!productId && !productSlug && !productName) return;

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Добавляем...';

    try {
      const res = await fetch(`${API}/api/cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getSessionId(),
          productId,
          productSlug,
          productName,
          qty: 1
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось добавить в корзину');

      publishCartState(data); // updates badge on ALL tabs/pages immediately
      btn.textContent = 'Добавлено ✓';
      btn.style.background = '#00b33f';
    } catch (err) {
      alert(err.message || 'Ошибка при добавлении в корзину');
      btn.textContent = oldText;
    } finally {
      setTimeout(() => {
        btn.textContent = oldText;
        btn.style.background = '';
        btn.disabled = false;
      }, 1200);
    }
  });

  // ---------- Header search ----------
  function initHeaderSearch() {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;
    const btn = Array.from(actions.querySelectorAll('button.icon-btn')).find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label.includes('поиск') || b.textContent.includes('🔍');
    });
    if (!btn || btn.dataset.searchInit) return;
    btn.dataset.searchInit = '1';

    const panel = document.createElement('div');
    panel.className = 'header-search';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="header-search-bar">
        <input type="search" id="headerSearchInput" placeholder="Поиск товаров..." autocomplete="off" />
        <button type="button" class="header-search-close" aria-label="Закрыть">×</button>
      </div>
      <div class="header-search-results" id="headerSearchResults"></div>
    `;
    const headerRow = actions.closest('.header-row') || actions.parentElement;
    headerRow.style.position = 'relative';
    headerRow.appendChild(panel);

    const input = panel.querySelector('#headerSearchInput');
    const results = panel.querySelector('#headerSearchResults');
    const closeBtn = panel.querySelector('.header-search-close');

    let productsCache = null;
    let loading = null;

    async function loadProducts() {
      if (productsCache) return productsCache;
      if (loading) return loading;
      loading = fetch(`${API}/api/products`)
        .then(r => r.ok ? r.json() : [])
        .then(data => { productsCache = Array.isArray(data) ? data : []; return productsCache; })
        .catch(() => { productsCache = []; return productsCache; })
        .finally(() => { loading = null; });
      return loading;
    }

    const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    function renderResults(list, q) {
      if (!q) {
        results.innerHTML = '<div class="hs-hint">Введите название товара</div>';
        return;
      }
      if (!list.length) {
        results.innerHTML = '<div class="hs-hint">Ничего не найдено</div>';
        return;
      }
      results.innerHTML = list.slice(0, 8).map(p => `
        <a class="hs-item" href="product.html?slug=${encodeURIComponent(p.slug || '')}">
          <img src="${esc(p.image_url || '')}" alt="">
          <span class="hs-info">
            <b>${esc(p.name || '')}</b>
            <small>${fmt(p.price)}</small>
          </span>
        </a>
      `).join('') + (list.length > 8 ? `<a class="hs-more" href="catalog.html">Показать все (${list.length}) в каталоге</a>` : '');
    }

    async function doSearch() {
      const q = input.value.trim().toLowerCase();
      if (!q) { renderResults([], ''); return; }
      results.innerHTML = '<div class="hs-hint">Поиск…</div>';
      const products = await loadProducts();
      const filtered = products.filter(p => {
        const hay = [p.name, p.slug, p.description, p.category_name, p.category_slug].join(' ').toLowerCase();
        return hay.includes(q);
      });
      renderResults(filtered, q);
    }

    function open() {
      panel.hidden = false;
      btn.classList.add('active');
      loadProducts();
      renderResults([], '');
      setTimeout(() => input.focus(), 0);
    }
    function close() {
      panel.hidden = true;
      btn.classList.remove('active');
      input.value = '';
      results.innerHTML = '';
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      panel.hidden ? open() : close();
    });
    closeBtn.addEventListener('click', close);
    input.addEventListener('input', () => { clearTimeout(input._t); input._t = setTimeout(doSearch, 200); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        const first = results.querySelector('a.hs-item');
        if (first) { window.location.href = first.getAttribute('href'); }
      }
    });
    document.addEventListener('click', (e) => {
      if (panel.hidden) return;
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
    });
  }

  initHeaderSearch();

  // Initial sync on every page load
  refreshCartBadge();
})();
