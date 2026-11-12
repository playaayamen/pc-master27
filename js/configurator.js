// Конфигуратор: выбор комплектующих и пересчёт суммы
(function () {
  'use strict';
  const fmt = n => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  const fixed = 13200 + 3500; // накопитель + сборка

  function calc() {
    const sums = { cpu: 0, gpu: 0, mb: 0, ram: 0 };
    document.querySelectorAll('.opt.selected').forEach(b => {
      sums[b.dataset.cat] += parseInt(b.dataset.price, 10) || 0;
    });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
    set('sumCpu', sums.cpu);
    set('sumGpu', sums.gpu);
    set('sumMb', sums.mb);
    set('sumRam', sums.ram);
    set('sumTotal', sums.cpu + sums.gpu + sums.mb + sums.ram + fixed);
  }

  document.querySelectorAll('.cfg-group').forEach(group => {
    group.querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        calc();
      });
    });
  });

  // Кнопка "Заказать сборку": конфигуратор — демонстрационный (нет товара в БД),
  // поэтому не отправляем add-to-cart, а показываем понятное сообщение.
  const orderBtn = document.querySelector('.cfg-summary [data-add]');
  if (orderBtn) {
    orderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const total = (document.getElementById('sumTotal') || {}).textContent || '';
      alert('Сборка сформирована' + (total ? ' на сумму ' + total : '') + '.\nДля оформления заказа свяжитесь с нами через страницу «Контакты» или по телефону.');
    }, true);
  }

  calc();
})();
