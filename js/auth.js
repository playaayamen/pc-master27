/* Авторизация ПК-МАСТЕР */
(function () {
  'use strict';
  const API = window.PC_API || 'http://localhost:3000';

  function getSessionId() {
    let s = localStorage.getItem('pc_session');
    if (!s) { s = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('pc_session', s); }
    return s;
  }
  window.PC_SESSION = getSessionId();

  function getUser() {
    try { return JSON.parse(localStorage.getItem('pc_user') || 'null'); } catch { return null; }
  }
  function setUser(u) { localStorage.setItem('pc_user', JSON.stringify(u)); }
  function clearUser() { localStorage.removeItem('pc_user'); }

  window.PC_AUTH = { getUser, setUser, clearUser, getSessionId };

  async function api(path, opts) {
    const res = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  // обновление навбара/бейджа
  function updateAuthUI() {
    const u = getUser();
    const link = document.getElementById('authLink');
    if (link) {
      if (u) {
        link.textContent = (u.firstName || u.email) + ' (Профиль)';
        link.href = 'profile.html';
        link.onclick = null;
        link.title = 'Открыть профиль';
      } else {
        link.textContent = 'Вход';
        link.href = 'login.html';
        link.onclick = null;
      }
    }
  }

  // Регистрация
  const regForm = document.getElementById('registerForm');
  if (regForm) {
    regForm.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = regForm.querySelector('.rv-msg');
      const setMsg = (t, ok) => { msg.hidden = false; msg.textContent = t; msg.className = 'rv-msg ' + (ok ? 'success' : 'error'); };
      const fd = new FormData(regForm);
      const password = fd.get('password');
      if (password !== fd.get('password2')) { setMsg('Пароли не совпадают', false); return; }
      const btn = regForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Регистрируем…';
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            firstName: fd.get('firstName'),
            lastName: fd.get('lastName'),
            email: fd.get('email'),
            phone: fd.get('phone'),
            password
          })
        });
        setUser(data.user);
        setMsg('Регистрация успешна! Перенаправляем…', true);
        setTimeout(() => { location.href = 'index.html'; }, 800);
      } catch (err) {
        setMsg(err.message, false);
      } finally {
        btn.disabled = false; btn.textContent = 'Зарегистрироваться';
      }
    });
  }

  // Вход
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = loginForm.querySelector('.rv-msg');
      const setMsg = (t, ok) => { msg.hidden = false; msg.textContent = t; msg.className = 'rv-msg ' + (ok ? 'success' : 'error'); };
      const fd = new FormData(loginForm);
      const btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Входим…';
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: fd.get('email'),
            password: fd.get('password'),
            sessionId: getSessionId()
          })
        });
        setUser(data.user);
        setMsg('Вход выполнен! Перенаправляем…', true);
        setTimeout(() => { location.href = 'index.html'; }, 800);
      } catch (err) {
        setMsg(err.message, false);
      } finally {
        btn.disabled = false; btn.textContent = 'Войти';
      }
    });
  }

  updateAuthUI();
})();
