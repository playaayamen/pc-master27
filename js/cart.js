/**
 * ПК-МАСТЕР: корзина (v3)
 *
 * Что делает:
 *  - читает корзину из БД:   GET    /api/cart?sessionId=...
 *  - меняет количество:      PATCH  /api/cart/:id   { qty }
 *  - удаляет позицию:        DELETE /api/cart/:id
 *  - проверяет промокод:     GET    /api/promo?code=...
 *
 * Кнопки +/−/× обрабатываются ДВУМЯ независимыми способами:
 *  1) inline onclick="PCCart.act(this,event)" прямо в разметке строки;
 *  2) резервный слушатель на document (фаза перехвата).
 * Срабатывает ровно один из них (защита через флаг события + блокировка
 * повторного запроса по той же позиции), поэтому кнопки работают даже
 * если какой-то сторонний скрипт гасит всплытие событий.
 */
(function () {
  'use strict';

  var VERSION = 'v3';
  console.log('[cart] ' + VERSION + ' loaded @ ' + location.href);

  var API = window.PC_API || 'http://localhost:3000';
  var SESSION_KEY = 'pc_session';
  var PROMO_KEY = 'pc_promo';

  // ---------- утилиты ----------
  function $(id) { return document.getElementById(id); }

  function getSessionId() {
    var sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(SESSION_KEY, sid);
    }
    window.PC_SESSION = sid;
    return sid;
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function fmt(n) { return round2(n).toLocaleString('ru-RU') + ' ₽'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function plural(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'товар';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'товара';
    return 'товаров';
  }

  // ---------- элементы страницы ----------
  var listEl = $('cartItems');
  if (!listEl) {
    console.warn('[cart] на странице нет #cartItems — скрипт остановлен');
    return;
  }

  var totalEl = $('cartTotal');
  var countEl = $('cartCount');
  var subtotalEl = $('cartSubtotal');
  var subtotalRow = $('cartSubtotalRow');
  var discountEl = $('cartDiscount');
  var discountRow = $('cartDiscountRow');
  var promoLabelEl = $('cartPromoLabel');
  var promoInput = $('promoInput');
  var promoBtn = $('promoBtn');
  var promoMsg = $('promoMsg');

  // ---------- состояние ----------
  var currentCart = { items: [], total: 0, count: 0 };
  var pending = {};   // itemId -> true, пока запрос в полёте
  var loading = false;

  // ---------- промокод ----------
  function getPromo() {
    try { return JSON.parse(localStorage.getItem(PROMO_KEY) || 'null'); } catch (e) { return null; }
  }
  function setPromo(p) {
    try {
      if (p && p.code) localStorage.setItem(PROMO_KEY, JSON.stringify(p));
      else localStorage.removeItem(PROMO_KEY);
    } catch (e) { /* приватный режим */ }
  }
  function setPromoMsg(text, isError) {
    if (!promoMsg) return;
    promoMsg.textContent = text || '';
    promoMsg.style.color = isError ? '#ff6b6b' : '#00b33f';
  }

  // ---------- всплывающее уведомление ----------
  var toastTimer = null;
  function toast(message, isError) {
    var t = $('pcToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pcToast';
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.className = 'pc-toast' + (isError ? ' pc-toast-error' : '');
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 3000);
  }

  // ---------- HTTP ----------
  function request(method, url, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var fullUrl = API + url;
    console.log('[cart] ' + method + ' ' + fullUrl, body || '');

    return fetch(fullUrl, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
        if (!res.ok) {
          var msg = (data && data.error) || ('Ошибка сервера (' + res.status + ')');
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  // ---------- отрисовка ----------
  function updateSummary(cart) {
    var subtotal = round2(cart && cart.total);
    var count = Math.max(0, Math.round(num(cart && cart.count)));
    var promo = getPromo();
    var discount = 0;

    if (promo && num(promo.discountPercent) > 0 && subtotal > 0) {
      discount = round2(subtotal * num(promo.discountPercent) / 100);
    }
    var total = Math.max(0, round2(subtotal - discount));

    if (countEl) countEl.textContent = count + ' ' + plural(count);
    if (totalEl) totalEl.textContent = fmt(total);
    if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
    if (discountEl) discountEl.textContent = fmt(discount);
    if (promoLabelEl) promoLabelEl.textContent = promo && promo.code ? promo.code + ' −' + promo.discountPercent + '%' : '';

    var showDiscount = !!(promo && discount > 0);
    if (subtotalRow) subtotalRow.hidden = !showDiscount;
    if (discountRow) discountRow.hidden = !showDiscount;

    window.PC_CART_STATE = { count: count, subtotal: subtotal, discount: discount, total: total };

    if (window.PC && typeof window.PC.publishCartState === 'function') {
      window.PC.publishCartState(window.PC_CART_STATE);
    } else {
      var badges = document.querySelectorAll('#cartBadge');
      for (var i = 0; i < badges.length; i++) badges[i].textContent = String(count);
    }
  }

  function rowHtml(item) {
    var stock = Math.max(0, Math.round(num(item.stock)));
    var qty = Math.max(1, Math.round(num(item.qty)));
    var stockColor = stock > 5 ? 'var(--grey)' : '#ffb347';
    var stockNote = 'В наличии: ' + stock + ' шт.';

    return '' +
      '<div class="cart-row" data-item-id="' + esc(item.id) + '" data-stock="' + stock + '">' +
        '<img src="' + esc(item.imageUrl || '') + '" alt="' + esc(item.name) + '" loading="lazy">' +
        '<div class="cart-name">' +
          '<b>' + esc(item.name) + '</b>' +
          '<small style="color:' + stockColor + '">' + esc(stockNote) + '</small>' +
        '</div>' +
        '<div class="cart-price">' + fmt(item.price) + '</div>' +
        '<div class="qty">' +
          '<button class="q-btn minus" type="button" data-act="dec" aria-label="Уменьшить"' +
            ' onclick="return window.PCCart && PCCart.act(this, event)">−</button>' +
          '<span class="q-val" data-qty>' + qty + '</span>' +
          '<button class="q-btn plus" type="button" data-act="inc" aria-label="Увеличить"' +
            ' onclick="return window.PCCart && PCCart.act(this, event)">+</button>' +
        '</div>' +
        '<div class="cart-sum">' + fmt(item.lineTotal) + '</div>' +
        '<button class="del" type="button" data-act="delete" aria-label="Удалить"' +
          ' onclick="return window.PCCart && PCCart.act(this, event)">×</button>' +
      '</div>';
  }

  function render(cart) {
    currentCart = cart || { items: [], total: 0, count: 0 };
    var items = currentCart.items || [];
    pending = {};

    if (!items.length) {
      listEl.innerHTML =
        '<div class="cart-empty">Корзина пуста.<br>' +
        '<a href="catalog.html" class="btn btn-primary" style="margin-top:16px;display:inline-block">Перейти в каталог</a>' +
        '</div>';
      updateSummary(currentCart);
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) html += rowHtml(items[i]);
    listEl.innerHTML = html;

    updateSummary(currentCart);
  }

  function renderError(message) {
    listEl.innerHTML =
      '<div class="cart-error">Не удалось загрузить корзину: ' + esc(message) +
      '<br><small>Проверьте, что бэкенд запущен: ' + esc(API) + '/health</small></div>';
  }

  // ---------- операции ----------
  function load() {
    if (loading) return Promise.resolve(currentCart);
    loading = true;
    return request('GET', '/api/cart?sessionId=' + encodeURIComponent(getSessionId()))
      .then(function (cart) {
        render(cart);
        return cart;
      })
      .catch(function (err) {
        console.error('[cart] load failed:', err);
        renderError(err.message);
        toast('Не удалось загрузить корзину: ' + err.message, true);
        throw err;
      })
      .then(function (cart) { loading = false; return cart; },
            function (err) { loading = false; throw err; });
  }

  function changeQty(itemId, qty) {
    if (pending[itemId]) return;
    pending[itemId] = true;
    setRowBusy(itemId, true);

    request('PATCH', '/api/cart/' + encodeURIComponent(itemId), {
      qty: qty,
      sessionId: getSessionId()
    }).then(function (cart) {
      render(cart);
    }).catch(function (err) {
      pending[itemId] = false;
      setRowBusy(itemId, false);
      toast(err.message, true);
      load().catch(function () {});
    });
  }

  function removeItem(itemId) {
    if (pending[itemId]) return;
    pending[itemId] = true;
    setRowBusy(itemId, true);

    request('DELETE', '/api/cart/' + encodeURIComponent(itemId))
      .then(function (cart) {
        render(cart);
        toast('Товар удалён из корзины');
      })
      .catch(function (err) {
        pending[itemId] = false;
        setRowBusy(itemId, false);
        toast(err.message, true);
        load().catch(function () {});
      });
  }

  function setRowBusy(itemId, isBusy) {
    var row = listEl.querySelector('.cart-row[data-item-id="' + itemId + '"]');
    if (row) row.classList.toggle('is-busy', !!isBusy);
  }

  // ---------- обработка кнопок ----------
  function findRow(btn) {
    return btn && btn.closest ? btn.closest('.cart-row[data-item-id]') : null;
  }

  /**
   * Единая точка обработки клика по +/−/×.
   * Возвращает false, чтобы ссылка/форма (если кнопка внутри них) не сработала.
   */
  function act(btn, e) {
    if (!btn) return false;

    // второй обработчик (inline + делегированный) не должен сработать повторно
    if (e) {
      if (e.__pcCartHandled) return false;
      e.__pcCartHandled = true;
      e.preventDefault();
      e.stopPropagation();
    }

    var row = findRow(btn);
    if (!row) {
      console.warn('[cart] клик по кнопке вне строки корзины');
      return false;
    }

    var actName = btn.getAttribute('data-act');
    var itemId = row.getAttribute('data-item-id');
    if (!actName || !itemId) return false;

    var stock = Math.round(num(row.getAttribute('data-stock')));
    var qtyEl = row.querySelector('[data-qty]');
    var qty = Math.round(num(qtyEl ? qtyEl.textContent : 0));

    console.log('[cart] click', actName, 'item', itemId, 'qty', qty, 'stock', stock);

    if (actName === 'delete') {
      removeItem(itemId);
      return false;
    }

    if (actName === 'inc') {
      if (stock > 0 && qty + 1 > stock) {
        toast('На складе осталось ' + stock + ' шт.', true);
        return false;
      }
      changeQty(itemId, qty + 1);
      return false;
    }

    if (actName === 'dec') {
      if (qty <= 1) {
        // минус на единице = удалить позицию (иначе кнопка «не работает»)
        removeItem(itemId);
        return false;
      }
      changeQty(itemId, qty - 1);
      return false;
    }

    return false;
  }

  // резервный делегированный обработчик (фаза перехвата)
  document.addEventListener('click', function (e) {
    if (e.__pcCartHandled) return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || !listEl.contains(btn)) return;
    act(btn, e);
  }, true);

  // ---------- публичный API (нужен для inline onclick) ----------
  window.PCCart = {
    version: VERSION,
    act: act,
    load: load,
    render: render,
    getState: function () { return currentCart; },
    diag: function () {
      return {
        version: VERSION,
        api: API,
        sessionId: getSessionId(),
        itemRows: listEl.querySelectorAll('.cart-row').length,
        buttons: listEl.querySelectorAll('[data-act]').length,
        state: currentCart
      };
    }
  };

  // ---------- промокод ----------
  function applyPromo() {
    var code = String((promoInput && promoInput.value) || '').trim().toUpperCase();

    if (!code) {
      setPromo(null);
      setPromoMsg('Введите промокод', true);
      updateSummary(currentCart);
      return;
    }

    if (promoBtn) {
      promoBtn.disabled = true;
      promoBtn.textContent = 'Проверка…';
    }

    request('GET', '/api/promo?code=' + encodeURIComponent(code))
      .then(function (data) {
        setPromo({ code: data.code, discountPercent: data.discountPercent });
        setPromoMsg('Промокод ' + data.code + ' применён (−' + data.discountPercent + '%)', false);
        updateSummary(currentCart);
      })
      .catch(function (err) {
        setPromo(null);
        setPromoMsg(err.message, true);
        updateSummary(currentCart);
      })
      .then(function () {
        if (promoBtn) {
          promoBtn.disabled = false;
          promoBtn.textContent = 'Применить';
        }
      });
  }

  if (promoBtn) promoBtn.addEventListener('click', applyPromo);
  if (promoInput) {
    promoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyPromo();
      }
    });
    var savedPromo = getPromo();
    if (savedPromo && savedPromo.code) promoInput.value = savedPromo.code;
  }

  // ---------- синхронизация между вкладками ----------
  window.addEventListener('storage', function (e) {
    if (e.key !== 'pc_cart_sync') return;
    // защита от «пинг-понга»: перезагружаем корзину только если количество изменилось
    try {
      var st = JSON.parse(e.newValue || '{}');
      if (Number(st.count) === Number(currentCart.count)) return;
    } catch (_) { /* некорректное значение — просто перезагрузим */ }
    setTimeout(function () { load().catch(function () {}); }, 150);
  });

  // возврат на страницу из кэша браузера (кнопка «Назад»)
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) load().catch(function () {});
  });

  // ---------- старт ----------
  load().catch(function () {});
})();
