// 全ページ共通: 幕、慣性スクロール、写真の開き、ページ遷移。動きを減らす設定では何もしない。
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;
  var curtain = document.querySelector('.curtain');
  if (reduce || !window.gsap || !window.ScrollTrigger) { html.classList.remove('cover'); return; }
  gsap.registerPlugin(ScrollTrigger);

  // 慣性スクロール
  var lenis = window.Lenis ? new Lenis({ lerp: 0.1 }) : null;
  window.meijiLenis = lenis;
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var el = document.querySelector(a.getAttribute('href'));
      if (el && lenis) { e.preventDefault(); lenis.scrollTo(el, { offset: -80 }); }
    });
  });

  // 幕を開ける。CSSの保険を外してからGSAPが受け持つ
  function open(intro) {
    var tl = gsap.timeline();
    gsap.set(curtain, { yPercent: 0, y: 0 });
    html.classList.remove('cover');
    curtain.style.transform = 'translateY(0)';
    if (intro) {
      tl.from('.curtain i', { yPercent: 110, duration: 0.5, ease: 'power3.out', stagger: 0.03 })
        .to('.curtain i', { yPercent: -110, duration: 0.3, ease: 'power3.in', stagger: 0.02, delay: 0.1 });
    }
    tl.to(curtain, { yPercent: -101, duration: intro ? 0.6 : 0.4, ease: 'power3.inOut' });
    return tl;
  }
  var mode = html.dataset.cover;
  var enter = (curtain && html.classList.contains('cover')) ? open(mode === 'intro') : gsap.timeline();
  if (curtain && !html.classList.contains('cover') && !mode) gsap.set(curtain, { yPercent: -101 });

  // ページ遷移: 幕を下ろしてから移動する
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !curtain || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.hash && url.pathname === location.pathname) return;
    e.preventDefault();
    try { sessionStorage.setItem('meiji-tr', '1'); } catch (err) { /* 保存できなくても移動はする */ }
    // 幕が止まっても移動できるよう、時間でも移動する
    var moved = false;
    var go = function () { if (!moved) { moved = true; location.href = a.href; } };
    setTimeout(go, 500);
    gsap.fromTo(curtain, { yPercent: 101 }, { yPercent: 0, duration: 0.25, ease: 'power2.inOut', onComplete: go });
  });
  addEventListener('pageshow', function (e) { if (e.persisted && curtain) gsap.set(curtain, { yPercent: -101 }); });

  // 見出しのある写真
  document.querySelectorAll('.ph').forEach(function (ph) {
    var img = ph.querySelector('img');
    enter.from(img, { scale: 1.18, duration: 1.6, ease: 'power3.out' }, '-=0.6')
      .from(ph.querySelector('.ph-in'), { y: 60, opacity: 0, duration: 1, ease: 'power3.out' }, '-=1.3');
    gsap.to(img, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: ph, start: 'top top', end: 'bottom top', scrub: true } });
  });
  // 本文の写真: 細い窓から開く
  document.querySelectorAll('.brk img').forEach(function (img) {
    gsap.fromTo(img, { clipPath: 'inset(18% 26% 18% 26%)', scale: 1.22 }, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, ease: 'none', scrollTrigger: { trigger: img.parentNode, start: 'top 92%', end: 'top 30%', scrub: 0.4 } });
  });
  // 章の見出しと物件の行
  document.querySelectorAll('.prose h2, .chapter h2, .ask-bar h2').forEach(function (h) {
    gsap.from(h, { y: 44, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: h, start: 'top 88%' } });
  });
  gsap.utils.toArray('.cat-row').slice(0, 60).forEach(function (r) {
    gsap.from(r, { y: 24, opacity: 0, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: r, start: 'top 94%' } });
  });
  // 広さの図: 実面積の正方形がスクロールで育つ
  document.querySelectorAll('.plot rect').forEach(function (r) {
    gsap.from(r, { scale: 0.02, ease: 'power2.out', duration: 1.2, scrollTrigger: { trigger: r.closest('svg'), start: 'top 80%' } });
  });
  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
