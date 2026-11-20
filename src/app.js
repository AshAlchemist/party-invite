/* Сценарий страницы: занавес, обложка, листание, анкета, финал, видео. */
(function () {
  'use strict';
  var W = window, d = document, root = d.documentElement;
  var CFG = W.PARTY || {};
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var reduce = W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = W.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var gsap = W.gsap, ST = W.ScrollTrigger, Split = W.SplitText, Silver = W.Silver;
  var motion = !!(gsap && ST && Split) && !reduce;
  var lenis = null, ball = null, fringes = [];

  try { history.scrollRestoration = 'manual'; } catch (e) {}

  // ---------- подгонка кегля под ширину ----------
  function fitOne(el) {
    var target = el.parentNode.clientWidth;
    if (!target) return;
    el.style.fontSize = '100px';
    var w = el.offsetWidth;
    if (w > 0) el.style.fontSize = Math.floor(100 * target / w * 0.992 * 10) / 10 + 'px';
  }
  function fitAll(scope) { $$('[data-fit]', scope).forEach(fitOne); }

  // ---------- листы журнала: высокий лист прилипает нижним краем ----------
  var probe = d.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none';
  d.body.appendChild(probe);
  var stacks = $$('.stack');
  function layoutStack() {
    var vh = Math.max(probe.offsetHeight, W.innerHeight);
    stacks.forEach(function (s) { s.style.top = Math.min(0, vh - s.offsetHeight) + 'px'; });
  }

  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  var ballWrap = $('#ballWrap');
  function relayout() {
    fitAll();
    // на телефоне и планшете шар висит на нижней кромке заголовка, на широком экране — уходит шнуром за край листа
    if (ballWrap) {
      if (W.innerWidth < 1000) ballWrap.style.setProperty('--cord', Math.round(ballWrap.offsetTop + ballWrap.offsetHeight * 0.09 + 6) + 'px');
      else ballWrap.style.removeProperty('--cord');
    }
    $$('.q textarea').forEach(autosize);
    layoutStack();
  }

  function lock(v) {
    root.classList.toggle('is-locked', v);
    if (lenis) { if (v) lenis.stop(); else lenis.start(); }
  }
  function scrollToEl(el, immediate) {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { immediate: !!immediate, duration: 1.6, force: true });
    else el.scrollIntoView({ behavior: immediate || reduce ? 'auto' : 'smooth', block: 'start' });
  }

  // =====================================================================
  //  АНКЕТА
  // =====================================================================
  var KEY = { id: 'party:id', draft: 'party:draft', sent: 'party:sent' };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function guestId() {
    var id = store.get(KEY.id);
    if (!id) {
      id = (W.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      store.set(KEY.id, id);
    }
    return id;
  }

  var form = $('#form'), done = $('#done'), statusEl = $('#status'), countEl = $('#count'), goBtn = $('#go');
  var fields = form ? $$('input[name], textarea[name]', form).filter(function (f) { return f.name !== 'website'; }) : [];
  var answers = fields.filter(function (f) { return /^q\d+$/.test(f.name); });

  function syncField(f) {
    var q = f.closest('.q');
    if (q) q.classList.toggle('is-filled', !!f.value.trim());
    if (f.tagName === 'TEXTAREA') autosize(f);
    var chips = q && $('.chips', q);
    if (chips) $$('.chip', chips).forEach(function (c) {
      var on = c.textContent === f.value.trim();
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function syncCount() {
    var n = answers.filter(function (f) { return f.value.trim(); }).length;
    if (countEl) countEl.textContent = 'Отвечено ' + n + ' из ' + answers.length;
  }
  var saveT = 0;
  function saveDraft() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      var o = {};
      fields.forEach(function (f) { o[f.name] = f.value; });
      store.set(KEY.draft, JSON.stringify(o));
    }, 250);
  }
  function setStatus(text) { if (statusEl) statusEl.textContent = text || ''; }

  function showDone(demo) {
    form.hidden = true;
    done.hidden = false;
    $('#doneNote').textContent = demo
      ? 'Режим показа: адрес таблицы ещё не задан, ответы остались только в этом браузере.'
      : 'Ответы записаны. Передумал — их можно изменить до самой вечеринки.';
  }

  function send(data) {
    var body = new URLSearchParams(data);
    var ctl = W.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    function post(mode) {
      return fetch(CFG.endpoint, { method: 'POST', body: body, mode: mode, redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    }
    return post('cors').then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'bad-response');
      });
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      // браузер не дал прочитать ответ (CORS) — отправляем «вслепую»: запись в таблицу при этом проходит
      return post('no-cors').then(function () {});
    }).then(function () { clearTimeout(timer); }, function (e) { clearTimeout(timer); throw e; });
  }

  function initForm() {
    if (!form) return;
    var draft = null;
    try { draft = JSON.parse(store.get(KEY.draft) || 'null'); } catch (e) {}
    fields.forEach(function (f) {
      if (draft && typeof draft[f.name] === 'string') f.value = draft[f.name];
      syncField(f);
      f.addEventListener('input', function () {
        syncField(f); syncCount(); saveDraft();
        var q = f.closest('.q');
        if (q && q.classList.contains('is-bad') && f.value.trim()) { q.classList.remove('is-bad'); f.removeAttribute('aria-invalid'); setStatus(''); }
      });
    });
    syncCount();
    $$('.chips', form).forEach(function (box) {
      var ta = $('#' + box.getAttribute('data-for'));
      $$('.chip', box).forEach(function (c) {
        c.setAttribute('aria-pressed', c.classList.contains('is-on') ? 'true' : 'false');
        c.addEventListener('click', function () {
          ta.value = c.classList.contains('is-on') ? '' : c.textContent;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
    });
    // Enter в поле имени ведёт к первому вопросу, а не отправляет анкету
    var nameF = $('#f-name');
    nameF.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#q1').focus(); } });

    if (store.get(KEY.sent)) showDone(!CFG.endpoint);

    $('#edit').addEventListener('click', function () {
      done.hidden = true; form.hidden = false;
      $$('.q textarea').forEach(autosize);
      if (ST) ST.refresh();
      nameF.focus({ preventScroll: true });
      scrollToEl($('#card'));
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (goBtn.disabled) return;
      var q = nameF.closest('.q');
      if (!nameF.value.trim()) {
        q.classList.add('is-bad');
        nameF.setAttribute('aria-invalid', 'true');
        setStatus('Впиши, пожалуйста, имя — иначе я не пойму, чьи это ответы.');
        nameF.focus({ preventScroll: true });
        scrollToEl(q);
        return;
      }
      setStatus('');
      var data = { id: guestId() };
      fields.forEach(function (f) { data[f.name] = f.value.trim(); });
      var trap = form.elements.website && form.elements.website.value;
      var label = $('.go__t', goBtn), text = label.textContent;
      function ok(demo) {
        store.set(KEY.sent, String(Date.now()));
        goBtn.disabled = false; label.textContent = text;
        showDone(demo);
        showFinale(demo);
      }
      if (trap) return ok(false);                 // ловушка для роботов: молча «принято»
      if (!CFG.endpoint) return ok(true);
      goBtn.disabled = true; label.textContent = 'Отправляю…';
      send(data).then(function () { ok(false); }, function () {
        goBtn.disabled = false; label.textContent = text;
        setStatus('Не получилось отправить: проверь интернет и нажми ещё раз. Ответы сохранены на этом устройстве.');
      });
    });
  }

  // =====================================================================
  //  ФИНАЛ: серебряный дождь
  // =====================================================================
  var finale = $('#finale'), rainJob = null, finaleOpen = false, lastFocus = null;
  function showFinale(demo) {
    if (!finale || finaleOpen) return;
    finaleOpen = true;
    lastFocus = d.activeElement;
    if (lastFocus && lastFocus.blur) lastFocus.blur();
    $('#finaleDemo').hidden = !demo;
    finale.hidden = false;
    finale.classList.remove('is-leaving');
    lock(true);
    fitAll(finale);
    var next = $('#finaleNext');
    // холст дождя одноразовый: после окончания контекст освобождается
    var old = $('#rain'), cv = old.cloneNode(false);
    old.parentNode.replaceChild(cv, old);
    if (motion) {
      var word = $('.finale__a span', finale);
      if (word._sp) word._sp.revert();
      word._sp = Split.create(word, { type: 'chars' });
      gsap.killTweensOf([finale, word._sp.chars, '.finale__b', next, '.finale__demo']);
      gsap.set(finale, { autoAlpha: 1 });
      gsap.fromTo(finale, { '--veil': 0 }, { '--veil': 1, duration: 0.45, ease: 'power2.out' });
      gsap.fromTo('#flash', { opacity: 0.85 }, { opacity: 0, duration: 1.1, ease: 'power2.out' });
      gsap.fromTo(word._sp.chars, { yPercent: 112 }, { yPercent: 0, duration: 1.25, ease: 'expo.out', stagger: 0.055, delay: 0.25 });
      gsap.fromTo('.finale__b', { clipPath: 'inset(-30% 105% -30% -5%)' }, { clipPath: 'inset(-30% -5% -30% -5%)', duration: 1.5, ease: 'power2.inOut', delay: 0.95 });
      gsap.fromTo([next, '.finale__demo'], { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 2.3, stagger: 0.1 });
      if (Silver && Silver.supported) rainJob = Silver.rain(cv, { duration: 15 });
    }
    setTimeout(function () { next.focus({ preventScroll: true }); }, 60);
  }
  function closeFinale() {
    if (!finaleOpen) return;
    finaleOpen = false;
    finale.classList.add('is-leaving');
    function end() {
      finale.hidden = true;
      if (rainJob) { rainJob.stop(); rainJob = null; }
    }
    lock(false);
    if (ST) ST.refresh();
    scrollToEl($('#gift'), true);
    if (motion) gsap.to(finale, { autoAlpha: 0, duration: 0.8, ease: 'power2.inOut', onComplete: end });
    else end();
  }
  if (finale) {
    $('#finaleNext').addEventListener('click', closeFinale);
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && finaleOpen) closeFinale(); });
  }

  // =====================================================================
  //  ВИДЕО
  // =====================================================================
  function initVideo() {
    var v = $('#video'), btn = $('#play'), bar = $('#bar'), box = $('#screen');
    if (!v || !btn) return;
    var label = $('span', btn), inView = false, userPaused = false, started = false, raf = 0;
    function show(text) { label.textContent = text; btn.classList.remove('is-off'); }
    function hide() { btn.classList.add('is-off'); }
    function muted() {                       // тихий автозапуск: так разрешают все браузеры
      v.muted = true; v.loop = true;
      show('Смотреть со звуком');
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
    function loud(fromStart) {
      v.muted = false; v.loop = false;
      if (fromStart) { try { v.currentTime = 0; } catch (e) {} }
      var p = v.play();
      if (p && p.then) p.then(hide, muted); else hide();
    }
    function progress() {
      raf = 0;
      if (v.duration) bar.style.transform = 'scaleX(' + (v.currentTime / v.duration).toFixed(4) + ')';
      if (!v.paused && !v.ended) raf = requestAnimationFrame(progress);
    }
    v.addEventListener('play', function () { if (!raf) raf = requestAnimationFrame(progress); });
    v.addEventListener('ended', function () { bar.style.transform = 'scaleX(1)'; show('Посмотреть ещё раз'); });
    btn.addEventListener('click', function () {
      userPaused = false;
      loud(v.muted || v.ended || !started || v.currentTime < 0.05);
      started = true;
    });
    v.addEventListener('click', function () {
      if (v.paused) { userPaused = false; loud(v.ended); }
      else { userPaused = true; v.pause(); show('Продолжить'); }
    });
    if (!('IntersectionObserver' in W)) return;
    new IntersectionObserver(function (es) {
      inView = es[0].isIntersecting && es[0].intersectionRatio >= 0.55;
      if (!inView) { if (!v.paused) v.pause(); return; }
      if (userPaused || v.ended || finaleOpen) return;
      if (!started) { started = true; if (reduce) show('Смотреть со звуком'); else loud(true); }
      else if (v.paused) { if (v.muted) muted(); else loud(false); }
    }, { threshold: [0, 0.55, 1] }).observe(box);
  }

  // =====================================================================
  //  ДВИЖЕНИЕ
  // =====================================================================
  var CLIP0 = 'inset(-30% 105% -30% -5%)', CLIP1 = 'inset(-30% -5% -30% -5%)';

  function initSmooth() {
    gsap.registerPlugin(ST, Split);
    if (W.CustomEase) gsap.registerPlugin(W.CustomEase);
    ST.config({ ignoreMobileResize: true });
    if (fine && W.Lenis) {
      lenis = new W.Lenis({ lerp: 0.105, wheelMultiplier: 1, autoRaf: false });
      lenis.on('scroll', ST.update);
      gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      gsap.ticker.lagSmoothing(0);
      lenis.stop();
    }
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var el = $(a.getAttribute('href'));
      if (el) { e.preventDefault(); scrollToEl(el); }
    });
  }

  function initSilver() {
    if (!Silver || !Silver.supported) { root.classList.add('no-gl'); return; }
    var bc = $('#ball');
    if (bc) { ball = Silver.ball(bc, { bands: 23, speed: 0.17, tilt: -0.2, seed: 5 }); $('#cover')._gl = [ball]; }
    $$('[data-fringe]').forEach(function (c) {
      var f = Silver.fringe(c, { seed: +c.getAttribute('data-seed') || 3, density: 1 });
      if (!f) return;
      fringes.push(f);
      var sec = c.closest('.stack');
      if (sec) (sec._gl = sec._gl || []).push(f);
    });
    // ветер от скорости листания
    var lastY = W.scrollY;
    gsap.ticker.add(function () {
      var y = W.scrollY, v = y - lastY;
      lastY = y;
      if (!v) return;
      for (var i = 0; i < fringes.length; i++) fringes[i].wind(v * 0.006);
      if (ball) ball.spin(v * 0.0011);
    });
  }

  function initStack() {
    stacks.forEach(function (sec) {
      var next = sec.nextElementSibling, shade = $('.shade', sec);
      if (!next) return;
      function covered(v) {
        sec.style.visibility = v ? 'hidden' : '';
        (sec._gl || []).forEach(function (g) { if (g && g.pause) g.pause(v); });
      }
      gsap.fromTo(shade, { opacity: 0 }, {
        opacity: 0.62, ease: 'none',
        scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true, onLeave: function () { covered(true); }, onEnterBack: function () { covered(false); } }
      });
    });
    // обложка уходит вглубь, пока на неё наезжает следующий лист
    var cover = $('#cover');
    if (cover) {
      var st = { trigger: '#dress', start: 'top bottom', end: 'top top', scrub: true };
      gsap.to('#glass img', { yPercent: -5, ease: 'none', scrollTrigger: st });
      gsap.to('.title', { yPercent: -10, ease: 'none', scrollTrigger: st });
      gsap.to('.note', { yPercent: -30, ease: 'none', scrollTrigger: st });
    }
  }

  function initReveals() {
    var notCover = function (el) { return !el.closest('#cover') && !el.closest('#finale'); };

    // строки из-под маски
    $$('[data-rise]').filter(notCover).forEach(function (el) {
      gsap.set(el, { autoAlpha: 0 });
      ST.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: function () {
          gsap.set(el, { autoAlpha: 1 });
          var sp = Split.create(el, { type: 'lines', mask: 'lines', linesClass: 'ln' });
          gsap.from(sp.lines, { yPercent: 118, duration: 1.2, ease: 'expo.out', stagger: 0.1, onComplete: function () { sp.revert(); } });
        }
      });
    });

    // буквы крупных слов
    $$('[data-chars]').filter(notCover).forEach(function (el, i) {
      var sp = Split.create(el, { type: 'chars', charsClass: 'ch' });
      if (el.hasAttribute('data-fit')) fitOne(el);
      gsap.set(sp.chars, { yPercent: 112 });
      ST.create({
        trigger: el.closest('.display, .date') || el, start: 'top 84%', once: true,
        onEnter: function () {
          gsap.to(sp.chars, { yPercent: 0, duration: 1.35, ease: 'expo.out', stagger: 0.06, delay: (i % 2) * 0.16 });
        }
      });
    });

    // рукописное «пишется»
    $$('[data-write]').filter(notCover).forEach(function (el) {
      gsap.set(el, { clipPath: CLIP0 });
      ST.create({
        trigger: el, start: 'top 86%', once: true,
        onEnter: function () { gsap.to(el, { clipPath: CLIP1, duration: 1.5, ease: 'power2.inOut', delay: 0.25, clearProps: 'clipPath' }); }
      });
    });

    // мелкие элементы
    var ins = $$('[data-in]').filter(notCover);
    gsap.set(ins, { autoAlpha: 0, y: 26 });
    ST.batch(ins, {
      start: 'top 92%', once: true,
      onEnter: function (batch) { gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.08, overwrite: true, clearProps: 'transform' }); }
    });

    // фото: шторка снизу вверх и вспышка
    $$('[data-photo]').forEach(function (el, i) {
      var img = $('img', el);
      gsap.set(el, { clipPath: 'inset(100% 0% 0% 0%)' });
      if (img) gsap.set(img, { scale: 1.28 });
      ST.create({
        trigger: el, start: 'top 90%', once: true,
        onEnter: function () {
          var dl = el.classList.contains('look') ? (i % 2) * 0.14 : 0;
          gsap.to(el, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.25, ease: 'expo.inOut', delay: dl, clearProps: 'clipPath' });
          gsap.fromTo(el, { '--pop': 0.9 }, { '--pop': 0, duration: 1.3, ease: 'power2.out', delay: dl + 0.5 });
          if (img) gsap.to(img, { scale: 1, duration: 1.9, ease: 'expo.out', delay: dl + 0.1 });
        }
      });
      if (img) gsap.fromTo(img, { yPercent: 0 }, { yPercent: -13.6, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    // палитра: круги выкатываются, серебро «играет» при листании
    var sws = $$('.sw');
    if (sws.length) {
      gsap.set(sws, { scale: 0, xPercent: -60 });
      ST.create({
        trigger: '.swatches', start: 'top 90%', once: true,
        onEnter: function () { gsap.to(sws, { scale: 1, xPercent: 0, duration: 1.1, ease: 'back.out(1.5)', stagger: 0.09 }); }
      });
      gsap.fromTo('.sw--silver i', { '--a': '20deg' }, { '--a': '380deg', ease: 'none', scrollTrigger: { trigger: '.swatches', start: 'top bottom', end: 'bottom top', scrub: true } });
    }

    // карточка анкеты ложится на стол
    var card = $('#card');
    if (card) gsap.from(card, { y: 90, rotation: -1.6, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: card, start: 'top 92%', once: true }, clearProps: 'transform' });

    // подпись в конце
    var bye = $('.foot__a');
    if (bye) {
      gsap.set(bye, { clipPath: CLIP0 });
      ST.create({ trigger: bye, start: 'top 92%', once: true, onEnter: function () { gsap.to(bye, { clipPath: CLIP1, duration: 1.6, ease: 'power2.inOut', clearProps: 'clipPath' }); } });
    }
  }

  function initPointer() {
    if (!fine) return;
    // параллакс обложки
    var glass = $('#glass'), bw = $('#ball');
    if (glass) {
      var gx = gsap.quickTo(glass, 'x', { duration: 1.1, ease: 'power3.out' }), gy = gsap.quickTo(glass, 'y', { duration: 1.1, ease: 'power3.out' });
      var bx = bw && gsap.quickTo(bw, 'x', { duration: 1.4, ease: 'power3.out' }), by = bw && gsap.quickTo(bw, 'y', { duration: 1.4, ease: 'power3.out' });
      W.addEventListener('pointermove', function (e) {
        if (W.scrollY > W.innerHeight) return;
        var nx = e.clientX / W.innerWidth - 0.5, ny = e.clientY / W.innerHeight - 0.5;
        gx(nx * -18); gy(ny * -12);
        if (bx) { bx(nx * 26); by(ny * 16); }
      }, { passive: true });
    }
    // магнитные кнопки
    $$('[data-magnet]').forEach(function (el) {
      var mx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' }), my = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.16); my((e.clientY - r.top - r.height / 2) * 0.3);
      });
      el.addEventListener('pointerleave', function () { mx(0); my(0); });
    });
  }

  // ---------- выход обложки ----------
  function coverSet() {
    gsap.set('.title__fit', { yPercent: 112 });
    gsap.set('#glass', { autoAlpha: 0, yPercent: 7, scale: 1.05, transformOrigin: '60% 60%' });
    gsap.set('#ballWrap', { y: -W.innerHeight });
    gsap.set('.note__hi', { clipPath: CLIP0 });
    gsap.set($$('#cover [data-in]'), { autoAlpha: 0, y: 16 });
  }
  function coverPlay(tl, at) {
    tl.to('.title__fit', { yPercent: 0, duration: 1.5, ease: 'expo.out', stagger: 0.16 }, at)
      .to('#glass', { autoAlpha: 1, duration: 0.7, ease: 'power2.out' }, at + 0.05)
      .to('#glass', { yPercent: 0, scale: 1, duration: 2.1, ease: 'expo.out' }, at + 0.05)
      .to('#ballWrap', { y: 0, duration: 2.3, ease: 'elastic.out(0.55, 0.62)' }, at + 0.25)
      .to('.note__hi', { clipPath: CLIP1, duration: 1.5, ease: 'power2.inOut' }, at + 0.85)
      .to($$('#cover [data-in]'), { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.09 }, at + 1.25);
    // шар покачивается на шнуре
    gsap.fromTo('#ballWrap', { rotation: -1.3 }, { rotation: 1.3, duration: 3.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }

  // ---------- занавес ----------
  function ready(maxMs) {
    var hero = $('#glass img');
    var jobs = [
      d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve(),
      hero ? (hero.decode ? hero.decode().catch(function () {}) : new Promise(function (r) { if (hero.complete) r(); else hero.onload = hero.onerror = r; })) : Promise.resolve(),
      Silver && Silver.supported ? Silver.loadEnv().catch(function () {}) : Promise.resolve()
    ];
    return Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, maxMs); })]);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function open() {
    root.classList.remove('is-loading');
    if (lenis) lenis.start();
    ST.refresh();
    var hash = location.hash && $(location.hash);
    if (hash) scrollToEl(hash, true);
  }

  function intro() {
    var box = $('#intro'), cv = $('#curtain'), flash = $('#flash');
    var curtain = Silver && Silver.supported ? Silver.fringe(cv, { curtain: true, seed: 7, density: 1.15, minLen: 1.02, maxLen: 1.12 }) : null;
    if (!curtain) box.classList.add('is-plain');
    W.scrollTo(0, 0);
    Promise.all([ready(6000), wait(1500)]).then(function () {
      relayout();
      coverSet();
      var tl = gsap.timeline({ onComplete: function () { if (curtain) curtain.stop(); box.remove(); } });
      tl.to(flash, { opacity: 1, duration: 0.07, ease: 'power4.in' })
        .add(function () { box.style.background = 'transparent'; open(); if (ball) ball.flash(3.2); })
        .to(flash, { opacity: 0, duration: 1.15, ease: 'power2.out' });
      if (curtain) {
        tl.fromTo(curtain.state, { flash: 4 }, { flash: 1, duration: 1.4, ease: 'power2.out' }, 0.07)
          .to(curtain.state, { open: 1, duration: 2.2, ease: 'power3.inOut' }, 0.09)
          .to(box, { autoAlpha: 0, duration: 0.5, ease: 'power1.in' }, 1.85);
      } else {
        tl.to(box, { autoAlpha: 0, duration: 0.5 }, 0.07);
      }
      coverPlay(tl, 0.42);
      if (ball) { var bf = { v: 3.2 }; tl.to(bf, { v: 1, duration: 2, ease: 'power2.out', onUpdate: function () { ball.flash(bf.v); } }, 0.1); }
    });
  }

  // =====================================================================
  //  ЗАПУСК
  // =====================================================================
  function plain() {                       // без анимации: всё видно сразу
    var box = $('#intro');
    if (box) box.remove();
    root.classList.remove('is-loading');
    relayout();
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(relayout);
    var rt = 0;
    W.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(relayout, 150); });
    if (Silver && Silver.supported) {
      var bc = $('#ball');
      if (bc) Silver.ball(bc, { bands: 23, speed: 0.17, tilt: -0.2, seed: 5 });
      $$('[data-fringe]').forEach(function (c) { Silver.fringe(c, { seed: +c.getAttribute('data-seed') || 3 }); });
    }
  }

  initForm();
  initVideo();

  if (!motion) { plain(); return; }
  try {
    initSmooth();
    relayout();
    initSilver();
    ST.addEventListener('refreshInit', relayout);
    d.fonts.ready.then(function () {
      relayout();
      initStack();
      initReveals();
      initPointer();
      ST.refresh();
    });
    intro();
    // страховка: занавес не должен остаться навсегда
    setTimeout(function () {
      if (root.classList.contains('is-loading')) { var b = $('#intro'); if (b) b.remove(); open(); gsap.set('#cover *', { clearProps: 'all' }); }
    }, 11000);
  } catch (err) {
    if (W.console) console.error(err);
    plain();
  }
})();
