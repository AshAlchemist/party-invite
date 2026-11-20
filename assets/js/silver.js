/* Живое серебро: диско-шар, бахрома, серебряный дождь. WebGL2 без библиотек.
   Каждый эффект — свой холст и контекст; рисует только пока виден. */
(function () {
  'use strict';

  var ENV_SRC = (window.PARTY && window.PARTY.env) || 'assets/img/env.jpg';
  var envPromise = null;
  function loadEnv() {
    if (!envPromise) {
      envPromise = new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = rej;
        im.src = ENV_SRC;
      });
    }
    return envPromise;
  }

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- общие куски шейдеров ----------
  var ENV_GLSL = [
    'uniform sampler2D uEnv;',
    'uniform float uEnvRot;',
    'float envL(vec3 d, float lod){',
    '  d = normalize(d);',
    '  float u = atan(d.z, d.x) * 0.15915494 + 0.5 + uEnvRot;',
    '  float v = acos(clamp(d.y, -1.0, 1.0)) * 0.31830989;',
    '  float g = textureLod(uEnv, vec2(u, v), lod).r;',
    '  float l = pow(g, 2.2);',
    '  return l * (1.0 + 10.0 * smoothstep(0.80, 1.0, g));',   // псевдо-HDR: лампы «горят»
    '}',
    'vec3 film(vec3 c){',
    '  c = c * (1.0 + c * 0.12) / (1.0 + c * 0.62);',
    '  return pow(clamp(c, 0.0, 1.0), vec3(0.4545));',
    '}'
  ].join('\n');

  function GL(canvas, opts) {
    var gl = canvas.getContext('webgl2', Object.assign({ alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'high-performance' }, opts || {}));
    return gl;
  }
  function prog(gl, vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, '#version 300 es\nprecision highp float;\n' + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var cache = {};
    return {
      p: p,
      u: function (n) { return cache[n] !== undefined ? cache[n] : (cache[n] = gl.getUniformLocation(p, n)); },
      a: function (n) { return gl.getAttribLocation(p, n); }
    };
  }
  function envTex(gl, img) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function buf(gl, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }
  function attr(gl, loc, size, stride, offset, divisor) {
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, divisor || 0);
  }
  function rnd(seed) {           // детерминированный генератор — картинка одинакова от загрузки к загрузке
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // цикл отрисовки, который спит, пока холст вне экрана или вкладка скрыта
  function loop(canvas, frame, always) {
    var visible = !!always, paused = false, raf = 0, alive = true, t0 = performance.now(), last = t0;
    function tick(now) {
      raf = 0;
      if (!alive) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame((now - t0) / 1000, dt);
      if (visible && !paused && !document.hidden) raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf && alive && visible && !paused && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }
    var io = null;
    if (!always && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick(); }, { rootMargin: '120px' });
      io.observe(canvas);
    } else visible = true;
    document.addEventListener('visibilitychange', kick);
    kick();
    return {
      kick: kick,
      pause: function (v) { paused = !!v; kick(); },
      stop: function () { alive = false; if (raf) cancelAnimationFrame(raf); if (io) io.disconnect(); document.removeEventListener('visibilitychange', kick); }
    };
  }
  function fit(canvas, gl, maxDpr) {
    var dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
    var w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    return dpr;
  }

  // =====================================================================
  //  ДИСКО-ШАР
  // =====================================================================
  function ball(canvas, o) {
    o = Object.assign({ bands: 21, speed: 0.16, tilt: -0.2, cam: 5.6, seed: 7 }, o || {});
    var gl = GL(canvas);
    if (!gl) return null;
    var R = rnd(o.seed);
    var B = o.bands, E = B * 2, inst = [];
    for (var i = 0; i < B; i++) {
      var lat = -Math.PI / 2 + (i + 0.5) * Math.PI / B;
      var n = Math.max(4, Math.round(E * Math.cos(lat)));
      var off = R();
      for (var j = 0; j < n; j++) {
        var lon = (j + off) / n * Math.PI * 2;
        var cx = Math.cos(lat) * Math.cos(lon), cy = Math.sin(lat), cz = Math.cos(lat) * Math.sin(lon);
        var ex = -Math.sin(lon), ez = Math.cos(lon);
        var hw = Math.PI * Math.cos(lat) / n * 0.93, hh = Math.PI / (2 * B) * 0.93;
        inst.push(cx, cy, cz, ex, 0, ez, hw, hh, (R() - 0.5) * 0.16, (R() - 0.5) * 0.16, 0.82 + R() * 0.26, R());
      }
    }
    var N = inst.length / 12;
    var quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    var COMMON_VS = [
      'in vec2 aPos; in vec3 aDir; in vec3 aEast; in vec2 aSize; in vec4 aRnd;',
      'uniform mat3 uRot; uniform vec2 uProj; uniform float uCam;',
      'vec4 proj(vec3 P){ float w = uCam - P.z; return vec4(P.x * uProj.x, P.y * uProj.y, -P.z * 0.1 * w, w); }'
    ].join('\n');

    var tiles = prog(gl, COMMON_VS + [
      'out vec3 vP; out vec3 vN; out vec2 vUv; out float vK;',
      'void main(){',
      '  vec3 nn = cross(aDir, aEast);',
      '  vec3 nt = normalize(aDir + aEast * aRnd.x + nn * aRnd.y);',
      '  vec3 P = aDir + aEast * aPos.x * aSize.x + nn * aPos.y * aSize.y;',
      '  vP = uRot * P; vN = uRot * nt; vUv = aPos; vK = aRnd.z;',
      '  gl_Position = proj(vP);',
      '}'
    ].join('\n'), ENV_GLSL + [
      'in vec3 vP; in vec3 vN; in vec2 vUv; in float vK;',
      'uniform float uCam; uniform float uFlash;',
      'out vec4 o;',
      'void main(){',
      '  vec3 N = normalize(vN);',
      '  vec3 V = normalize(vec3(0.0, 0.0, uCam) - vP);',
      '  vec3 Rf = reflect(-V, N);',
      '  float l = envL(Rf, 1.0) * vK * 2.3 + 0.07 + 0.10 * (0.5 + 0.5 * N.y);',
      '  l *= 0.5 + 1.0 * fract(vK * 57.3);',
      '  l *= 0.34 + 1.05 * pow(max(dot(N, normalize(vec3(-0.45, 0.62, 0.64))), 0.0), 1.4);',
      '  float nv = max(dot(N, V), 0.0);',
      '  l += pow(nv, 260.0) * 26.0 * uFlash;',                    // вспышка в лоб
      '  l += pow(nv, 12.0) * 0.10 * uFlash;',
      '  float e = max(abs(vUv.x), abs(vUv.y));',
      '  l *= mix(0.30, 1.0, smoothstep(1.0, 0.84, e));',          // фаска плитки
      '  l = l * 0.94 + 0.012;',
      '  o = vec4(film(vec3(l, l, l * 1.02)), 1.0);',
      '}'
    ].join('\n'));

    var base = prog(gl, [
      'in vec2 aPos; uniform vec2 uProj; uniform float uCam; out vec2 vUv;',
      'void main(){ vUv = aPos; vec3 P = vec3(aPos * 1.012, -0.16); float w = uCam - P.z; gl_Position = vec4(P.x * uProj.x, P.y * uProj.y, -P.z * 0.1 * w, w); }'
    ].join('\n'), [
      'in vec2 vUv; out vec4 o;',
      'void main(){',
      '  float r = length(vUv);',
      '  float a = smoothstep(1.0, 0.985, r);',
      '  float sh = 0.045 + 0.05 * sqrt(max(0.0, 1.0 - r * r));',
      '  o = vec4(vec3(sh) * a, a);',
      '}'
    ].join('\n'));

    var glints = prog(gl, COMMON_VS + ENV_GLSL + [
      'uniform float uFlash; uniform float uAspect; uniform float uTime;',
      'out vec2 vUv; out float vI;',
      'void main(){',
      '  vec3 nn = cross(aDir, aEast);',
      '  vec3 nt = normalize(aDir + aEast * aRnd.x + nn * aRnd.y);',
      '  vec3 P = uRot * aDir; vec3 N = uRot * nt;',
      '  vec3 V = normalize(vec3(0.0, 0.0, uCam) - P);',
      '  float nv = dot(N, V);',
      '  float l = envL(reflect(-V, N), 2.0) * aRnd.z + pow(max(nv, 0.0), 260.0) * 26.0 * uFlash;',
      '  float I = smoothstep(5.5, 16.0, l) * step(0.12, nv);',
      '  I *= 0.75 + 0.25 * sin(uTime * 9.0 + aRnd.w * 60.0);',
      '  vI = I; vUv = aPos;',
      '  vec4 c = proj(P);',
      '  float s = 0.34 * I;',
      '  c.xy += aPos * vec2(s * uProj.x, s * uProj.y) * c.w / uCam * 1.0;',
      '  c.z = -0.9 * c.w;',
      '  gl_Position = I > 0.01 ? c : vec4(2.0, 2.0, 2.0, 1.0);',
      '}'
    ].join('\n'), [
      'in vec2 vUv; in float vI; out vec4 o;',
      'void main(){',
      '  vec2 a = abs(vUv);',
      '  float core = exp(-dot(vUv, vUv) * 26.0);',
      '  float rays = exp(-a.y * 46.0) * pow(max(0.0, 1.0 - a.x), 2.6) + exp(-a.x * 46.0) * pow(max(0.0, 1.0 - a.y), 2.6);',
      '  float s = (core * 1.2 + rays * 0.85) * vI;',
      '  o = vec4(vec3(s), s * 0.55);',
      '}'
    ].join('\n'));

    var qb = buf(gl, quad), ib = buf(gl, new Float32Array(inst));
    function vao(p) {
      var v = gl.createVertexArray();
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      attr(gl, p.a('aPos'), 2, 0, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      attr(gl, p.a('aDir'), 3, 48, 0, 1);
      attr(gl, p.a('aEast'), 3, 48, 12, 1);
      attr(gl, p.a('aSize'), 2, 48, 24, 1);
      attr(gl, p.a('aRnd'), 4, 48, 32, 1);
      gl.bindVertexArray(null);
      return v;
    }
    var vTiles = vao(tiles), vGl = vao(glints);
    var vBase = gl.createVertexArray();
    gl.bindVertexArray(vBase);
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    attr(gl, base.a('aPos'), 2, 0, 0, 0);
    gl.bindVertexArray(null);

    var tex = null, angle = 0.6, state = { boost: 0, flash: 1 };
    loadEnv().then(function (img) { tex = envTex(gl, img); L.kick(); });

    function frame(t, dt) {
      fit(canvas, gl, 2);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!tex) return;
      angle += dt * (o.speed + state.boost) * (reduce ? 0.25 : 1);
      state.boost *= Math.pow(0.04, dt);
      var ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(o.tilt), st = Math.sin(o.tilt);
      // uRot = Rx(tilt) * Ry(angle), по столбцам
      var rot = new Float32Array([ca, st * sa, -ct * sa, 0, ct, st, sa, -st * ca, ct * ca]);
      var f = 1 / Math.tan(0.5 * 0.42), asp = canvas.width / canvas.height;
      function common(p) {
        gl.useProgram(p.p);
        gl.uniformMatrix3fv(p.u('uRot'), false, rot);
        gl.uniform2f(p.u('uProj'), f / asp, f);
        gl.uniform1f(p.u('uCam'), o.cam);
        gl.uniform1f(p.u('uFlash'), state.flash);
        gl.uniform1f(p.u('uEnvRot'), 0.18);
        gl.uniform1f(p.u('uTime'), t);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(p.u('uEnv'), 0);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      common(base);
      gl.bindVertexArray(vBase);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      common(tiles);
      gl.bindVertexArray(vTiles);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
      gl.disable(gl.DEPTH_TEST);
      common(glints);
      gl.bindVertexArray(vGl);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
      gl.bindVertexArray(null);
    }
    var L = loop(canvas, frame);
    return {
      spin: function (v) { state.boost = Math.max(-1.6, Math.min(1.6, state.boost + v)); },
      flash: function (v) { state.flash = v; },
      pause: L.pause,
      stop: L.stop
    };
  }

  // =====================================================================
  //  БАХРОМА
  // =====================================================================
  function fringe(canvas, o) {
    o = Object.assign({ density: 1, minLen: 0.55, maxLen: 1.0, seed: 3, curtain: false, strand: 5.5 }, o || {});
    var gl = GL(canvas);
    if (!gl) return null;
    var SEG = 22;
    var strip = [];
    for (var s = 0; s <= SEG; s++) { strip.push(s / SEG, -1, s / SEG, 1); }
    var p = prog(gl, [
      'in vec2 aV;',                       // t вдоль нити, сторона
      'in vec4 aI;',                       // x (0..1), длина (0..1), фаза, случайное
      'in vec2 aJ;',                       // слой, ширина
      'uniform vec2 uRes; uniform float uTime; uniform float uOpen; uniform float uWind; uniform vec3 uPtr; uniform float uDpr; uniform float uDrop;',
      'out vec3 vN; out float vT; out float vLayer; out float vR;',
      'void main(){',
      '  float t = aV.x;',
      '  float x0 = aI.x * uRes.x;',
      '  float len = aI.y * uRes.y * uDrop;',
      '  float ph = aI.z * 6.2831853;',
      '  float k = uDpr;',
      '  float sw = (sin(uTime * 0.8 + ph + t * 2.4) * 7.0 + sin(uTime * 1.9 + ph * 7.0 + t * 6.0) * 2.4) * t * k;',
      '  float dx = x0 - uPtr.x;',
      '  float inf = exp(-dx * dx / (uPtr.z * uPtr.z)) * smoothstep(0.0, 0.25, t);',
      '  float push = (dx >= 0.0 ? 1.0 : -1.0) * inf * 46.0 * k * t;',
      '  float wind = uWind * (0.5 + aI.w) * t * t * 90.0 * k;',
      '  float side = aI.x < 0.5 ? -1.0 : 1.0;',
      '  float lag = uOpen * uOpen * (3.0 - 2.0 * uOpen);',
      '  float op = side * (uOpen * (0.62 + aI.w * 0.5) * uRes.x * mix(1.0, 0.62, t) + (uOpen - lag) * 90.0 * k * t);',
      '  float a = ph * 3.0 + t * (5.0 + aI.w * 9.0) + sin(uTime * 1.25 + ph * 5.0 + t * 3.5) * 1.05 + push * 0.04 + wind * 0.02 + uOpen * 4.0 * aI.w;',
      '  float w = aJ.y * k;',
      '  float cw = cos(a);',
      '  float proj = (abs(cw) < 0.22 ? (cw < 0.0 ? -0.22 : 0.22) : cw);',
      '  float x = x0 + sw + push + wind + op + aV.y * w * 0.5 * proj;',
      '  float y = t * len * (1.0 - 0.18 * uOpen);',
      '  vN = vec3(-sin(a), 0.22 * sin(t * 11.0 + ph * 9.0), cw);',
      '  vT = t; vLayer = aJ.x; vR = aI.w;',
      '  gl_Position = vec4(x / uRes.x * 2.0 - 1.0, 1.0 - y / uRes.y * 2.0, 0.0, 1.0);',
      '}'
    ].join('\n'), ENV_GLSL + [
      'in vec3 vN; in float vT; in float vLayer; in float vR;',
      'uniform float uFlash;',
      'out vec4 o;',
      'void main(){',
      '  vec3 N = normalize(vN); if (N.z < 0.0) N = -N;',
      '  vec3 Rf = reflect(vec3(0.0, 0.0, -1.0), N);',
      '  float l = envL(Rf, 2.2) * 1.15;',
      '  l += pow(N.z, 90.0) * 7.0 * uFlash;',
      '  l += pow(N.z, 6.0) * 0.16 * uFlash;',
      '  l *= mix(0.42, 1.0, vLayer) * (0.86 + 0.28 * vR);',
      '  l = l + 0.018;',
      '  o = vec4(film(vec3(l, l, l * 1.015)), 1.0);',
      '}'
    ].join('\n'));

    var vb = buf(gl, new Float32Array(strip));
    var ib = gl.createBuffer(), count = 0, builtW = 0;
    var v = gl.createVertexArray();
    function build() {
      var cssW = canvas.clientWidth;
      if (Math.abs(cssW - builtW) < 2) return;
      builtW = cssW;
      var R = rnd(o.seed), data = [];
      var step = o.strand * 0.62 / o.density;
      for (var layer = 0; layer < 2; layer++) {
        var n = Math.ceil(cssW / step) + 2;
        for (var i = 0; i < n; i++) {
          var x = (i + (R() - 0.5) * 0.9 + layer * 0.5) / n;
          var edge = o.curtain ? 1.0 : (0.80 + 0.20 * Math.pow(Math.abs(Math.sin(x * Math.PI * 3.0 + 0.4)), 0.6));
          var len = (o.minLen + (o.maxLen - o.minLen) * (0.55 + 0.45 * R())) * edge;
          if (o.curtain) len = 1.04 + R() * 0.05;
          data.push(x, len, R(), R(), layer, o.strand * (0.8 + R() * 0.5));
        }
      }
      count = data.length / 6;
      gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      attr(gl, p.a('aV'), 2, 0, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      attr(gl, p.a('aI'), 4, 24, 0, 1);
      attr(gl, p.a('aJ'), 2, 24, 16, 1);
      gl.bindVertexArray(null);
    }
    var tex = null;
    var st = { open: 0, wind: 0, windT: 0, px: -9999, pxT: -9999, drop: o.curtain ? 1 : 1, flash: 1 };
    loadEnv().then(function (img) { tex = envTex(gl, img); L.kick(); });

    function frame(t, dt) {
      var dpr = fit(canvas, gl, o.curtain ? 1.5 : 2);
      build();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!tex || !count) return;
      st.wind += (st.windT - st.wind) * Math.min(1, dt * 5);
      st.windT *= Math.pow(0.02, dt);
      st.px += (st.pxT - st.px) * Math.min(1, dt * 9);
      gl.useProgram(p.p);
      gl.uniform2f(p.u('uRes'), canvas.width, canvas.height);
      gl.uniform1f(p.u('uTime'), reduce ? 0 : t);
      gl.uniform1f(p.u('uOpen'), st.open);
      gl.uniform1f(p.u('uWind'), st.wind);
      gl.uniform1f(p.u('uDpr'), dpr);
      gl.uniform1f(p.u('uDrop'), st.drop);
      gl.uniform1f(p.u('uFlash'), st.flash);
      gl.uniform3f(p.u('uPtr'), st.px * dpr, 0, 70 * dpr);
      gl.uniform1f(p.u('uEnvRot'), 0.31);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.u('uEnv'), 0);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(v);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, count);
      gl.bindVertexArray(null);
    }
    var L = loop(canvas, frame, o.curtain);
    function onMove(e) {
      var r = canvas.getBoundingClientRect();
      var y = e.clientY - r.top;
      st.pxT = (y > -40 && y < r.height + 40) ? e.clientX - r.left : -9999;
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    return {
      state: st,
      ready: function () { return !!tex; },
      pause: L.pause,
      wind: function (v) { st.windT = Math.max(-1.2, Math.min(1.2, st.windT + v)); },
      stop: function () {
        L.stop();
        window.removeEventListener('pointermove', onMove);
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  // =====================================================================
  //  СЕРЕБРЯНЫЙ ДОЖДЬ
  // =====================================================================
  function rain(canvas, o) {
    o = Object.assign({ duration: 13, confetti: 150, ribbons: 16, dust: 110, seed: 11 }, o || {});
    var gl = GL(canvas);
    if (!gl) return null;
    var small = Math.min(window.innerWidth, window.innerHeight) < 600;
    if (small) { o.confetti = Math.round(o.confetti * 0.62); o.ribbons = Math.round(o.ribbons * 0.6); o.dust = Math.round(o.dust * 0.7); }
    var R = rnd(o.seed);
    var ROT = [
      'mat3 rx(float a){ float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }',
      'mat3 ry(float a){ float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }',
      'mat3 rz(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }'
    ].join('\n');
    var SHADE = ENV_GLSL + [
      'float metal(vec3 N, float lod, float tone){',
      '  if (N.z < 0.0) N = -N;',
      '  vec3 Rf = reflect(vec3(0.0, 0.0, -1.0), N);',
      '  float l = envL(Rf, lod) * 2.6 + pow(N.z, 40.0) * 12.0 + pow(N.z, 3.0) * 0.5 + 0.95 * pow(abs(N.y), 1.6);',
      '  return l * tone + 0.07;',
      '}'
    ].join('\n');

    // --- конфетти ---
    var pc = prog(gl, ROT + [
      'in vec2 aPos; in vec4 aS; in vec4 aK;',       // aS: x, скорость вращения, глубина, скорость падения; aK: старт, форма, размер, тон
      'uniform float uTime; uniform float uAspect; uniform float uFade;',
      'out vec3 vN; out vec2 vUv; out float vBlur; out float vShape; out float vTone; out float vA;',
      'void main(){',
      '  float t = uTime - aK.x;',
      '  float z = aS.z * 2.0 - 1.0;',
      '  float sc = 1.0 / (1.0 - z * 0.42);',
      '  float fall = mix(0.17, 0.33, aS.w);',
      '  float ease = 1.0 - exp(-t * 1.4);',
      '  float y = 1.0 / sc + 0.22 - (t * fall + 0.10 * ease) * (1.0 + 0.12 * sin(t * 1.1 + aS.x * 31.0));',
      '  float a = t * (1.6 + 4.2 * aS.y) + aS.x * 97.0;',
      '  float b = t * (0.9 + 2.3 * aS.w) + aS.z * 53.0;',
      '  float x = (aS.x * 2.0 - 1.0) * uAspect * 1.08 / sc + sin(a * 0.5 + aS.z * 7.0) * 0.07 + sin(t * 0.37 + aS.w * 20.0) * 0.10;',
      '  mat3 M = ry(b) * rx(a) * rz(b * 0.3 + aS.y * 6.0);',
      '  vec2 size = aK.y < 0.5 ? vec2(0.020, 0.030) : (aK.y < 1.5 ? vec2(0.021, 0.021) : vec2(0.007, 0.050));',
      '  size *= aK.z;',
      '  vec3 P = M * vec3(aPos * size, 0.0);',
      '  vN = M * vec3(0.0, 0.0, 1.0);',
      '  vBlur = clamp(abs(z - 0.1) * 1.25 - 0.18, 0.0, 1.0);',
      '  P.xy *= 1.0 + vBlur * 0.9;',
      '  vec2 q = (vec2(x, y) + P.xy) * sc;',
      '  vUv = aPos; vShape = aK.y; vTone = aK.w;',
      '  vA = (t < 0.0 ? 0.0 : 1.0) * uFade;',
      '  gl_Position = t < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(q.x / uAspect, q.y, 0.0, 1.0);',
      '}'
    ].join('\n'), SHADE + [
      'in vec3 vN; in vec2 vUv; in float vBlur; in float vShape; in float vTone; in float vA;',
      'out vec4 o;',
      'void main(){',
      '  float d = (vShape > 0.5 && vShape < 1.5) ? length(vUv) : max(abs(vUv.x), abs(vUv.y));',
      '  float soft = 0.06 + vBlur * 0.75;',
      '  float a = smoothstep(1.0, 1.0 - soft, d) * mix(1.0, 0.34, vBlur) * vA;',
      '  float l = metal(normalize(vN), 1.5 + vBlur * 4.0, vTone);',
      '  o = vec4(film(vec3(l, l, l * 1.02)) * a, a);',
      '}'
    ].join('\n'));
    var cd = [];
    for (var i = 0; i < o.confetti; i++) {
      var late = i / o.confetti;
      var spawn = late < 0.45 ? R() * 0.9 : 0.6 + R() * (o.duration - 7.5);
      var shape = R() < 0.5 ? 0 : (R() < 0.6 ? 1 : 2);
      cd.push(R(), R(), R(), R(), spawn, shape, 0.75 + R() * 0.7, R() < 0.2 ? 0.45 : 1.0);
    }
    var quad = buf(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    var cb = buf(gl, new Float32Array(cd));
    var vc = gl.createVertexArray();
    gl.bindVertexArray(vc);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); attr(gl, pc.a('aPos'), 2, 0, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, cb); attr(gl, pc.a('aS'), 4, 32, 0, 1); attr(gl, pc.a('aK'), 4, 32, 16, 1);

    // --- ленты ---
    var RSEG = 36, rs = [];
    for (var s = 0; s <= RSEG; s++) rs.push(s / RSEG, -1, s / RSEG, 1);
    var pr = prog(gl, [
      'in vec2 aV; in vec4 aS; in vec4 aK;',          // aS: x, частота, глубина, скорость; aK: старт, длина, ширина, тон
      'uniform float uTime; uniform float uAspect; uniform float uFade;',
      'out vec3 vN; out float vBlur; out float vTone; out float vA; out float vSide;',
      'void main(){',
      '  float t = uTime - aK.x;',
      '  float s = aV.x;',
      '  float z = aS.z * 2.0 - 1.0;',
      '  float sc = 1.0 / (1.0 - z * 0.42);',
      '  float fall = mix(0.13, 0.24, aS.w);',
      '  float ph = t * (1.3 + aS.y * 1.6) - s * (5.0 + aS.y * 5.0) + aS.x * 40.0;',
      '  float rad = 0.035 + 0.03 * aS.w;',
      '  float x = (aS.x * 2.0 - 1.0) * uAspect / sc + sin(ph) * rad + sin(t * 0.45 + aS.z * 9.0 + s * 1.5) * 0.16;',
      '  float y = 1.0 / sc + 0.15 - t * fall + s * aK.y + cos(ph) * rad * 0.35;',
      '  float a = ph * 0.5 + s * 3.0 + aS.w * 6.0;',
      '  float cw = cos(a);',
      '  float w = aK.z * (abs(cw) < 0.25 ? (cw < 0.0 ? -0.25 : 0.25) : cw);',
      '  vBlur = clamp(abs(z - 0.1) * 1.2 - 0.2, 0.0, 1.0);',
      '  x += aV.y * w * (1.0 + vBlur * 1.6);',
      '  vN = vec3(-sin(a), 0.5 * cos(ph), cw);',
      '  vTone = aK.w; vSide = aV.y;',
      '  vA = (t < 0.0 ? 0.0 : 1.0) * uFade * smoothstep(0.0, 0.04, s) * smoothstep(1.0, 0.96, s);',
      '  gl_Position = t < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(x * sc / uAspect, y * sc, 0.0, 1.0);',
      '}'
    ].join('\n'), SHADE + [
      'in vec3 vN; in float vBlur; in float vTone; in float vA; in float vSide;',
      'out vec4 o;',
      'void main(){',
      '  float soft = 0.12 + vBlur * 0.8;',
      '  float a = smoothstep(1.0, 1.0 - soft, abs(vSide)) * mix(1.0, 0.36, vBlur) * vA;',
      '  float l = metal(normalize(vN), 1.8 + vBlur * 4.0, vTone);',
      '  o = vec4(film(vec3(l, l, l * 1.02)) * a, a);',
      '}'
    ].join('\n'));
    var rd = [];
    for (var k = 0; k < o.ribbons; k++) rd.push(R(), R(), R(), R(), R() < 0.4 ? R() * 0.8 : 0.5 + R() * (o.duration - 8.5), 0.34 + R() * 0.5, 0.0045 + R() * 0.004, R() < 0.25 ? 0.5 : 1.0);
    var rsb = buf(gl, new Float32Array(rs)), rb = buf(gl, new Float32Array(rd));
    var vr = gl.createVertexArray();
    gl.bindVertexArray(vr);
    gl.bindBuffer(gl.ARRAY_BUFFER, rsb); attr(gl, pr.a('aV'), 2, 0, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rb); attr(gl, pr.a('aS'), 4, 32, 0, 1); attr(gl, pr.a('aK'), 4, 32, 16, 1);

    // --- блёстки ---
    var pd = prog(gl, [
      'in vec2 aPos; in vec4 aS;',
      'uniform float uTime; uniform float uAspect; uniform float uFade; uniform float uDur;',
      'out vec2 vUv; out float vI;',
      'void main(){',
      '  float t = uTime - aS.w * (uDur - 6.0);',
      '  float z = aS.z * 2.0 - 1.0;',
      '  float sc = 1.0 / (1.0 - z * 0.42);',
      '  float y = 1.1 - t * (0.10 + 0.12 * aS.y) ;',
      '  float x = (aS.x * 2.0 - 1.0) * uAspect + sin(t * 0.6 + aS.x * 44.0) * 0.08;',
      '  float tw = pow(max(0.0, sin(t * (2.0 + aS.y * 5.0) + aS.z * 60.0)), 10.0);',
      '  vI = tw * uFade * (t < 0.0 ? 0.0 : 1.0);',
      '  float size = (0.010 + 0.022 * aS.y) * (0.4 + tw) * sc;',
      '  vUv = aPos;',
      '  gl_Position = vI < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4((x * sc + aPos.x * size) / uAspect, y * sc + aPos.y * size, 0.0, 1.0);',
      '}'
    ].join('\n'), [
      'in vec2 vUv; in float vI; out vec4 o;',
      'void main(){',
      '  vec2 a = abs(vUv);',
      '  float core = exp(-dot(vUv, vUv) * 18.0);',
      '  float rays = exp(-a.y * 30.0) * pow(max(0.0, 1.0 - a.x), 3.0) + exp(-a.x * 30.0) * pow(max(0.0, 1.0 - a.y), 3.0);',
      '  float s = (core + rays * 0.7) * vI;',
      '  o = vec4(vec3(s), s * 0.7);',
      '}'
    ].join('\n'));
    var dd = [];
    for (var d = 0; d < o.dust; d++) dd.push(R(), R(), R(), R());
    var db = buf(gl, new Float32Array(dd));
    var vd = gl.createVertexArray();
    gl.bindVertexArray(vd);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); attr(gl, pd.a('aPos'), 2, 0, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, db); attr(gl, pd.a('aS'), 4, 16, 0, 1);
    gl.bindVertexArray(null);

    var tex = null, L = null, done = false, onEnd = o.onEnd;
    function frame(t) {
      fit(canvas, gl, 1.75);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!tex) return;
      var asp = canvas.width / canvas.height;
      var fade = Math.max(0, Math.min(1, (o.duration - t) / 1.6));
      function setup(p) {
        gl.useProgram(p.p);
        gl.uniform1f(p.u('uTime'), t);
        gl.uniform1f(p.u('uAspect'), asp);
        gl.uniform1f(p.u('uFade'), fade);
        gl.uniform1f(p.u('uDur'), o.duration);
        gl.uniform1f(p.u('uEnvRot'), 0.12 + t * 0.004);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(p.u('uEnv'), 0);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      setup(pd); gl.bindVertexArray(vd); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.dust);
      setup(pr); gl.bindVertexArray(vr); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (RSEG + 1) * 2, o.ribbons);
      setup(pc); gl.bindVertexArray(vc); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.confetti);
      gl.bindVertexArray(null);
      if (t >= o.duration && !done) {
        done = true;
        L.stop();
        gl.clear(gl.COLOR_BUFFER_BIT);
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        if (onEnd) onEnd();
      }
    }
    loadEnv().then(function (img) { tex = envTex(gl, img); L = loop(canvas, frame, true); }, function () { if (onEnd) onEnd(); });
    return { stop: function () { if (L) L.stop(); } };
  }

  window.Silver = { ball: ball, fringe: fringe, rain: rain, loadEnv: loadEnv, supported: (function () { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } })() };
})();
