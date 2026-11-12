/**
 * ПК-МАСТЕР: Каталог
 * - загружает товары из БД (GET /api/products) и рендерит карточки
 * - фильтры (категория, цена), сортировка, пагинация
 * - "Подробнее" ведёт на product.html?slug=...
 */
(function () {
  'use strict';

  const API = (window.PC && window.PC.API) || window.PC_API || 'http://localhost:3000';
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const grid = document.getElementById('productGrid');
  const paginationEl = document.getElementById('pagination');
  if (!grid) return;

  const PER_PAGE = 8;
  let currentPage = 1;
  let allProducts = [];

  const categorySel = document.getElementById('filterCategory');
  const brandSel = document.getElementById('filterBrand');
  const priceFrom = document.getElementById('priceFrom');
  const priceTo = document.getElementById('priceTo');
  const applyBtn = document.getElementById('applyFilters');
  const resetBtn = document.getElementById('resetFilters');
  const sortSel = document.getElementById('sortSelect');
  const countEl = document.getElementById('resultsCount');
  const emptyEl = document.getElementById('emptyResults');

  const goodsWord = (n) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'товар';
    if (m10 >= 2 && m10 <= 4 && (m100 < 11 || m100 > 14)) return 'товара';
    return 'товаров';
  };

  // normalize DB category slugs to UI filter values where possible
  function mapCategory(slug) {
    const s = String(slug || '').toLowerCase();
    if (s === 'builds' || s === 'gotosbor') return 'builds';
    if (s === 'gpu' || s === 'videokarty') return 'gpu';
    if (s === 'cpu' || s === 'processory') return 'cpu';
    if (s === 'cases' || s === 'korpusa') return 'cases';
    if (s === 'ram' || s === 'operativnaya-pamyat') return 'ram';
    return s || 'other';
  }

  function cardHtml(p) {
    const cat = mapCategory(p.category_slug);
    const stock = Number(p.stock) || 0;
    const stockNote = stock <= 0
      ? '<div class="small" style="color:#ff5a5a;margin:4px 0 10px">Нет в наличии</div>'
      : (stock <= 5 ? `<div class="small" style="color:#ffb347;margin:4px 0 10px">Осталось ${stock} шт.</div>` : '');
    return `
      <article class="card" data-id="${p.id}" data-slug="${esc(p.slug)}" data-category="${esc(cat)}" data-brand="all" data-price="${Number(p.price)}" data-rating="5">
        <img src="${esc(p.image_url || '')}" alt="${esc(p.name)}">
        <h3>${esc(p.name)}</h3>
        <button class="stars-btn" type="button" data-review-slug="${esc(p.slug)}" data-review-name="${esc(p.name)}">★★★★★ <span>Отзывы</span></button>
        <div class="price">${fmt(p.price)}</div>
        ${stockNote}
        <a href="product.html?slug=${encodeURIComponent(p.slug)}" class="btn btn-primary btn-full">Подробнее</a>
      </article>`;
  }

  function renderFromDB() {
    grid.innerHTML = allProducts.map(cardHtml).join('');
  }

  function getFiltered() {
    const cat = categorySel ? categorySel.value : 'all';
    const brand = brandSel ? brandSel.value : 'all';
    const min = priceFrom ? (parseFloat(priceFrom.value) || 0) : 0;
    const max = priceTo && priceTo.value !== '' ? (parseFloat(priceTo.value) || Infinity) : Infinity;

    const cards = Array.from(grid.querySelectorAll('.card'));
    return cards.filter(card => {
      if (cat !== 'all' && card.dataset.category !== cat) return false;
      if (brand !== 'all' && card.dataset.brand !== brand && brand !== 'all') return false;
      const price = parseFloat(card.dataset.price) || 0;
      return price >= min && price <= max;
    });
  }

  function getSorted(list) {
    const sorted = list.slice();
    const mode = sortSel ? sortSel.value : 'popular';
    const price = c => parseFloat(c.dataset.price) || 0;
    if (mode === 'price-asc') sorted.sort((a,b) => price(a) - price(b));
    else if (mode === 'price-desc') sorted.sort((a,b) => price(b) - price(a));
    else sorted.sort((a,b) => price(a) - price(b));
    return sorted;
  }

  function render() {
    const list = getSorted(getFiltered());
    const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    list.forEach(card => grid.appendChild(card));
    grid.querySelectorAll('.card').forEach(card => card.hidden = true);
    list.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE).forEach(card => card.hidden = false);

    if (countEl) countEl.textContent = 'Найдено: ' + list.length + ' ' + goodsWord(list.length);
    if (emptyEl) emptyEl.hidden = list.length > 0;
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    if (!paginationEl) return;
    paginationEl.innerHTML = '';
    paginationEl.hidden = totalPages <= 1;
    for (let i = 1; i <= totalPages; i++) {
      const a = document.createElement('a');
      a.textContent = i;
      if (i === currentPage) a.classList.add('active');
      a.addEventListener('click', () => { currentPage = i; render(); window.scrollTo({ top: grid.offsetTop - 90, behavior: 'smooth' }); });
      paginationEl.appendChild(a);
    }
  }

  async function load() {
    try {
      const res = await fetch(`${API}/api/products`);
      if (!res.ok) throw new Error('failed');
      allProducts = await res.json();
      if (Array.isArray(allProducts) && allProducts.length) {
        renderFromDB();
      }
    } catch (_) {
      // fallback: keep static HTML cards if present and just fix their links
      document.querySelectorAll('.card').forEach(card => {
        const slugEl = card.querySelector('[data-review-slug]');
        const link = card.querySelector('a[href="product.html"], a[href^="product.html?"]');
        if (slugEl && link) link.href = 'product.html?slug=' + encodeURIComponent(slugEl.dataset.reviewSlug);
      });
    }
    render();

    // Подключить отзывы/рейтинги к (пере)отрисованным карточкам каталога
    if (window.PCReviews && typeof window.PCReviews.initCardButtons === 'function') {
      try { window.PCReviews.initCardButtons(); } catch (_) {}
    } else if (window.initReviewsDynamic && typeof window.initReviewsDynamic === 'function') {
      // fallback: ничего специфичного, init уже мог пройти — просто обновим статистику
    }
  }

  if (applyBtn) applyBtn.addEventListener('click', () => { currentPage = 1; render(); });
  if (sortSel) sortSel.addEventListener('change', () => { currentPage = 1; render(); });
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (categorySel) categorySel.value = 'all';
    if (brandSel) brandSel.value = 'all';
    if (priceFrom) priceFrom.value = 0;
    if (priceTo) priceTo.value = '';
    if (sortSel) sortSel.value = 'popular';
    currentPage = 1; render();
  });

  load();
})();
