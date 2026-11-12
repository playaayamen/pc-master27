/* Отзывы ПК-МАСТЕР
   Один модуль на три места:
   1) звёзды в карточках каталога (модалка)
   2) блок отзывов на странице товара (#productReviews)
   3) страница всех отзывов (#rvPageList)

   Требует запущенный бэкенд: http://localhost:3000
*/
(function () {
  'use strict';

  const API = window.PC_API || 'http://localhost:3000';

  // ---------- утилиты ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Должно совпадать с slugify() в backend/server.js
  function slugify(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[«»""'']/g, '')
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '');
  }

  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 11 || m100 > 14)) return few;
    return many;
  };
  const reviewsWord = n => plural(n, 'отзыв', 'отзыва', 'отзывов');

  function starsHtml(rating) {
    const n = Math.round(Number(rating) || 0);
    let out = '';
    for (let i = 1; i <= 5; i++) out += i <= n ? '★' : '<span class="off">★</span>';
    return `<span class="rv-stars" aria-label="Оценка ${n} из 5">${out}</span>`;
  }

  const fmtDate = iso => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  async function api(path, options) {
    const res = await fetch(API + path, Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, options));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  // ---------- сводка ----------
  function summaryHtml(avg, total) {
    return `<div class="rv-score">${total ? Number(avg).toFixed(1) : '—'}</div>
      <div>${starsHtml(avg)}
        <small>${total} ${reviewsWord(total)}${total ? ', средняя оценка' : ''}</small>
      </div>`;
  }

  function reviewItemHtml(r) {
    return `<article class="rv-item">
      <div class="rv-item-head">
        <b>${esc(r.user_name)}</b>
        ${starsHtml(r.rating)}
        <time datetime="${esc(r.created_at)}">${fmtDate(r.created_at)}</time>
      </div>
      <p>${esc(r.comment)}</p>
    </article>`;
  }

  function renderList(el, items, emptyText) {
    if (!el) return;
    el.innerHTML = items.length
      ? items.map(reviewItemHtml).join('')
      : `<p class="rv-empty">${esc(emptyText || 'Пока нет отзывов. Станьте первым!')}</p>`;
  }

  // ---------- форма ----------
  function formHtml(id, withProductSelect) {
    return `<form class="rv-form" id="${id}" novalidate>
      <h3>Оставить отзыв</h3>
      ${withProductSelect ? `<label>Товар
        <select name="product" required>
          <option value="">— выберите товар —</option>
        </select></label>` : ''}
      <label>Ваше имя
        <input name="userName" maxlength="100" placeholder="Например, Алексей" required>
      </label>
      <label>Оценка</label>
      <div class="rv-rate" data-rate>
        ${[1, 2, 3, 4, 5].map(i => `<label title="${i} из 5">
          <input type="radio" name="rating" value="${i}" ${i === 5 ? 'checked' : ''}>
          <span>★</span></label>`).join('')}
      </div>
      <label>Отзыв
        <textarea name="comment" maxlength="2000" placeholder="Что понравилось, что нет?" required></textarea>
      </label>
      <button class="btn btn-primary" type="submit">Отправить отзыв</button>
      <p class="rv-msg" hidden></p>
    </form>`;
  }

  function initRate(form) {
    const box = $('[data-rate]', form);
    if (!box) return;
    const paint = v => $$('label', box).forEach(l => {
      l.classList.toggle('active', Number($('input', l).value) <= v);
    });
    if (!box.dataset.rateInit) {
      box.dataset.rateInit = '1';
      box.addEventListener('change', e => {
        if (e.target.name === 'rating') paint(Number(e.target.value));
      });
    }
    const checked = $('input:checked', box);
    paint(checked ? Number(checked.value) : 5);
  }

  // Привязка формы: product = {slug, name} или функция
  function bindForm(form, getProduct, onPosted) {
    if (!form) return;
    initRate(form);
    const msg = $('.rv-msg', form);

    const setMsg = (text, ok) => {
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = text;
      msg.className = 'rv-msg ' + (ok ? 'success' : 'error');
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const product = getProduct(form);
      const userName = form.userName.value.trim();
      const comment = form.comment.value.trim();
      const rating = Number((form.querySelector('input[name="rating"]:checked') || {}).value);

      if (!product || !product.slug) return setMsg('Выберите товар', false);
      if (userName.length < 2) return setMsg('Введите имя (минимум 2 символа)', false);
      if (comment.length < 3) return setMsg('Напишите отзыв (минимум 3 символа)', false);
      if (!rating) return setMsg('Поставьте оценку', false);

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      try {
        await api('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({
            productSlug: product.slug,
            productName: product.name,
            userName,
            rating,
            comment
          })
        });
        form.reset();
        initRate(form);
        setMsg('Спасибо! Отзыв опубликован.', true);
        statsCache = null;
        if (onPosted) onPosted(product);
      } catch (err) {
        setMsg(err.message || 'Не удалось отправить отзыв', false);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Отправить отзыв';
      }
    });
  }

  // ---------- модальное окно ----------
  let modal = null;
  let modalState = { slug: '', name: '' };

  function ensureModal() {
    if (modal) return modal;
    const el = document.createElement('div');
    el.className = 'rv-modal';
    el.id = 'rvModal';
    el.hidden = true;
    el.innerHTML = `<div class="rv-dialog" role="dialog" aria-modal="true" aria-labelledby="rvModalTitle">
      <button class="rv-close" type="button" aria-label="Закрыть">×</button>
      <h2 id="rvModalTitle"></h2>
      <p class="rv-sub" id="rvModalSub"></p>
      <div class="rv-summary" id="rvModalSummary"></div>
      <div class="rv-list" id="rvModalList"><p class="rv-loading">Загрузка отзывов…</p></div>
      <div id="rvModalFormBox"></div>
    </div>`;
    document.body.appendChild(el);

    const close = () => { el.hidden = true; document.body.style.overflow = ''; };
    el.addEventListener('click', e => { if (e.target === el) close(); });
    $('.rv-close', el).addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !el.hidden) close();
    });

    modal = el;
    return el;
  }

  async function openModal(slugOrName, maybeName) {
    const el = ensureModal();
    const name = maybeName || slugOrName;
    const slug = maybeName ? slugOrName : slugify(slugOrName);
    modalState = { slug, name };

    $('#rvModalTitle', el).textContent = name;
    $('#rvModalSub', el).textContent = 'Отзывы покупателей';
    $('#rvModalList', el).innerHTML = '<p class="rv-loading">Загрузка отзывов…</p>';
    $('#rvModalFormBox', el).innerHTML = formHtml('rvModalForm', false);
    el.hidden = false;
    document.body.style.overflow = 'hidden';

    bindForm($('#rvModalForm', el), () => modalState, product => loadModal(product));

    await loadModal({ slug, name });
  }

  async function loadModal(product) {
    const el = ensureModal();
    try {
      const data = await api('/api/reviews?productSlug=' + encodeURIComponent(product.slug) + '&limit=50');
      $('#rvModalSummary', el).innerHTML = summaryHtml(data.avgRating, data.total);
      renderList($('#rvModalList', el), data.items);
      refreshCards(true);
    } catch (err) {
      $('#rvModalSummary', el).innerHTML = '';
      $('#rvModalList', el).innerHTML =
        `<p class="rv-empty">Не удалось загрузить отзывы.<br>${esc(err.message)}<br>
         Проверьте, что бэкенд запущен: <b>http://localhost:3000</b></p>`;
    }
  }

  window.openReviewsModal = openModal;

  // ---------- звёзды в карточках каталога ----------
  let statsCache = null;

  async function fetchStats(force) {
    if (statsCache && !force) return statsCache;
    const rows = await api('/api/reviews/products');
    const map = {};
    rows.forEach(r => {
      map[r.product_slug] = { count: r.count, avg: Number(r.avg_rating) };
    });
    statsCache = map;
    return map;
  }

  async function refreshCards(force) {
    const btns = $$('.stars-btn[data-review-slug]');
    if (!btns.length) return;
    let map;
    try {
      map = await fetchStats(force);
    } catch {
      return; // бэкенд недоступен — оставляем то, что в разметке
    }
    btns.forEach(btn => {
      const s = map[btn.dataset.reviewSlug];
      if (!s || !s.count) return; // оставляем исходные звёзды из разметки
      btn.innerHTML = `${starsHtml(s.avg)} <span>${s.avg.toFixed(1)} (${s.count})</span>`;
    });
  }

  function initCardButtons() {
    const btns = $$('.stars-btn');
    btns.forEach(btn => {
      // Don't guess slug from button text for dynamic/non-card contexts (e.g. product page
      // sets dataset after async load). Only auto-fill from catalog card title.
      if (!btn.dataset.reviewSlug) {
        const card = btn.closest('.card');
        if (card) {
          const title = $('h3', card);
          btn.dataset.reviewSlug = slugify(title ? title.textContent : '');
          btn.dataset.reviewName = title ? title.textContent.trim() : '';
        }
      }
      if (btn.dataset.rvBound) return;
      btn.dataset.rvBound = '1';
      btn.addEventListener('click', () => {
        const slug = btn.dataset.reviewSlug || slugify(btn.dataset.reviewName || '');
        const name = btn.dataset.reviewName || slug;
        if (!slug) return;
        openModal(slug, name);
      });
    });
    refreshCards(true);
  }

  // ---------- блок на странице товара ----------
  function initProductBlock(forceSlug, forceName) {
    const box = $('#productReviews');
    if (!box) return;

    const slug = forceSlug || box.dataset.reviewSlug || slugify(box.dataset.reviewName || '');
    const name = forceName || box.dataset.reviewName || slug;

    // Dynamic product page sets slug after async load: if not known yet, wait for explicit init.
    if (!slug) {
      box.innerHTML = `<p class="rv-loading">Загрузка отзывов…</p>`;
      return;
    }

    // Keep dataset in sync (used by modal button / other logic)
    box.dataset.reviewSlug = slug;
    box.dataset.reviewName = name;

    box.innerHTML = `
      <h2>Отзывы <span class="small" id="prCount"></span></h2>
      <div class="rv-summary" id="prSummary"></div>
      <div class="rv-list" id="prList"><p class="rv-loading">Загрузка отзывов…</p></div>
      <div id="prFormBox">${formHtml('prForm', false)}</div>`;

    bindForm($('#prForm', box), () => ({ slug, name }), () => loadProduct());

    async function loadProduct() {
      try {
        const data = await api('/api/reviews?productSlug=' + encodeURIComponent(slug) + '&limit=100');
        $('#prSummary', box).innerHTML = summaryHtml(data.avgRating, data.total);
        $('#prCount', box).textContent = data.total ? `(${data.total})` : '';
        const top = $('#prTopRating');
        if (top) {
          top.innerHTML = data.total
            ? `${starsHtml(data.avgRating)} <span>${data.avgRating.toFixed(1)} · ${data.total} ${reviewsWord(data.total)}</span>`
            : `${starsHtml(0)} <span>Пока нет отзывов</span>`;
        }
        renderList($('#prList', box), data.items);
        refreshCards(true);
      } catch (err) {
        $('#prList', box).innerHTML =
          `<p class="rv-empty">Не удалось загрузить отзывы: ${esc(err.message)}<br>
           Проверьте, что бэкенд запущен на <b>http://localhost:3000</b></p>`;
      }
    }

    loadProduct();
  }

  // Для динамической страницы товара: вызывать после загрузки данных товара
  function initReviewsDynamic(product) {
    const box = $('#productReviews');
    if (!box) return;
    if (product) {
      if (product.slug) box.dataset.reviewSlug = product.slug;
      if (product.name) box.dataset.reviewName = product.name;
    }
    initProductBlock(box.dataset.reviewSlug, box.dataset.reviewName);
  }
  window.initReviewsDynamic = initReviewsDynamic;
  window.PCReviews = { loadForProduct: initProductBlock, refreshCards, initCardButtons, initReviewsDynamic };

  // ---------- страница всех отзывов ----------
  function initPage() {
    const listEl = $('#rvPageList');
    if (!listEl) return;

    const filter = $('#rvFilterProduct');
    const sort = $('#rvSort');
    const countEl = $('#rvPageCount');
    const statsEl = $('#rvPageStats');
    const moreBox = $('#rvPageMore');
    const form = $('#rvPageForm');

    const PAGE_SIZE = 8;
    let offset = 0;
    let productCache = [];

    function currentSlug() { return filter.value || ''; }

    async function loadProducts() {
      try {
        const rows = await api('/api/products');
        productCache = rows.map(p => ({ slug: p.slug, name: p.name }));
      } catch {
        try {
          const rows = await api('/api/reviews/products');
          productCache = rows.map(p => ({ slug: p.product_slug, name: p.product_name }));
        } catch { productCache = []; }
      }

      const select = form ? $('select[name="product"]', form) : null;
      productCache.forEach(p => {
        if (filter) filter.insertAdjacentHTML('beforeend',
          `<option value="${esc(p.slug)}">${esc(p.name)}</option>`);
        if (select) select.insertAdjacentHTML('beforeend',
          `<option value="${esc(p.slug)}" data-name="${esc(p.name)}">${esc(p.name)}</option>`);
      });
    }

    async function load(reset) {
      const byRating = !!(sort && sort.value === 'rating');
      if (reset) { offset = 0; listEl.innerHTML = '<p class="rv-loading">Загрузка…</p>'; }

      const qs = new URLSearchParams({
        limit: byRating ? 100 : PAGE_SIZE,
        offset: byRating ? 0 : offset
      });
      if (currentSlug()) qs.set('productSlug', currentSlug());

      try {
        const data = await api('/api/reviews?' + qs.toString());
        let items = data.items;

        if (byRating) {
          items = items.slice().sort((a, b) =>
            b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at));
        }

        const fullRender = reset || byRating;
        if (fullRender) listEl.innerHTML = '';

        if (data.total === 0) {
          listEl.innerHTML = '<p class="rv-empty">Отзывов пока нет. Оставьте первый!</p>';
        } else if (fullRender) {
          renderList(listEl, items);
        } else {
          listEl.insertAdjacentHTML('beforeend', items.map(reviewItemHtml).join(''));
        }

        if (!byRating) offset += items.length;

        if (countEl) countEl.textContent = `Всего: ${data.total} ${reviewsWord(data.total)}`;
        if (statsEl) statsEl.innerHTML = summaryHtml(data.avgRating, data.total);

        if (moreBox) {
          moreBox.innerHTML = '';
          if (!byRating && offset < data.total) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outline';
            btn.textContent = 'Показать ещё';
            btn.addEventListener('click', () => load(false));
            moreBox.appendChild(btn);
          }
        }
      } catch (err) {
        listEl.innerHTML =
          `<p class="rv-empty">Не удалось загрузить отзывы: ${esc(err.message)}<br>
           Проверьте, что бэкенд запущен на <b>http://localhost:3000</b></p>`;
      }
    }

    if (filter) filter.addEventListener('change', () => load(true));
    if (sort) sort.addEventListener('change', () => load(true));

    bindForm(form, f => {
      const opt = $('select[name="product"] option:checked', f);
      if (!opt || !opt.value) return null;
      return { slug: opt.value, name: opt.dataset.name || opt.textContent };
    }, product => {
      statsCache = null;
      filter.value = product.slug || '';
      load(true);
    });

    loadProducts().then(() => load(true));
  }

  // ---------- старт ----------
  function init() {
    initCardButtons();
    initProductBlock();
    initPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
