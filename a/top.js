(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var worryLinks = [].slice.call(document.querySelectorAll('.worries a'));
  var worryPics = [].slice.call(document.querySelectorAll('.s-worry .pics img'));

  // 悩みで写真を替える(動きを減らす設定でも機能する)
  var curPic = 0;
  function setWorry(i) {
    if (i === curPic || !worryPics[i]) return;
    worryPics.forEach(function (p) { p.classList.remove('was'); });
    worryPics[curPic].classList.remove('on');
    worryPics[curPic].classList.add('was');
    worryPics[i].classList.add('on');
    worryLinks.forEach(function (a, k) { a.classList.toggle('on', k === i); });
    curPic = i;
  }
  worryLinks.forEach(function (a, i) {
    a.addEventListener('pointerenter', function () { setWorry(i); });
    a.addEventListener('focus', function () { setWorry(i); });
  });

  // 地域の行に合わせて背景の衛星写真を替える(動きを減らす設定でも機能する)
  var areaPics = [].slice.call(document.querySelectorAll('.area-bg img'));
  var areaRows = [].slice.call(document.querySelectorAll('.area-rows a'));
  var curArea = null;
  function showArea(name, row) {
    areaRows.forEach(function (r) { r.classList.toggle('on', r === row); });
    if (name === curArea) return;
    curArea = name;
    var next = areaPics.filter(function (im) { return im.dataset.pic === name; })[0];
    if (!next) return;
    // 読み終えてから替える。読めなければ今の写真を残す
    var swap = function () {
      if (curArea !== name) return;
      areaPics.forEach(function (im) { im.classList.toggle('on', im === next); });
    };
    if (next.dataset.src) {
      next.addEventListener('load', swap, { once: true });
      next.src = next.dataset.src;
      delete next.dataset.src;
    } else if (next.complete && next.naturalWidth) {
      swap();
    } else {
      next.addEventListener('load', swap, { once: true });
    }
  }
  areaRows.forEach(function (r) {
    r.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') showArea(r.dataset.pic, r); });
    r.addEventListener('focus', function () { showArea(r.dataset.pic, r); });
  });
  function areaByScroll() {
    var mid = innerHeight * 0.5, best = null, d = 1e9;
    areaRows.forEach(function (r) { var q = r.getBoundingClientRect(), x = Math.abs(q.top + q.height / 2 - mid); if (x < d) { d = x; best = r; } });
    if (best && d < innerHeight * 0.6) showArea(best.dataset.pic, best);
  }
  addEventListener('scroll', areaByScroll, { passive: true });
  addEventListener('resize', areaByScroll);
  addEventListener('pageshow', areaByScroll);
  // 区画に近づいたら最初の写真を読む。遅延読み込みに任せると急に飛んだ時に空のまま残る
  var firstArea = function () { if (areaRows[0] && curArea === null) showArea(areaRows[0].dataset.pic, areaRows[0]); areaByScroll(); };
  var areaEl = document.querySelector('.s-area');
  if (areaEl && window.IntersectionObserver) {
    var areaIo = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { areaIo.disconnect(); firstArea(); } }, { rootMargin: '1500px 0px' });
    areaIo.observe(areaEl);
  } else {
    firstArea();
  }

  if (reduce || !window.gsap || !window.ScrollTrigger) {
    var sideEl = document.querySelector('.s-side');
    if (sideEl) sideEl.classList.add('free');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  var isWide = matchMedia('(min-width: 1000px)').matches;

  // 1: 楕円の窓が全画面へ開き、言葉が左右へ割れる
  gsap.timeline({ scrollTrigger: { trigger: '.s-open', start: 'top top', end: 'bottom bottom', scrub: 0.6 } })
    .to('.s-open .win', { clipPath: 'ellipse(95% 95% at 50% 50%)', ease: 'none', duration: 1 }, 0)
    .to('.s-open .win img', { scale: 1, ease: 'none', duration: 1 }, 0)
    .to('.s-open .say b:first-child', isWide ? { xPercent: -26, color: '#ffffff', ease: 'none', duration: 0.65 } : { yPercent: -60, color: '#ffffff', ease: 'none', duration: 0.65 }, 0)
    .to('.s-open .say b:last-child', isWide ? { xPercent: 26, color: '#ffffff', ease: 'none', duration: 0.65 } : { yPercent: 60, color: '#ffffff', ease: 'none', duration: 0.65 }, 0)
    .to('.s-open .say', { opacity: 0, duration: 0.25 }, 0.72)
    .to('.s-open h1', { color: '#ffffff', duration: 0.2 }, 0.3)
    .fromTo('.s-open .under', { opacity: 0 }, { opacity: 1, duration: 0.22, immediateRender: true }, 0.78);

  // 3: スクロールでも悩みが順に替わる
  worryLinks.forEach(function (a, i) {
    ScrollTrigger.create({ trigger: a, start: 'top 62%', end: 'bottom 62%', onEnter: function () { setWorry(i); }, onEnterBack: function () { setWorry(i); } });
  });

  // 4: 物件を横へ送る。スマホは指で送る
  var side = document.querySelector('.s-side');
  var track = document.querySelector('.side-track');
  if (side && track) {
    if (isWide) {
      var dist = function () { return track.scrollWidth - innerWidth; };
      var move = gsap.to(track, { x: function () { return -dist(); }, ease: 'none', scrollTrigger: { trigger: side, start: 'top top', end: function () { return '+=' + dist(); }, scrub: 0.5, pin: true, invalidateOnRefresh: true } });
      document.querySelectorAll('.lotp img').forEach(function (img) {
        gsap.fromTo(img, { xPercent: -8 }, { xPercent: 8, ease: 'none', scrollTrigger: { trigger: img.parentNode, containerAnimation: move, start: 'left right', end: 'right left', scrub: true } });
      });
    } else {
      side.classList.add('free');
    }
  }

  // 5: 線が伸び、段が現れる
  gsap.to('.track .fill', { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.track', start: 'top 70%', end: 'bottom 70%', scrub: 0.4 } });
  document.querySelectorAll('.track li').forEach(function (li) {
    gsap.from(li, { opacity: 0.12, x: 40, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: li, start: 'top 72%', toggleActions: 'play none none reverse' } });
  });

  // 写真の視差、見出しの立ち上がり
  document.querySelectorAll('.s-end img').forEach(function (img) {
    gsap.fromTo(img, { yPercent: -7 }, { yPercent: 7, ease: 'none', scrollTrigger: { trigger: img.parentNode, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  document.querySelectorAll('[data-rise]').forEach(function (el) {
    gsap.from(el, { yPercent: 30, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 86%' } });
  });

  // 画像の読み込み後に位置を取り直す
  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
