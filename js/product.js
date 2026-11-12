/**
 * ПК-МАСТЕР: Dynamic product detail page
 * - loads product by ?id= or ?slug= from /api/products/:idOrSlug
 * - renders title, price, image, description, specs, stock
 * - quantity controls limited by stock (frontend)
 * - add-to-cart with requested qty and stock validation (backend)
 */
(function () {
  'use strict';

  const API = (window.PC && window.PC.API) || window.PC_API || 'http://localhost:3000';
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function getSessionId() {
    if (window.PC && window.PC.getSessionId) return window.PC.getSessionId();
    return localStorage.getItem('pc_session') || '';
  }

  const params = new URLSearchParams(location.search);
  const key = params.get('slug') || params.get('id') || 'tragg'; // fallback for old links

  const loadingEl = document.getElementById('productLoading');
  const errorEl = document.getElementById('productError');
  const contentEl = document.getElementById('productContent');
  const qtyEl = document.getElementById('qty');
  const minusBtn = document.getElementById('minus');
  const plusBtn = document.getElementById('plus');
  const qtyHint = document.getElementById('qtyHint');
  const addBtn = document.getElementById('addToCartBtn');

  let product = null;
  let currentQty = 1;

  function setQty(n) {
    if (!product) return;
    const stock = Math.max(0, Number(product.stock) || 0);
    if (stock <= 0) {
      currentQty = 0;
    } else {
      currentQty = Math.min(Math.max(1, n), stock);
    }
    if (qtyEl) qtyEl.textContent = String(stock <= 0 ? 0 : currentQty);
    updateQtyControls();
  }

  function updateQtyControls() {
    if (!product) return;
    const stock = Math.max(0, Number(product.stock) || 0);
    if (minusBtn) minusBtn.disabled = currentQty <= 1 || stock <= 0;
    if (plusBtn) plusBtn.disabled = stock <= 0 || currentQty >= stock;
    if (qtyHint) {
      if (stock <= 0) qtyHint.textContent = 'Нет в наличии';
      else if (currentQty >= stock) qtyHint.textContent = `Максимум: ${stock} шт.`;
      else qtyHint.textContent = `Доступно: ${stock} шт.`;
    }
  }

  function render(p) {
    product = p;
    document.title = `${p.name} — ПК-МАСТЕР`;

    const crumb = document.getElementById('crumbName');
    if (crumb) crumb.textContent = p.name;

    const img = document.getElementById('productImage');
    if (img) { img.src = p.image_url || ''; img.alt = p.name; }

    const title = document.getElementById('productTitle');
    if (title) title.textContent = p.name;

    const price = document.getElementById('productPrice');
    if (price) price.textContent = fmt(p.price);

    const desc = document.getElementById('productDesc');
    if (desc) desc.textContent = p.description || 'Описание товара скоро будет добавлено.';

    const stockEl = document.getElementById('productStock');
    const stock = Math.max(0, Number(p.stock) || 0);
    if (stockEl) {
      if (stock <= 0) stockEl.innerHTML = '<span style="color:#ff5a5a">Нет в наличии</span>';
      else if (stock <= 5) stockEl.innerHTML = `<span style="color:#ffb347">Осталось всего ${stock} шт.!</span>`;
      else stockEl.innerHTML = `<span style="color:var(--grey)">В наличии: ${stock} шт.</span>`;
    }

    // specs table
    const table = document.getElementById('specsTable');
    const specs = Array.isArray(p.specs) ? p.specs : [];
    if (table) {
      if (!specs.length) {
        table.innerHTML = '<tr><td>Информация</td><td>Уточняйте у менеджера</td></tr>';
      } else {
        table.innerHTML = specs.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.value)}</td></tr>`).join('');
      }
    }

    // reviews integration
    const reviewsBtn = document.getElementById('productReviewsBtn');
    const reviewsSection = document.getElementById('productReviews');
    if (reviewsBtn) {
      reviewsBtn.dataset.reviewSlug = p.slug || '';
      reviewsBtn.dataset.reviewName = p.name || '';
    }
    if (reviewsSection) {
      reviewsSection.dataset.reviewSlug = p.slug || '';
      reviewsSection.dataset.reviewName = p.name || '';
    }
    // re-init reviews module hooks after slug is known
    if (window.initReviewsDynamic && typeof window.initReviewsDynamic === 'function') {
      try { window.initReviewsDynamic(); } catch (_) {}
    }
    // refresh rating badges/buttons for this product (if reviews.js provides it)
    if (window.PCReviews && typeof window.PCReviews.refreshCards === 'function') {
      try { window.PCReviews.refreshCards(true); } catch (_) {}
    } else if (typeof window.refreshProductReviewStats === 'function') {
      try { window.refreshProductReviewStats(); } catch (_) {}
    }

    // quantity
    setQty(1);

    // add to cart
    if (addBtn) {
      addBtn.disabled = stock <= 0;
      addBtn.textContent = stock <= 0 ? 'Нет в наличии' : 'В корзину';
      addBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (stock <= 0) return alert('Товара нет в наличии');
        const qty = Math.min(Math.max(1, currentQty), stock);
        if (qty > stock) return alert(`На складе осталось ${stock} шт.`);

        const old = addBtn.textContent;
        addBtn.disabled = true;
        addBtn.textContent = 'Добавляем...';
        try {
          const res = await fetch(`${API}/api/cart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: getSessionId(),
              productId: p.id,
              productSlug: p.slug,
              qty
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Не удалось добавить в корзину');

          if (window.PC && window.PC.publishCartState) window.PC.publishCartState(data);
          addBtn.textContent = 'Добавлено ✓';
          addBtn.style.background = '#00b33f';
        } catch (err) {
          alert(err.message || 'Ошибка при добавлении в корзину');
          addBtn.textContent = old;
        } finally {
          setTimeout(() => {
            addBtn.style.background = '';
            addBtn.textContent = 'В корзину';
            addBtn.disabled = Number(product.stock) <= 0;
            updateQtyControls();
          }, 1200);
        }
      };
    }

    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
  }

  function renderError(msg) {
    if (loadingEl) loadingEl.hidden = true;
    if (contentEl) contentEl.hidden = true;
    if (errorEl) { errorEl.hidden = false; errorEl.textContent = msg; }
  }

  async function load() {
    try {
      const res = await fetch(`${API}/api/products/${encodeURIComponent(key)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Товар не найден');
      render(data);
    } catch (err) {
      renderError(err.message || 'Не удалось загрузить товар. Проверьте, что бэкенд запущен: http://localhost:3000');
    }
  }

  if (minusBtn) minusBtn.addEventListener('click', () => setQty(currentQty - 1));
  if (plusBtn) plusBtn.addEventListener('click', () => {
    if (!product) return;
    const stock = Number(product.stock) || 0;
    if (currentQty >= stock) {
      alert(`На складе осталось ${stock} шт.`);
      return;
    }
    setQty(currentQty + 1);
  });

  load();
})();
