// 空から見るページ: スクロールで石岡へ降りる、同じ場所の60年、町名と空中写真。
(function () {
  'use strict';
  var BASE = '/a/sora/';
  var cfgEl = document.getElementById('descend');
  var cfg = JSON.parse(cfgEl.textContent);
  var C = cfg.center;
  var COS = Math.cos(C[1] * Math.PI / 180);
  var PLACES = [['筑波山', 140.103, 36.225, 20000, 90000], ['霞ヶ浦', 140.41, 36.04, 14000, 90000], ['石岡市', 140.2873, 36.1907, 5000, 50000], ['石岡駅', 140.2802, 36.1912, 700, 3600]];
  var dive = document.getElementById('dive');
  var stage = document.getElementById('stage');
  var c = document.getElementById('c');
  var ctx = c.getContext('2d');
  var lines = document.querySelectorAll('.line');
  var mark = document.getElementById('shop-mark');
  var marks = document.getElementById('marks');
  var imgs = cfg.layers.map(function () { var i = new Image(); i.decoding = 'async'; return i; });
  var spans = PLACES.map(function (p) { var s = document.createElement('span'); s.className = 'place'; s.textContent = p[0]; marks.appendChild(s); return s; });
  var START = 46000, END = 620, cur = 0, target = 0, lastP = -1;

  // 粗い層から順に読む。画面に出るのは読めた層だけ
  (function load(n) {
    if (n >= imgs.length) return;
    imgs[n].onload = imgs[n].onerror = function () { draw(true); load(n + 1); };
    imgs[n].src = BASE + cfg.layers[n].file;
  })(0);

  function ss(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function size() {
    var r = Math.min(devicePixelRatio || 1, 2), w = stage.clientWidth, h = stage.clientHeight;
    if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); lastP = -1; }
    return { r: r, w: w, h: h };
  }
  function draw(force) {
    var s = size();
    if (!force && Math.abs(cur - lastP) < 0.0003) return;
    lastP = cur;
    var long = Math.max(s.w, s.h), view = START * Math.pow(END / START, cur);
    ctx.setTransform(s.r, 0, 0, s.r, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    cfg.layers.forEach(function (l, i) {
      var im = imgs[i];
      if (!im.complete || !im.naturalWidth) return;
      var ratio = l.width_m / view, a = i === 0 ? 1 : ss(1.0, 1.28, ratio);
      if (a <= 0) return;
      var px = ratio * long;
      ctx.globalAlpha = a;
      ctx.drawImage(im, s.w / 2 - px / 2, s.h / 2 - px / 2, px, px);
    });
    ctx.globalAlpha = 1;
    var perPx = view / long;
    PLACES.forEach(function (p, i) {
      var x = s.w / 2 + (p[1] - C[0]) * 111320 * COS / perPx, y = s.h / 2 + (C[1] - p[2]) * 111000 / perPx;
      var on = view > p[3] && view < p[4] && x > 50 && x < s.w - 50 && y > 90 && y < s.h - 150;
      spans[i].style.opacity = on ? 1 : 0;
      spans[i].style.left = x + 'px';
      spans[i].style.top = y + 'px';
    });
    mark.style.left = s.w / 2 + 'px';
    mark.style.top = s.h / 2 + 'px';
    mark.style.opacity = view < 2600 ? 1 : 0;
    var nice = [10000, 5000, 2000, 1000, 500, 200, 100, 50];
    var m = nice.find(function (n) { return n / perPx < s.w * 0.2; }) || 50;
    document.getElementById('sb').style.width = (m / perPx) + 'px';
    document.getElementById('sv').textContent = m >= 1000 ? (m / 1000) + 'km' : m + 'm';
  }
  function onDive() {
    var r = dive.getBoundingClientRect(), span = dive.offsetHeight - stage.offsetHeight;
    target = Math.min(1, Math.max(0, -r.top / span));
    var idx = target < 0.24 ? 0 : target < 0.5 ? 1 : target < 0.78 ? 2 : 3;
    lines.forEach(function (l, i) { l.classList.toggle('on', i === idx); });
  }
  addEventListener('scroll', onDive, { passive: true });
  addEventListener('resize', function () { lastP = -1; draw(true); });
  onDive();
  // 動きを減らす設定では、なめらかに追わずスクロール位置へ直接合わせる
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var running = false;
  function tick() {
    cur = reduce ? target : cur + (target - cur) * 0.12;
    if (Math.abs(target - cur) < 0.0002) cur = target;
    draw();
    if (cur !== target) requestAnimationFrame(tick); else running = false;
  }
  function wake() { if (!running) { running = true; requestAnimationFrame(tick); } }
  addEventListener('scroll', wake, { passive: true });
  wake();

  // 同じ場所の60年
  var time = document.getElementById('time');
  var tStage = document.getElementById('time-stage');
  var l1 = document.getElementById('l1');
  var l2 = document.getElementById('l2');
  var edge = document.getElementById('edge');
  var yrL = document.getElementById('yrL');
  var yrR = document.getElementById('yrR');
  var handle = document.getElementById('handle');
  var manual = null, lastScroll = 0, timeP = 0;
  function paint(p) { // 0=1960年代が全面、0.5=1970年代が全面、1=現在が全面
    var w = tStage.clientWidth, phase = p < 0.5 ? 0 : 1, t = Math.min(1, Math.max(0, (p < 0.5 ? p : p - 0.5) * 2));
    var x = manual !== null ? manual * w : w * (1 - t);
    l1.style.clipPath = phase === 0 ? 'inset(0 ' + (w - x) + 'px 0 0)' : 'inset(0 100% 0 0)';
    l2.style.clipPath = phase === 0 ? 'none' : 'inset(0 ' + (w - x) + 'px 0 0)';
    edge.style.left = handle.style.left = yrL.style.left = yrR.style.left = x + 'px';
    yrL.textContent = phase === 0 ? '1960年代' : '1970年代';
    yrR.textContent = phase === 0 ? '1970年代' : '現在';
    yrL.style.opacity = x > w * 0.32 ? 1 : 0;
    yrR.style.opacity = x < w * 0.62 ? 1 : 0;
  }
  function onTime() {
    var r = time.getBoundingClientRect(), span = time.offsetHeight - tStage.offsetHeight;
    timeP = Math.min(1, Math.max(0, -r.top / span));
    if (Math.abs(scrollY - lastScroll) > 4) manual = null;
    lastScroll = scrollY;
    paint(timeP);
  }
  function drag(e) {
    var r = tStage.getBoundingClientRect();
    manual = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    lastScroll = scrollY;
    paint(timeP);
  }
  handle.addEventListener('pointerdown', function (e) { handle.setPointerCapture(e.pointerId); handle.onpointermove = drag; });
  handle.addEventListener('pointerup', function () { handle.onpointermove = null; });
  handle.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var now = manual !== null ? manual : parseFloat(edge.style.left) / tStage.clientWidth;
    manual = Math.min(1, Math.max(0, now + (e.key === 'ArrowRight' ? 0.05 : -0.05)));
    lastScroll = scrollY;
    paint(timeP);
  });
  addEventListener('scroll', onTime, { passive: true });
  addEventListener('resize', onTime);
  onTime();

  // 町名と空中写真
  var pics = [].slice.call(document.querySelectorAll('.wall-bg img'));
  var names = [].slice.call(document.querySelectorAll('.nm'));
  var act = -1;
  function loadPic(i) { var im = pics[i]; if (im && im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } }
  function setTown(i) {
    if (i === act) return;
    act = i;
    loadPic(i); loadPic(i + 1);
    pics.forEach(function (m, k) { m.classList.toggle('on', k === i); });
    names.forEach(function (b, k) { b.classList.toggle('on', k === i); });
  }
  names.forEach(function (b, i) {
    b.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') setTown(i); });
    b.addEventListener('focus', function () { setTown(i); });
  });
  function pickTown() {
    var mid = innerHeight * 0.5, best = -1, d = 1e9;
    names.forEach(function (b, i) { var r = b.getBoundingClientRect(), x = Math.abs(r.top + r.height / 2 - mid); if (x < d) { d = x; best = i; } });
    if (best >= 0 && d < innerHeight) setTown(best);
  }
  addEventListener('scroll', pickTown, { passive: true });
  setTown(0);
})();
