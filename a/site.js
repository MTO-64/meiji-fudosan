(function () {
  'use strict';
  // 全画面メニュー
  var menu = document.getElementById('menu');
  var open = document.querySelector('.menu-btn');
  if (menu && open) {
    var close = menu.querySelector('.menu-close');
    var shut = function () {
      menu.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
      open.focus();
    };
    open.addEventListener('click', function () {
      menu.hidden = false;
      open.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
      close.focus();
    });
    close.addEventListener('click', shut);
    menu.addEventListener('click', function (e) { if (e.target.tagName === 'A') shut(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) shut(); });
  }

  // 目次: いま読んでいる章に印を付ける
  var toc = document.querySelector('.toc');
  if (toc && 'IntersectionObserver' in window) {
    var links = {};
    toc.querySelectorAll('a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || !links[e.target.id]) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('is-now', k === e.target.id); });
      });
    }, { rootMargin: '-25% 0px -70% 0px' });
    Object.keys(links).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // 物件目録の絞り込み。JSが無ければ全件がそのまま見える
  var list = document.querySelector('[data-catalog]');
  if (list) {
    var rows = [].slice.call(list.querySelectorAll('[data-kind]'));
    var state = { kind: 'すべて', city: 'すべて', price: 'すべて' };
    var RANGE = { 'すべて': [0, Infinity], '500万円未満': [0, 500], '500〜1,000万円未満': [500, 1000], '1,000万円以上': [1000, Infinity] };
    var count = document.getElementById('count');
    var empty = document.getElementById('empty');
    var apply = function () {
      var r = RANGE[state.price];
      var n = 0;
      rows.forEach(function (row) {
        var man = Number(row.dataset.man);
        var show = (state.kind === 'すべて' || row.dataset.kind === state.kind) && (state.city === 'すべて' || row.dataset.city === state.city) && man >= r[0] && man < r[1];
        row.hidden = !show;
        if (show) n += 1;
      });
      if (count) count.textContent = n + '件';
      if (empty) empty.hidden = n !== 0;
    };
    document.querySelectorAll('[data-filter]').forEach(function (group) {
      var key = group.dataset.filter;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          state[key] = b.textContent;
          group.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          apply();
        });
      });
    });
    apply();
  }

  // 相談の種類で入力欄を出し分ける
  var form = document.getElementById('consult');
  if (form) {
    var sync = function () {
      var picked = form.querySelector('input[name="type"]:checked');
      var v = picked ? picked.value : '';
      form.querySelectorAll('[data-when]').forEach(function (f) {
        var show = f.dataset.when.split(' ').indexOf(v) >= 0;
        f.hidden = !show;
      });
    };
    form.addEventListener('change', sync);
    var want = new URLSearchParams(location.search);
    if (want.get('type')) {
      var hit = form.querySelector('input[name="type"][value="' + want.get('type').replace(/"/g, '') + '"]');
      if (hit) hit.checked = true;
    }
    if (want.get('item')) {
      var item = form.querySelector('[name="item"]');
      if (item) item.value = want.get('item');
    }
    sync();
    var statusEl = document.getElementById('status');
    var sendBtn = form.querySelector('.submit');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var field = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
      if (!field('name')) { statusEl.textContent = 'お名前を入力してください。'; form.querySelector('[name="name"]').focus(); return; }
      if (!field('tel') && !field('email')) { statusEl.textContent = 'お電話番号かメールアドレスのどちらかを入力してください。'; form.querySelector('[name="tel"]').focus(); return; }
      var email = form.querySelector('[name="email"]');
      if (field('email') && !email.checkValidity()) { statusEl.textContent = 'メールアドレスの形式を確かめてください。'; email.focus(); return; }
      sendBtn.disabled = true;
      statusEl.textContent = '送信しています。';
      var fail = function () {
        sendBtn.disabled = false;
        statusEl.textContent = '送信できませんでした。入力内容は残っています。もう一度お試しいただくか、お電話ください。0299-35-2123';
      };
      // 応答が返らない時も止まったままにせず電話を案内する
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, 15000);
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' }, signal: ctl.signal })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          clearTimeout(timer);
          if (!json.success) { fail(); return; }
          form.reset();
          sync();
          sendBtn.disabled = false;
          statusEl.textContent = 'ご相談を受け付けました。翌営業日までにお返事します。';
          statusEl.focus();
        })
        .catch(function () { clearTimeout(timer); fail(); });
    });
  }
})();

// 写真の上の頭: 下へ読む間は隠し、戻る時は白地で出す
(function () {
  var head = document.querySelector('.site-head');
  if (!head || !document.body.classList.contains('scene')) return;
  var last = 0;
  addEventListener('scroll', function () {
    var y = scrollY;
    head.classList.toggle('solid', y > 80);
    if (y > 120 && y > last + 4) head.classList.add('up');
    else if (y < last - 4 || y <= 120) head.classList.remove('up');
    last = y;
  }, { passive: true });
})();
