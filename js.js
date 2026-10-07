(function(){
  'use strict';

  var TAU = Math.PI * 2;
  var PI  = Math.PI;
  var DEG = 180 / Math.PI;

  /* =========================================================
     ESTADO GLOBAL
     ========================================================= */
  var S = {
    p: 0,              // progresso 0..1 (uma volta completa)
    playing: true,
    omega: 0.55,       // rad/s
    multi: false       // vários ângulos no círculo
  };

  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1, L = {};

  var SCENES = [];
  var cur = null;
  var curIdx = 0;
  var dragging = false;

  function theta(p){ return p * TAU; }
  function prog(a){ return a / TAU; }

  /* =========================================================
     CANVAS / LAYOUT
     ========================================================= */
  function resize(){
    var rect = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(300, Math.round(rect.width));
    H = Math.max(320, Math.round(rect.height));
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeLayout();
  }

  function computeLayout(){
    var compact = W < 900;
    var pad = compact ? 20 : 34;
    var isMHS = (cur && cur.id === 'mhs');
    var gapMin = isMHS ? 148 : 74;
    var gapRatio = isMHS ? 0.155 : 0.075;

    if(!compact){
      var gap = Math.max(gapMin, W * gapRatio);
      var R = Math.min((H - 2 * pad) / 2, W * 0.29, 280, (W - 2 * pad - gap - 168) / 2);
      if(isMHS) R = Math.min(R, (H / 2 - pad) / 1.45);
      R = Math.max(70, R);
      var cx = pad + R + 12;
      var cy = H / 2;
      var gx0 = cx + R + gap;
      var gx1 = Math.max(gx0 + 90, W - pad);
      L = { compact:false, pad:pad, R:R, cx:cx, cy:cy, gx0:gx0, gx1:gx1, gy0:cy, A:R, mid0:cx+R, mid1:gx0 };
    } else {
      var R2 = Math.min(W * 0.30, (H - 150) / 3.5, 160);
      R2 = Math.max(64, R2);
      var cx2 = W / 2;
      var cy2 = pad + R2 + 6;
      var gx0b = pad + 8;
      var gx1b = W - pad - 8;
      var top = cy2 + R2 + Math.max(36, R2 * 0.40);
      var bottom = H - pad - 24;
      var avail = Math.max(80, bottom - top);
      var A2 = Math.min(R2, avail / 2);
      L = { compact:true, pad:pad, R:R2, cx:cx2, cy:cy2, gx0:gx0b, gx1:gx1b, gy0:top + avail / 2, A:A2, mid0:cx2, mid1:cx2 };
    }
  }

  /* =========================================================
     PRIMITIVAS DE DESENHO
     ========================================================= */
  function strokePts(pts, color, alpha, width, glow, closed){
    if(!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for(var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if(closed) ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if(glow){ ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function lineAt(x1, y1, x2, y2, color, w, dash, alpha){
    ctx.save();
    if(dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = w || 1;
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.stroke();
    ctx.restore();
  }

  function dotAt(x, y, r, color, glow){
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = color;
    if(glow){ ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function halo(x, y, r0, r1, color){
    var g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r1, 0, TAU);
    ctx.fill();
  }

  function txt(s, x, y, color, font, align, base){
    ctx.font = font || '300 11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = base || 'middle';
    ctx.fillText(s, x, y);
  }

  function clipRect(x, y, w, h, fn){
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function sample(n, f){
    var out = [];
    for(var i = 0; i <= n; i++) out.push(f(i / n, i));
    return out;
  }

  function mapRange(v, a0, a1, b0, b1){ return b0 + (v - a0) * (b1 - b0) / (a1 - a0); }

  function fmt(v, d){
    if(v === null || v === undefined || !isFinite(v)) return '—';
    var n = (d === undefined) ? 4 : d;
    var s = Math.abs(v).toFixed(n).replace('.', ',');
    return (v < 0 ? '−' : '') + s;
  }

  /* =========================================================
     PAINEL DINÂMICO
     ========================================================= */
  var readEls = [];

  function buildReadouts(){
    var box = document.getElementById('values');
    box.innerHTML = '';
    readEls = [];
    var list = (cur && cur.readouts) ? cur.readouts(0) : [];
    list.forEach(function(r){
      var row = document.createElement('div');
      row.className = 'row';
      var k = document.createElement('span');
      k.className = 'k';
      k.innerHTML = r.k;
      var v = document.createElement('span');
      v.className = 'v ' + (r.c || '');
      row.appendChild(k);
      row.appendChild(v);
      box.appendChild(row);
      readEls.push(v);
    });
    document.getElementById('cardRead').style.display = list.length ? '' : 'none';
  }

  function updateReadouts(p){
    if(!cur || !cur.readouts) return;
    var list = cur.readouts(p);
    for(var i = 0; i < readEls.length && i < list.length; i++){
      var html = list[i].v;
      if(readEls[i]._last !== html){
        readEls[i].innerHTML = html;
        readEls[i]._last = html;
      }
    }
  }

  function renderControl(c){
    var wrap = document.createElement('div');

    if(c.k === 'range'){
      var row = document.createElement('div');
      row.className = 'ctl-row';
      var lab = document.createElement('span');
      lab.className = 'ctl-label';
      lab.textContent = c.label;
      var val = document.createElement('span');
      val.className = 'ctl-value';
      row.appendChild(lab); row.appendChild(val);

      var inp = document.createElement('input');
      inp.type = 'range';
      inp.min = c.min; inp.max = c.max; inp.step = c.step;
      inp.value = cur.params[c.id];
      if(c.tone) inp.className = c.tone;

      var fmtFn = c.fmt || function(v){ return (+v).toFixed(2).replace('.', ','); };
      val.textContent = fmtFn(cur.params[c.id]);

      inp.addEventListener('input', function(){
        cur.params[c.id] = parseFloat(inp.value);
        val.textContent = fmtFn(inp.value);
        if(c.onChange) c.onChange(cur.params[c.id]);
      });

      wrap.appendChild(row);
      wrap.appendChild(inp);
      return wrap;
    }

    if(c.k === 'chips'){
      var lab2 = document.createElement('div');
      lab2.className = 'ctl-label';
      lab2.style.marginBottom = '8px';
      lab2.textContent = c.label;
      var box = document.createElement('div');
      box.className = 'chips';
      c.opts.forEach(function(o){
        var b = document.createElement('button');
        b.className = 'chip';
        b.textContent = o.t;
        b.setAttribute('aria-pressed', cur.params[c.id] === o.v ? 'true' : 'false');
        b.addEventListener('click', function(){
          cur.params[c.id] = o.v;
          Array.prototype.forEach.call(box.children, function(x){ x.setAttribute('aria-pressed', 'false'); });
          b.setAttribute('aria-pressed', 'true');
          if(c.onChange) c.onChange(o.v);
        });
        box.appendChild(b);
      });
      wrap.appendChild(lab2);
      wrap.appendChild(box);
      return wrap;
    }

    if(c.k === 'toggle'){
      var box2 = document.createElement('div');
      box2.className = 'chips';
      var b2 = document.createElement('button');
      b2.className = 'chip';
      b2.textContent = c.label;
      b2.setAttribute('aria-pressed', cur.params[c.id] ? 'true' : 'false');
      b2.addEventListener('click', function(){
        cur.params[c.id] = !cur.params[c.id];
        b2.setAttribute('aria-pressed', cur.params[c.id] ? 'true' : 'false');
        if(c.onChange) c.onChange(cur.params[c.id]);
      });
      box2.appendChild(b2);
      wrap.appendChild(box2);
      return wrap;
    }

    if(c.k === 'buttons'){
      var box3 = document.createElement('div');
      box3.className = 'btns';
      c.opts.forEach(function(o){
        var b3 = document.createElement('button');
        b3.textContent = o.t;
        b3.addEventListener('click', function(){ o.act(); });
        box3.appendChild(b3);
      });
      wrap.appendChild(box3);
      return wrap;
    }
    return wrap;
  }

  function buildControls(){
    var box = document.getElementById('controls');
    box.innerHTML = '';
    var list = (cur && cur.controls) ? cur.controls() : [];
    list.forEach(function(c){ box.appendChild(renderControl(c)); });
    document.getElementById('cardCtl').style.display = list.length ? '' : 'none';
  }

  /* =========================================================
     TROCA DE CENA
     ========================================================= */
  function buildTabs(){
    var nav = document.getElementById('tabs');
    nav.innerHTML = '';
    SCENES.forEach(function(s, i){
      var b = document.createElement('button');
      b.className = 'tab';
      b.textContent = s.tab;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === curIdx ? 'true' : 'false');
      b.addEventListener('click', function(){ selectScene(i); });
      nav.appendChild(b);
    });
  }

  function selectScene(i){
    curIdx = Math.max(0, Math.min(SCENES.length - 1, i));
    cur = SCENES[curIdx];
    S.p = 0;
    if(cur.init) cur.init();

    var tabs = document.querySelectorAll('.tab');
    for(var k = 0; k < tabs.length; k++){
      tabs[k].setAttribute('aria-selected', k === curIdx ? 'true' : 'false');
    }

    document.getElementById('blurb').innerHTML = cur.blurb || '';
    document.getElementById('stageTag').textContent = cur.tag || cur.tab;
    document.getElementById('thetaWrap').style.display = cur.usesTheta ? '' : 'none';
    document.getElementById('footHint').textContent = cur.hint || 'Arraste no gráfico para interagir.';

    buildReadouts();
    buildControls();
    computeLayout();
    updateReadouts(0);
    syncPlay();
  }

  /* =========================================================
     LOOP
     ========================================================= */
  var last = 0;

  function frame(now){
    if(!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if(dt > 0.06) dt = 0.06;

    if(S.playing && !dragging){
      S.p += (S.omega * dt) / TAU;
      if(S.p >= 1) S.p -= 1;
    }

    ctx.clearRect(0, 0, W, H);
    if(cur && cur.draw){
      try { cur.draw({ ctx:ctx, W:W, H:H, L:L }, S.p, dt); }
      catch(err){ /* mantém o loop vivo */ }
    }
    updateReadouts(S.p);
    syncAngleLabel();
    requestAnimationFrame(frame);
  }

  /* =========================================================
     CONTROLES GLOBAIS
     ========================================================= */
  var btnPlay = document.getElementById('play');
  var elAngle = document.getElementById('angle');
  var elSpeed = document.getElementById('speed');
  var lblTheta = document.getElementById('lbl-theta');
  var lblSpeed = document.getElementById('lbl-speed');
  var angleActive = false;

  function syncPlay(){
    btnPlay.textContent = S.playing ? 'Pausar' : 'Reproduzir';
  }

  function syncAngleLabel(){
    if(!cur || !cur.usesTheta) return;
    var deg = S.p * 360;
    if(!angleActive) elAngle.value = deg.toFixed(1);
    lblTheta.textContent = deg.toFixed(1).replace('.', ',') + '°';
    lblSpeed.textContent = S.omega.toFixed(2).replace('.', ',') + ' rad/s';
  }

  btnPlay.addEventListener('click', function(){
    S.playing = !S.playing;
    syncPlay();
  });

  document.getElementById('reset').addEventListener('click', function(){
    S.p = 0;
    S.playing = true;
    syncPlay();
  });

  elAngle.addEventListener('pointerdown', function(){ angleActive = true; });
  window.addEventListener('pointerup', function(){ angleActive = false; });
  elAngle.addEventListener('input', function(){
    angleActive = true;
    S.p = (parseFloat(elAngle.value) / 360) % 1;
    if(S.p < 0) S.p += 1;
    S.playing = false;
    syncPlay();
  });

  elSpeed.addEventListener('input', function(){
    S.omega = parseFloat(elSpeed.value);
  });

  /* ---- arraste no canvas ---- */
  function pointerPos(e){
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', function(e){
    if(!cur || (!cur.onDrag && !cur.usesTheta)) return;
    dragging = true;
    S.playing = false;
    syncPlay();
    try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
    handleDrag(e);
  });

  canvas.addEventListener('pointermove', function(e){
    if(dragging) handleDrag(e);
  });

  function endDrag(e){
    if(!dragging) return;
    dragging = false;
    try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function handleDrag(e){
    var pos = pointerPos(e);
    if(cur.onDrag){ cur.onDrag(pos.x, pos.y, L); return; }
    var dx = pos.x - L.cx, dy = L.cy - pos.y;
    if(Math.sqrt(dx * dx + dy * dy) <= L.R * 1.3){
      var a = Math.atan2(dy, dx);
      S.p = prog(a < 0 ? a + TAU : a);
    } else {
      var t = (pos.x - L.gx0) / Math.max(1, L.gx1 - L.gx0);
      S.p = Math.max(0, Math.min(0.9999, t));
    }
  }

  /* ---- teclado ---- */
  window.addEventListener('keydown', function(e){
    if(e.target && e.target.tagName === 'INPUT') return;
    if(e.code === 'Space'){
      e.preventDefault();
      S.playing = !S.playing;
      syncPlay();
    } else if(e.key === 'ArrowRight'){
      e.preventDefault();
      S.p = (S.p + (e.shiftKey ? 0.02 : 0.0025)) % 1;
      S.playing = false; syncPlay();
    } else if(e.key === 'ArrowLeft'){
      e.preventDefault();
      S.p = (S.p - (e.shiftKey ? 0.02 : 0.0025) + 1) % 1;
      S.playing = false; syncPlay();
    } else if(e.key === 'r' || e.key === 'R'){
      S.p = 0;
    } else if(e.key === 'f' || e.key === 'F'){
      toggleFull();
    }
  });

  /* ---- extras ---- */
  function toggleFull(){
    var el = document.documentElement;
    if(!document.fullscreenElement){
      if(el.requestFullscreen) el.requestFullscreen();
    } else if(document.exitFullscreen){
      document.exitFullscreen();
    }
  }
  document.getElementById('btn-full').addEventListener('click', toggleFull);

  document.getElementById('btn-png').addEventListener('click', function(){
    try{
      var url = canvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = url;
      a.download = 'trigonometria-' + (cur ? cur.id : 'cena') + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }catch(err){}
  });

  var modal = document.getElementById('modal');
  document.getElementById('btn-table').addEventListener('click', function(){
    var tb = document.getElementById('tbody');
    tb.innerHTML = '';
    for(var d = 0; d <= 360; d += 15){
      var a = d / DEG;
      var s = Math.sin(a), c = Math.cos(a);
      var t = Math.abs(c) < 1e-9 ? '—' : fmt(s / c, 4);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + d + '°</td><td>' + fmt(a, 4) + '</td><td>' + fmt(s, 4) +
                     '</td><td>' + fmt(c, 4) + '</td><td>' + t + '</td>';
      tb.appendChild(tr);
    }
    modal.classList.add('open');
  });
  document.getElementById('modal-close').addEventListener('click', function(){
    modal.classList.remove('open');
  });
  modal.addEventListener('click', function(e){
    if(e.target === modal) modal.classList.remove('open');
  });

  window.addEventListener('resize', function(){ resize(); });
  window.addEventListener('orientationchange', function(){ setTimeout(resize, 120); });
  if(window.ResizeObserver){
    new ResizeObserver(function(){ resize(); }).observe(canvas.parentElement);
  }

  /* =========================================================
     BOOT (executado depois que todas as cenas se registram)
     ========================================================= */
  function boot(){
    buildTabs();
    selectScene(0);
    resize();
    syncPlay();
    requestAnimationFrame(frame);
  }

  var COLORS = { sin:'#35e0c0', cos:'#e8b64c', tan:'#b18cff', alt:'#ff6b8a', ink:'#ececf1', muted:'#82828e' };

  /* =========================================================
     HELPERS COMPARTILHADOS PELAS CENAS
     ========================================================= */
  function circleBase(opt){
    opt = opt || {};
    var cx = L.cx, cy = L.cy, R = L.R;
    if(opt.halo !== false) halo(cx, cy, R * 0.55, R * 1.75, 'rgba(53,224,192,.05)');
    lineAt(cx - R - 16, cy, cx + R + 16, cy, 'rgba(255,255,255,.15)', 1);
    lineAt(cx, cy - R - 16, cx, cy + R + 16, 'rgba(255,255,255,.15)', 1);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,.26)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    var every = R < 128 ? 45 : 30;
    for(var d = 0; d < 360; d += 15){
      var a = d / DEG, ca = Math.cos(a), sa = Math.sin(a);
      var isL = (d % every === 0);
      var inner = R - (isL ? 9 : 5);
      lineAt(cx + ca * inner, cy - sa * inner, cx + ca * R, cy - sa * R,
             isL ? 'rgba(255,255,255,.34)' : 'rgba(255,255,255,.13)', 1);
      if(isL && opt.labels !== false){
        txt(d + '°', cx + ca * (R + 15), cy - sa * (R + 15),
            'rgba(255,255,255,.34)', '300 10px "JetBrains Mono", monospace');
      }
    }
  }

  function graphGrid(opt){
    opt = opt || {};
    var gx0 = L.gx0, gx1 = L.gx1, gy0 = L.gy0, A = L.A, k, a, x, y;
    for(k = -2; k <= 2; k++){
      y = gy0 - A * (k / 2);
      lineAt(gx0, y, gx1, y, k === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.055)', 1);
    }
    for(k = 0; k <= 12; k++){
      a = k * PI / 6;
      x = gx0 + (a / TAU) * (gx1 - gx0);
      lineAt(x, gy0 - A - 10, x, gy0 + A + 10,
             (k % 3 === 0) ? 'rgba(255,255,255,.075)' : 'rgba(255,255,255,.03)', 1);
    }
    if(opt.labels === false) return;
    var labels = ['0', 'π/2', 'π', '3π/2', '2π'];
    for(k = 0; k <= 4; k++){
      x = gx0 + ((k * PI / 2) / TAU) * (gx1 - gx0);
      txt(labels[k], x, gy0 + A + 18, 'rgba(255,255,255,.30)',
          '300 10.5px "JetBrains Mono", monospace', k === 0 ? 'left' : (k === 4 ? 'right' : 'center'));
    }
    var yl = ['1', '0,5', '0', '−0,5', '−1'];
    for(k = 0; k <= 4; k++){
      y = gy0 - A + 2 * A * (k / 4);
      txt(yl[k], gx0 - 12, y, 'rgba(255,255,255,.26)', '300 10.5px "JetBrains Mono", monospace', 'right');
    }
  }

  function graphClip(fn){ clipRect(L.gx0 - 2, L.gy0 - L.A - 2, (L.gx1 - L.gx0) + 4, 2 * L.A + 4, fn); }

  function angleArc(th, color){
    if(th <= 0.001) return;
    var r = Math.min(L.R * 0.30, 62);
    ctx.beginPath();
    ctx.moveTo(L.cx, L.cy);
    ctx.arc(L.cx, L.cy, r, 0, -th, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.055)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, r, 0, -th, true);
    ctx.strokeStyle = color || 'rgba(255,255,255,.30)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function graphCurve(fn, a0, a1, color, alpha, width, glow, yScale, limit){
    var sc = yScale || 1;
    var lim = limit || Infinity;
    var span = L.gx1 - L.gx0;
    var steps = Math.max(20, Math.round(((a1 - a0) / TAU) * span));
    var run = [], segs = [], i, a, v;
    for(i = 0; i <= steps; i++){
      a = a0 + (a1 - a0) * i / steps;
      v = fn(a) * sc;
      if(!isFinite(v) || Math.abs(v) > lim){
        if(run.length > 1) segs.push(run);
        run = [];
        continue;
      }
      run.push([L.gx0 + (a / TAU) * span, L.gy0 - L.A * v]);
    }
    if(run.length > 1) segs.push(run);
    for(i = 0; i < segs.length; i++) strokePts(segs[i], color, alpha, width, glow);
  }

  function trailArc(th, color, span){
    if(th <= 0.05) return;
    var steps = 42, sweep = span || PI * 1.45;
    for(var i = 0; i < steps; i++){
      var a1 = th - sweep * i / steps;
      var a0 = th - sweep * (i + 1) / steps;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.R, a0, a1);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.20 * (1 - i / steps);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function arrow(x1, y1, x2, y2, color, w, glow){
    if(glow){
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      lineAt(x1, y1, x2, y2, color, w);
      ctx.restore();
    } else {
      lineAt(x1, y1, x2, y2, color, w);
    }
    var ang = Math.atan2(y2 - y1, x2 - x1), hl = 9;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hl * Math.cos(ang - 0.42), y2 - hl * Math.sin(ang - 0.42));
    ctx.lineTo(x2 - hl * Math.cos(ang + 0.42), y2 - hl * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = color;
    if(glow){ ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* =========================================================
     CENA 1 — CICLO TRIGONOMÉTRICO
     ========================================================= */
  SCENES.push({
    id:'ciclo', tab:'Ciclo',
    tag:'Círculo unitário · seno & cosseno',
    blurb:'O ponto gira sobre a circunferência de raio 1 e suas projeções desenham as curvas de <b>seno</b> e <b>cosseno</b>. A perna horizontal do triângulo é o cosseno; a vertical é o seno.',
    hint:'Arraste no círculo ou no gráfico para posicionar o ângulo.',
    usesTheta:true,
    params:{ sin:true, cos:true, trail:true, arc:true, multi:false },
    controls:function(){
      return [
        {k:'toggle', id:'sin', label:'seno'},
        {k:'toggle', id:'cos', label:'cosseno'},
        {k:'toggle', id:'trail', label:'rastro'},
        {k:'toggle', id:'arc', label:'arco do ângulo'},
        {k:'toggle', id:'multi', label:'comparar 3 ângulos'}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      return [
        {k:'<span class="sym">θ</span> &nbsp;ângulo', v: fmt(p*360,1) + '°<span class="sub">' + fmt(th,4) + ' rad</span>'},
        {k:'<span class="sym">sen θ</span> &nbsp;projeção vertical', v: fmt(s), c:'sin'},
        {k:'<span class="sym">cos θ</span> &nbsp;projeção horizontal', v: fmt(c), c:'cos'},
        {k:'<span class="sym">tan θ</span>', v: Math.abs(c) < 1e-9 ? '—' : fmt(s/c), c:'tan'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p);
      var s = Math.sin(th), c = Math.cos(th);

      graphGrid();
      if(P.sin){
        graphCurve(Math.sin, 0, TAU, COLORS.sin, .16, 1.4, 0);
        graphCurve(Math.sin, 0, th, COLORS.sin, 1, 2.2, 14);
      }
      if(P.cos){
        graphCurve(Math.cos, 0, TAU, COLORS.cos, .16, 1.4, 0);
        graphCurve(Math.cos, 0, th, COLORS.cos, 1, 2.2, 14);
      }

      circleBase();
      if(P.arc) angleArc(th);
      if(P.trail) trailArc(th, '#78ffe6');

      var px = L.cx + L.R * c, py = L.cy - L.R * s;

      if(P.multi){
        var extras = [[2*PI/3, COLORS.alt], [4*PI/3, COLORS.tan]];
        for(var e = 0; e < extras.length; e++){
          var ea = th + extras[e][0];
          var ex = L.cx + L.R * Math.cos(ea), ey = L.cy - L.R * Math.sin(ea);
          ctx.beginPath(); ctx.arc(ex, ey, 6, 0, TAU);
          ctx.strokeStyle = extras[e][1]; ctx.globalAlpha = .7; ctx.lineWidth = 1.6; ctx.stroke();
          ctx.globalAlpha = 1;
          dotAt(ex, ey, 2.6, extras[e][1], 12);
        }
      }

      if(P.cos) lineAt(L.cx, L.cy, px, L.cy, COLORS.cos, 2.6, null, .92);
      if(P.sin) lineAt(px, L.cy, px, py, COLORS.sin, 2.6, null, .92);

      lineAt(px, py, px, L.cy, 'rgba(232,182,76,.35)', 1, [3,5]);
      lineAt(L.cx, py, px, py, 'rgba(53,224,192,.35)', 1, [3,5]);
      lineAt(L.cx, L.cy, px, py, 'rgba(255,255,255,.78)', 1.4);

      dotAt(L.cx, L.cy, 2.4, 'rgba(255,255,255,.85)', 0);

      if(P.sin && !L.compact){
        lineAt(px, py, L.gx0 + (th / TAU) * (L.gx1 - L.gx0), L.gy0 - L.A * s,
               'rgba(53,224,192,.42)', 1, [4,5]);
      }

      ctx.beginPath(); ctx.arc(px, py, 8.5, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
      dotAt(px, py, 4, '#ffffff', 20);

      var mx = L.gx0 + (th / TAU) * (L.gx1 - L.gx0);
      lineAt(mx, L.gy0 - L.A - 12, mx, L.gy0 + L.A + 12, 'rgba(255,255,255,.20)', 1);
      if(P.sin){
        var y1 = L.gy0 - L.A * s;
        ctx.beginPath(); ctx.arc(mx, y1, 9, 0, TAU);
        ctx.fillStyle = 'rgba(53,224,192,.13)'; ctx.fill();
        dotAt(mx, y1, 3.6, COLORS.sin, 18);
      }
      if(P.cos){
        var y2 = L.gy0 - L.A * c;
        ctx.beginPath(); ctx.arc(mx, y2, 9, 0, TAU);
        ctx.fillStyle = 'rgba(232,182,76,.13)'; ctx.fill();
        dotAt(mx, y2, 3.6, COLORS.cos, 18);
      }
    }
  });

  /* =========================================================
     CENA 2 — TANGENTE GEOMÉTRICA
     ========================================================= */
  SCENES.push({
    id:'tan', tab:'Tangente',
    tag:'A reta tangente em (1, 0)',
    blurb:'A reta vertical tangente ao círculo em <b>(1, 0)</b>. O prolongamento do raio corta essa reta exatamente em <b>tan θ</b>. Quando o ângulo chega a 90°, o raio fica paralelo à reta e a tangente não existe — é a assíntota.',
    hint:'Arraste para ver a tangente explodir perto de 90° e 270°.',
    usesTheta:true,
    params:{ cot:false, grid:true, trail:true, arc:true },
    controls:function(){
      return [
        {k:'toggle', id:'cot', label:'mostrar cotangente'},
        {k:'toggle', id:'trail', label:'rastro'},
        {k:'toggle', id:'arc', label:'arco do ângulo'},
        {k:'buttons', opts:[
          {t:'45°', act:function(){ S.p = 45/360; }},
          {t:'60°', act:function(){ S.p = 60/360; }},
          {t:'90°−', act:function(){ S.p = 89.5/360; }}
        ]}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      return [
        {k:'<span class="sym">θ</span>', v: fmt(p*360,1) + '°<span class="sub">' + fmt(th,4) + ' rad</span>'},
        {k:'<span class="sym">tan θ</span>', v: Math.abs(c) < 1e-9 ? '— (assíntota)' : fmt(s/c), c:'tan'},
        {k:'<span class="sym">cot θ</span>', v: Math.abs(s) < 1e-9 ? '—' : fmt(c/s), c:'tan'},
        {k:'<span class="sym">sen θ</span>', v: fmt(s), c:'sin'},
        {k:'<span class="sym">cos θ</span>', v: fmt(c), c:'cos'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      var t = Math.tan(th);
      var cx = L.cx, cy = L.cy, R = L.R;

      graphGrid();
      var yScale = 1 / 1.75;
      graphClip(function(){
        lineAt(L.gx0 + (PI/2 / TAU) * (L.gx1 - L.gx0), L.gy0 - L.A, L.gx0 + (PI/2 / TAU) * (L.gx1 - L.gx0), L.gy0 + L.A, 'rgba(177,140,255,.30)', 1, [4,5]);
        lineAt(L.gx0 + ((3*PI/2) / TAU) * (L.gx1 - L.gx0), L.gy0 - L.A, L.gx0 + ((3*PI/2) / TAU) * (L.gx1 - L.gx0), L.gy0 + L.A, 'rgba(177,140,255,.30)', 1, [4,5]);
        graphCurve(Math.tan, 0, TAU, COLORS.tan, .18, 1.4, 0, yScale, 1.9);
        graphCurve(Math.tan, 0, th, COLORS.tan, 1, 2.2, 14, yScale, 1.9);
      });

      circleBase();
      if(P.arc) angleArc(th, 'rgba(177,140,255,.5)');
      if(P.trail) trailArc(th, '#c8aaff');

      var px = cx + R * c, py = cy - R * s;
      var Tx = cx + R, Ty = cy - R * t;
      var Cx = cx + R * (c / s), Cy = cy - R;

      clipRect(cx - R * 1.5, cy - R * 2.25, R * 3.6, R * 4.5, function(){
        lineAt(cx + R, cy - R * 1.95, cx + R, cy + R * 1.95, 'rgba(177,140,255,.30)', 1.2);
        if(P.cot) lineAt(cx, cy - R, cx + R * 1.9, cy - R, 'rgba(255,107,138,.28)', 1.2);

        lineAt(cx, cy, px, py, 'rgba(255,255,255,.55)', 1.2);
        if(Math.abs(c) > 1e-4) lineAt(px, py, Tx, Ty, 'rgba(255,255,255,.26)', 1, [4,5]);
        if(P.cot && Math.abs(s) > 1e-4) lineAt(px, py, Cx, Cy, 'rgba(255,107,138,.30)', 1, [4,5]);

        if(Math.abs(c) > 1e-4) lineAt(cx + R, cy, Tx, Ty, COLORS.tan, 3, null, .95);
        if(P.cot && Math.abs(s) > 1e-4) lineAt(cx, cy - R, Cx, Cy, COLORS.alt, 3, null, .9);

        dotAt(cx + R, cy, 3.2, COLORS.tan, 12);
        if(Math.abs(c) > 1e-4) dotAt(Tx, Ty, 4, COLORS.tan, 18);
        if(P.cot && Math.abs(s) > 1e-4) dotAt(Cx, Cy, 4, COLORS.alt, 18);
      });

      if(Math.abs(c) > 0.06 && Math.abs(Ty - cy) < R * 2.2){
        txt('tan θ', cx + R + 14, (cy + Ty) / 2, COLORS.tan, '300 11px "JetBrains Mono", monospace', 'left');
      }
      if(P.cot && Math.abs(s) > 0.06 && Math.abs(Cx - cx) < R * 2.2){
        txt('cot θ', (cx + Cx) / 2, cy - R - 14, COLORS.alt, '300 11px "JetBrains Mono", monospace');
      }
      txt('1', cx + R + 12, cy + 14, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace', 'left');

      lineAt(cx, cy, px, py, 'rgba(255,255,255,.78)', 1.4);
      dotAt(cx, cy, 2.4, 'rgba(255,255,255,.85)', 0);
      ctx.beginPath(); ctx.arc(px, py, 8.5, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
      dotAt(px, py, 4, '#ffffff', 20);

      var mx = L.gx0 + (th / TAU) * (L.gx1 - L.gx0);
      lineAt(mx, L.gy0 - L.A - 12, mx, L.gy0 + L.A + 12, 'rgba(255,255,255,.20)', 1);
      graphClip(function(){
        var my = L.gy0 - L.A * yScale * t;
        if(Math.abs(my - L.gy0) < L.A){
          ctx.beginPath(); ctx.arc(mx, my, 9, 0, TAU);
          ctx.fillStyle = 'rgba(177,140,255,.15)'; ctx.fill();
        }
      });
    }
  });

  /* =========================================================
     CENA 3 — IDENTIDADE FUNDAMENTAL
     ========================================================= */
  SCENES.push({
    id:'ident', tab:'Identidade',
    tag:'sen²θ + cos²θ = 1',
    blurb:'Sobre cada cateto do triângulo construímos um quadrado. A área do quadrado dourado é <b>cos²θ</b>, a do turquesa é <b>sen²θ</b> — e a soma das duas é sempre exatamente <b>1</b>, para qualquer ângulo.',
    hint:'A barra à direita mostra as duas áreas somando 1 em tempo real.',
    usesTheta:true,
    params:{ squares:true, bar:true, grid:true, trail:false },
    controls:function(){
      return [
        {k:'toggle', id:'squares', label:'quadrados nos catetos'},
        {k:'toggle', id:'bar', label:'barra de áreas'},
        {k:'toggle', id:'trail', label:'rastro'},
        {k:'buttons', opts:[
          {t:'30°', act:function(){ S.p = 30/360; }},
          {t:'45°', act:function(){ S.p = 45/360; }},
          {t:'60°', act:function(){ S.p = 60/360; }}
        ]}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      return [
        {k:'<span class="sym">θ</span>', v: fmt(p*360,1) + '°'},
        {k:'<span class="sym">cos²θ</span> &nbsp;área dourada', v: fmt(c*c), c:'cos'},
        {k:'<span class="sym">sen²θ</span> &nbsp;área turquesa', v: fmt(s*s), c:'sin'},
        {k:'<span class="sym">soma</span>', v: '<b>' + fmt(c*c + s*s) + '</b>', c:'tan'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      var cx = L.cx, cy = L.cy, R = L.R;

      if(P.grid) graphGrid();
      if(P.trail) trailArc(th, '#ffffff');
      circleBase();
      angleArc(th);

      var px = cx + R * c, py = cy - R * s;
      var Rc = R * c, Rs = R * s;

      if(P.squares){
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Rc, cy);
        ctx.lineTo(cx + Rc, cy + Rc);
        ctx.lineTo(cx, cy + Rc);
        ctx.closePath();
        ctx.fillStyle = 'rgba(232,182,76,.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(232,182,76,.75)';
        ctx.lineWidth = 1.3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(px, cy);
        ctx.lineTo(px + Rs, cy);
        ctx.lineTo(px + Rs, py);
        ctx.lineTo(px, py);
        ctx.closePath();
        ctx.fillStyle = 'rgba(53,224,192,.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(53,224,192,.75)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      lineAt(cx, cy, px, cy, COLORS.cos, 2.6, null, .95);
      lineAt(px, cy, px, py, COLORS.sin, 2.6, null, .95);
      lineAt(cx, cy, px, py, 'rgba(255,255,255,.6)', 1.2);

      dotAt(cx, cy, 2.4, 'rgba(255,255,255,.85)', 0);
      ctx.beginPath(); ctx.arc(px, py, 8.5, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
      dotAt(px, py, 4, '#ffffff', 20);

      if(P.bar){
        var x0 = L.gx0, x1 = L.gx1;
        var w = x1 - x0;
        var by = L.gy0 - 26, bh = 40;
        var wc = w * (c * c), ws = w * (s * s);

        ctx.fillStyle = 'rgba(232,182,76,.28)';
        ctx.fillRect(x0, by, wc, bh);
        ctx.fillStyle = 'rgba(53,224,192,.28)';
        ctx.fillRect(x0 + wc, by, ws, bh);

        ctx.strokeStyle = 'rgba(255,255,255,.30)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x0 + .5, by + .5, w - 1, bh - 1);

        lineAt(x0 + wc, by - 6, x0 + wc, by + bh + 6, 'rgba(255,255,255,.5)', 1);

        if(wc > 46) txt('cos²θ', x0 + wc / 2, by + bh / 2, 'rgba(255,235,190,.95)', '400 12px "JetBrains Mono", monospace');
        if(ws > 46) txt('sen²θ', x0 + wc + ws / 2, by + bh / 2, 'rgba(200,255,240,.95)', '400 12px "JetBrains Mono", monospace');

        txt('área total = 1', x0 + w / 2, by + bh + 26, 'rgba(255,255,255,.42)', '300 11px "JetBrains Mono", monospace');

        var eq = 'cos²θ + sen²θ  =  ' + fmt(c*c, 3) + ' + ' + fmt(s*s, 3) + '  =  1';
        txt(eq, x0 + w / 2, L.gy0 + L.A - 18, 'rgba(255,255,255,.55)', '300 12px "JetBrains Mono", monospace');
      }
    }
  });

  /* =========================================================
     CENA 4 — DERIVADA COMO VETOR VELOCIDADE
     ========================================================= */
  SCENES.push({
    id:'deriv', tab:'Derivada',
    tag:'Posição, velocidade e aceleração',
    blurb:'O vetor <b>posição</b> r = (cos θ, sen θ) aponta para o ponto. O vetor <b>velocidade</b> v = (−sen θ, cos θ) é sempre perpendicular a r e tem módulo 1 — é exatamente a derivada. E a <b>aceleração</b> aponta para o centro: a = −r.',
    hint:'Observe o ângulo reto entre r e v — ele nunca muda.',
    usesTheta:true,
    params:{ vel:true, acc:true, slope:true, grid:true },
    controls:function(){
      return [
        {k:'toggle', id:'vel', label:'vetor velocidade v'},
        {k:'toggle', id:'acc', label:'vetor aceleração a'},
        {k:'toggle', id:'slope', label:'reta tangente no gráfico'},
        {k:'buttons', opts:[
          {t:'0°', act:function(){ S.p = 0; }},
          {t:'90°', act:function(){ S.p = 90/360; }},
          {t:'180°', act:function(){ S.p = 180/360; }}
        ]}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      var dot = c * (-s) + s * c;
      return [
        {k:'<span class="sym">θ</span>', v: fmt(p*360,1) + '°'},
        {k:'<span class="sym">r</span> &nbsp;posição', v: '(' + fmt(c,3) + ', ' + fmt(s,3) + ')', c:'cos'},
        {k:'<span class="sym">v</span> &nbsp;velocidade', v: '(' + fmt(-s,3) + ', ' + fmt(c,3) + ')', c:'tan'},
        {k:'<span class="sym">|v|</span> &nbsp;módulo', v: '1,0000'},
        {k:'<span class="sym">r · v</span> &nbsp;produto escalar', v: fmt(dot), c:'alt'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      var cx = L.cx, cy = L.cy, R = L.R;

      graphGrid();
      graphCurve(Math.sin, 0, TAU, COLORS.sin, .16, 1.4, 0);
      graphCurve(Math.sin, 0, th, COLORS.sin, 1, 2.2, 14);
      graphCurve(Math.cos, 0, TAU, COLORS.cos, .14, 1.4, 0);

      circleBase();
      angleArc(th);

      var px = cx + R * c, py = cy - R * s;
      var vx = cx - R * s, vy = cy - R * c;

      lineAt(cx, cy, px, py, 'rgba(255,255,255,.75)', 1.5);
      dotAt(px, py, 4, '#ffffff', 18);

      if(P.acc){
        var ax = px - R * 0.62 * c, ay = py + R * 0.62 * s;
        arrow(px, py, ax, ay, COLORS.alt, 2.2, 12);
        txt('a = −r', ax - 6, ay + 14, COLORS.alt, '300 11px "JetBrains Mono", monospace', 'right');
      }

      if(P.vel){
        var vsc = R * 0.75;
        var ex = px + (-s) * vsc, ey = py - (c) * vsc;
        arrow(px, py, ex, ey, COLORS.tan, 2.4, 14);
        txt('v', ex + 12, ey, COLORS.tan, '400 12px "JetBrains Mono", monospace', 'left');

        var k = 16;
        var a1x = px - c * k, a1y = py + s * k;
        var a2x = a1x + (-s) * k, a2y = a1y - c * k;
        var a3x = px + (-s) * k, a3y = py - c * k;
        lineAt(a1x, a1y, a2x, a2y, 'rgba(255,255,255,.30)', 1);
        lineAt(a2x, a2y, a3x, a3y, 'rgba(255,255,255,.30)', 1);
      }

      txt('r', (cx + px) / 2 - 12, (cy + py) / 2 - 10, 'rgba(255,255,255,.6)', '400 12px "JetBrains Mono", monospace');
      dotAt(cx, cy, 2.4, 'rgba(255,255,255,.85)', 0);

      var mx = L.gx0 + (th / TAU) * (L.gx1 - L.gx0);
      var my = L.gy0 - L.A * s;
      lineAt(mx, L.gy0 - L.A - 12, mx, L.gy0 + L.A + 12, 'rgba(255,255,255,.20)', 1);

      if(P.slope){
        var dxdp = (L.gx1 - L.gx0) / TAU;
        var slope = (-L.A * c) / dxdp;
        var L2 = Math.min(70, (L.gx1 - L.gx0) * 0.16);
        var x1 = mx - L2, x2 = mx + L2;
        var y1 = my - slope * L2, y2 = my + slope * L2;
        graphClip(function(){
          lineAt(x1, y1, x2, y2, 'rgba(177,140,255,.85)', 1.8);
        });
        txt('inclinação = cos θ', mx, L.gy0 - L.A - 26, COLORS.tan, '300 11px "JetBrains Mono", monospace');
      }

      ctx.beginPath(); ctx.arc(mx, my, 9, 0, TAU);
      ctx.fillStyle = 'rgba(53,224,192,.13)'; ctx.fill();
      dotAt(mx, my, 3.6, COLORS.sin, 18);
    }
  });

  /* =========================================================
     CENA 5 — FÓRMULA DE EULER / PLANO COMPLEXO
     ========================================================= */
  SCENES.push({
    id:'euler', tab:'Euler',
    tag:'e^{iθ} = cos θ + i · sen θ',
    blurb:'O mesmo ponto do círculo, agora lido como um <b>número complexo</b> girando. A parte real é o cosseno, a imaginária é o seno. Se o tempo não parar, o ponto sobe numa <b>hélice</b> — a espiral de e^{iθ}.',
    hint:'A hélice é o rastro do número complexo no tempo.',
    usesTheta:true,
    params:{ wave:true, turns:2.5, proj:true },
    controls:function(){
      return [
        {k:'range', id:'turns', label:'Voltas na hélice', min:0.5, max:6, step:0.1,
         fmt:function(v){ return (+v).toFixed(1).replace('.', ',') + '×'; }},
        {k:'toggle', id:'wave', label:'onda da parte imaginária'},
        {k:'toggle', id:'proj', label:'projeções Re / Im'}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      return [
        {k:'<span class="sym">θ</span>', v: fmt(p*360,1) + '°'},
        {k:'<span class="sym">Re</span> = cos θ', v: fmt(c), c:'cos'},
        {k:'<span class="sym">Im</span> = sen θ', v: fmt(s), c:'sin'},
        {k:'<span class="sym">z</span>', v: fmt(c,3) + ' + ' + fmt(s,3) + ' i', c:'tan'},
        {k:'<span class="sym">|z|</span>', v: '1,0000'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p);
      var pad = L.pad;
      var baseX = pad + 108;
      var baseY = H * 0.40;
      var r = Math.min(H * 0.185, 86);
      var N = 300;
      var AX = (W - baseX - pad - r * 0.55 - 26) / N;
      var kx = 0.5, ky = 0.26;
      var T = P.turns;
      var i, u, a, X, Y, Z, sx, sy;

      function hp(u){
        a = th - (u / N) * T * TAU;
        X = u * AX;
        Z = r * Math.sin(a);
        Y = r * Math.cos(a);
        return [baseX + X + Z * kx, baseY - Y + Z * ky];
      }

      for(i = N; i > 0; i--){
        var A1 = hp(i - 1), A0 = hp(i);
        var t = 1 - i / N;
        var col = 'rgba(' +
          Math.round(232 - 179 * t) + ',' +
          Math.round(182 + 42 * t) + ',' +
          Math.round(76 + 116 * t) + ',' + (0.10 + 0.72 * t).toFixed(3) + ')';
        lineAt(A0[0], A0[1], A1[0], A1[1], col, 1.6);
      }

      var ell = sample(90, function(t){
        var aa = t * TAU;
        return [baseX + r * Math.sin(aa) * kx, baseY - r * Math.cos(aa) + r * Math.sin(aa) * ky];
      });
      strokePts(ell, 'rgba(255,255,255,.16)', 1, 1, 0, true);

      lineAt(baseX - r * kx, baseY - r * ky, baseX + r * kx, baseY + r * ky, 'rgba(255,255,255,.18)', 1);
      lineAt(baseX, baseY - r, baseX, baseY + r, 'rgba(255,255,255,.18)', 1);
      txt('Re', baseX + r * kx + 12, baseY + r * ky + 6, 'rgba(255,255,255,.42)', '300 11px "JetBrains Mono", monospace', 'left');
      txt('Im', baseX + 12, baseY - r - 4, 'rgba(255,255,255,.42)', '300 11px "JetBrains Mono", monospace', 'left');

      var cur0 = hp(0);
      var ReP = [baseX + r * Math.sin(th) * kx, baseY + r * Math.sin(th) * ky];
      var ImP = [baseX, baseY - r * Math.cos(th)];

      if(P.proj){
        lineAt(cur0[0], cur0[1], ReP[0], ReP[1], 'rgba(232,182,76,.55)', 1, [3,4]);
        lineAt(cur0[0], cur0[1], ImP[0], ImP[1], 'rgba(53,224,192,.55)', 1, [3,4]);
        lineAt(baseX, baseY, ReP[0], ReP[1], 'rgba(232,182,76,.75)', 1.8);
        lineAt(baseX, baseY, ImP[0], ImP[1], 'rgba(53,224,192,.75)', 1.8);
        dotAt(ReP[0], ReP[1], 3, COLORS.cos, 12);
        dotAt(ImP[0], ImP[1], 3, COLORS.sin, 12);
      }
      lineAt(baseX, baseY, cur0[0], cur0[1], 'rgba(255,255,255,.7)', 1.4);
      dotAt(baseX, baseY, 2.4, 'rgba(255,255,255,.8)', 0);
      halo(cur0[0], cur0[1], 0, 22, 'rgba(255,255,255,.16)');
      dotAt(cur0[0], cur0[1], 4.4, '#ffffff', 22);

      if(P.wave){
        var waveY = H - pad - 58;
        var amp = Math.min(56, H * 0.085);
        var wpts = [];
        for(i = 0; i <= N; i++){
          a = th - (i / N) * T * TAU;
          wpts.push([baseX + i * AX, waveY - amp * Math.sin(a)]);
        }
        strokePts(wpts, COLORS.sin, .55, 1.6, 8);
        var wx = baseX, wy = waveY - amp * Math.sin(th);
        lineAt(cur0[0], cur0[1], wx, wy, 'rgba(255,255,255,.18)', 1, [4,5]);
        lineAt(baseX - 20, waveY, baseX + N * AX, waveY, 'rgba(255,255,255,.14)', 1);
        dotAt(wx, wy, 3.6, COLORS.sin, 18);
        txt('Im(e^{iθ}) = sen θ', baseX + N * AX, waveY - amp - 18,
            'rgba(53,224,192,.65)', '300 11px "JetBrains Mono", monospace', 'right');
      }

      txt('e^{iθ} = cos θ + i · sen θ', baseX + 6, baseY + r + 54,
          'rgba(255,255,255,.55)', '300 13px "JetBrains Mono", monospace', 'left');
      txt('uma volta completa = 2π', W - pad - 10, pad + 16,
          'rgba(255,255,255,.28)', '300 10.5px "JetBrains Mono", monospace', 'right');
    }
  });

  /* =========================================================
     CENA 6 — CICLO HIPERBÓLICO
     ========================================================= */
  SCENES.push({
    id:'hip', tab:'Hiperbólico',
    tag:'cosh²u − senh²u = 1',
    blurb:'A mesma construção, mas sobre a hipérbole <b>x² − y² = 1</b> em vez do círculo. Os comprimentos dos catetos passam a ser <b>cosh u</b> e <b>senh u</b> — e agora a <b>diferença</b> dos quadrados é que vale 1.',
    hint:'A área destacada é o ângulo hiperbólico u.',
    usesTheta:true,
    params:{ sectors:true, grid:true, curve:true },
    controls:function(){
      return [
        {k:'toggle', id:'sectors', label:'setor hiperbólico'},
        {k:'toggle', id:'curve', label:'curvas de cosh e senh'},
        {k:'buttons', opts:[
          {t:'u = 0', act:function(){ S.p = 0.5; }},
          {t:'u = 1', act:function(){ S.p = 0.5 + 1 / 4.8; }},
          {t:'u = −1', act:function(){ S.p = 0.5 - 1 / 4.8; }}
        ]}
      ];
    },
    readouts:function(p){
      var u = 2.4 * Math.sin(p * TAU);
      var ch = Math.cosh(u), sh = Math.sinh(u);
      return [
        {k:'<span class="sym">u</span> &nbsp;ângulo hiperbólico', v: fmt(u,4)},
        {k:'<span class="sym">cosh u</span>', v: fmt(ch), c:'cos'},
        {k:'<span class="sym">senh u</span>', v: fmt(sh), c:'sin'},
        {k:'<span class="sym">cosh²u − senh²u</span>', v: '<b>' + fmt(ch*ch - sh*sh) + '</b>', c:'tan'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var u = 2.4 * Math.sin(p * TAU);
      var SCL = 2.6;
      var k = L.R / SCL;
      var cx = L.cx, cy = L.cy;

      var gx0 = L.gx0, gx1 = L.gx1, gy0 = L.gy0, A = L.A;
      var ySc = 1 / SCL;
      var uMin = -1.7, uMax = 1.7;
      function mapX(uu){ return gx0 + ((uu - uMin) / (uMax - uMin)) * (gx1 - gx0); }

      for(var m = -2; m <= 2; m++){
        lineAt(gx0, gy0 - A * (m / SCL), gx1, gy0 - A * (m / SCL), m === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.055)', 1);
      }
      for(var v = -1.5; v <= 1.5; v += 0.5){
        lineAt(mapX(v), gy0 - A - 10, mapX(v), gy0 + A + 10, 'rgba(255,255,255,.045)', 1);
      }
      lineAt(mapX(0), gy0 - A - 10, mapX(0), gy0 + A + 10, 'rgba(255,255,255,.12)', 1);

      for(m = -2; m <= 2; m++){
        txt(String(m), gx0 - 12, gy0 - A * (m / SCL), 'rgba(255,255,255,.26)', '300 10.5px "JetBrains Mono", monospace', 'right');
      }
      txt('u', gx1, gy0 + 20, 'rgba(255,255,255,.30)', '300 10.5px "JetBrains Mono", monospace', 'right');

      if(P.curve){
        graphClip(function(){
          var n = 200, ptsC = [], ptsS = [];
          for(var i = 0; i <= n; i++){
            var uu = uMin + (uMax - uMin) * i / n;
            ptsC.push([mapX(uu), gy0 - A * Math.cosh(uu) * ySc]);
            ptsS.push([mapX(uu), gy0 - A * Math.sinh(uu) * ySc]);
          }
          strokePts(ptsC, COLORS.cos, .85, 2, 10);
          strokePts(ptsS, COLORS.sin, .85, 2, 10);
        });
        txt('cosh u', gx1, gy0 - A * Math.cosh(uMax) * ySc + 4, COLORS.cos, '300 10.5px "JetBrains Mono", monospace', 'right');
        txt('senh u', gx1, gy0 - A * Math.sinh(uMax) * ySc + 4, COLORS.sin, '300 10.5px "JetBrains Mono", monospace', 'right');
      }

      var mx = mapX(u);
      lineAt(mx, gy0 - A - 10, mx, gy0 + A + 10, 'rgba(255,255,255,.22)', 1);
      graphClip(function(){
        dotAt(mx, gy0 - A * Math.cosh(u) * ySc, 3.6, COLORS.cos, 16);
        dotAt(mx, gy0 - A * Math.sinh(u) * ySc, 3.6, COLORS.sin, 16);
      });

      halo(cx, cy, L.R * 0.5, L.R * 1.7, 'rgba(232,182,76,.045)');

      clipRect(cx - L.R * 1.9, cy - L.R * 1.6, L.R * 3.8, L.R * 3.2, function(){
        lineAt(cx - L.R * 1.8, cy + L.R * 1.8, cx + L.R * 1.8, cy - L.R * 1.8, 'rgba(255,255,255,.13)', 1, [5,6]);
        lineAt(cx - L.R * 1.8, cy - L.R * 1.8, cx + L.R * 1.8, cy + L.R * 1.8, 'rgba(255,255,255,.13)', 1, [5,6]);

        var n = 240, right = [], left = [];
        for(var i = 0; i <= n; i++){
          var uu = -2.0 + 4.0 * i / n;
          var X = k * Math.cosh(uu), Y = k * Math.sinh(uu);
          right.push([cx + X, cy - Y]);
          left.push([cx - X, cy - Y]);
        }
        strokePts(right, 'rgba(232,182,76,.55)', 1.5, 1.6, 8);
        strokePts(left, 'rgba(255,255,255,.10)', 1.2, 1.2, 0);
      });

      lineAt(cx - L.R * 1.6, cy, cx + L.R * 1.6, cy, 'rgba(255,255,255,.15)', 1);
      lineAt(cx, cy - L.R * 1.4, cx, cy + L.R * 1.4, 'rgba(255,255,255,.15)', 1);

      var hx = cx + k * Math.cosh(u), hy = cy - k * Math.sinh(u);
      if(P.sectors){
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for(var i2 = 0; i2 <= 60; i2++){
          var uu2 = u * i2 / 60;
          ctx.lineTo(cx + k * Math.cosh(uu2), cy - k * Math.sinh(uu2));
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(177,140,255,.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(177,140,255,.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      lineAt(cx, cy, hx, cy, COLORS.cos, 2.6, null, .95);
      lineAt(hx, cy, hx, hy, COLORS.sin, 2.6, null, .95);
      lineAt(cx, cy, hx, hy, 'rgba(255,255,255,.7)', 1.4);
      dotAt(cx, cy, 2.4, 'rgba(255,255,255,.85)', 0);
      halo(hx, hy, 0, 20, 'rgba(255,255,255,.14)');
      dotAt(hx, hy, 4.2, '#ffffff', 20);

      txt('cosh u', (cx + hx) / 2, cy + 16, COLORS.cos, '300 11px "JetBrains Mono", monospace');
      txt('senh u', hx + 12, (cy + hy) / 2, COLORS.sin, '300 11px "JetBrains Mono", monospace', 'left');
      txt('(1, 0)', cx + k + 4, cy + 15, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace', 'left');
    }
  });

  /* =========================================================
     CENA 7 — MOVIMENTO HARMÔNICO SIMPLES
     ========================================================= */
  SCENES.push({
    id:'mhs', tab:'MHS',
    tag:'A sombra de um movimento circular',
    blurb:'Um bloco preso a uma mola oscila exatamente na altura da projeção do ponto do círculo. Isso mostra o fato central da física: o <b>movimento harmônico simples é a projeção de um movimento circular uniforme</b>.',
    hint:'Mesma altura, mesmo instante — sempre.',
    usesTheta:true,
    params:{ spring:true, ghost:true, trail:true },
    controls:function(){
      return [
        {k:'toggle', id:'spring', label:'mola e bloco'},
        {k:'toggle', id:'ghost', label:'linha de projeção'},
        {k:'toggle', id:'trail', label:'rastro no círculo'},
        {k:'buttons', opts:[
          {t:'Amplitude máx.', act:function(){ S.p = 0.25; }},
          {t:'Centro', act:function(){ S.p = 0; }}
        ]}
      ];
    },
    readouts:function(p){
      var th = theta(p), s = Math.sin(th);
      return [
        {k:'<span class="sym">θ</span> = ωt', v: fmt(p*360,1) + '°'},
        {k:'<span class="sym">y</span> &nbsp;deslocamento', v: fmt(s,3) + ' A', c:'sin'},
        {k:'<span class="sym">v</span> &nbsp;velocidade', v: fmt(Math.cos(th),3) + ' ωA', c:'cos'},
        {k:'<span class="sym">a</span> &nbsp;aceleração', v: fmt(-s,3) + ' ω²A', c:'alt'},
        {k:'<span class="sym">T</span> &nbsp;período', v: '2π/ω'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p), s = Math.sin(th), c = Math.cos(th);
      var cx = L.cx, cy = L.cy, R = L.R;
      var px = cx + R * c, py = cy - R * s;

      graphGrid();
      graphCurve(Math.sin, 0, TAU, COLORS.sin, .16, 1.4, 0);
      graphCurve(Math.sin, 0, th, COLORS.sin, 1, 2.2, 14);
      var mx = L.gx0 + (th / TAU) * (L.gx1 - L.gx0);
      lineAt(mx, L.gy0 - L.A - 12, mx, L.gy0 + L.A + 12, 'rgba(255,255,255,.20)', 1);
      ctx.beginPath(); ctx.arc(mx, py, 9, 0, TAU);
      ctx.fillStyle = 'rgba(53,224,192,.13)'; ctx.fill();
      dotAt(mx, py, 3.6, COLORS.sin, 18);

      circleBase({ labels: !L.compact });
      angleArc(th);
      if(P.trail) trailArc(th, '#78ffe6');
      lineAt(cx, cy, px, py, 'rgba(255,255,255,.7)', 1.4);
      dotAt(cx, cy, 2.4, 'rgba(255,255,255,.85)', 0);
      dotAt(px, py, 4, '#ffffff', 18);

      if(P.spring && !L.compact){
        var mx0 = (L.mid0 + L.mid1) / 2;
        var topY = cy - R * 1.30;
        var coilW = Math.min(22, (L.mid1 - L.mid0) * 0.22);

        lineAt(mx0 - 42, topY, mx0 + 42, topY, 'rgba(255,255,255,.42)', 2);
        for(var hx = -40; hx <= 40; hx += 8){
          lineAt(mx0 + hx, topY, mx0 + hx - 7, topY - 9, 'rgba(255,255,255,.16)', 1);
        }

        var mpts = [[mx0, topY]];
        var coils = 9, n = coils * 4;
        var len = py - topY;
        for(var i = 1; i < n; i++){
          var t = i / n;
          mpts.push([mx0 + coilW * ((i % 2 === 0) ? 1 : -1), topY + len * t]);
        }
        mpts.push([mx0, py]);
        strokePts(mpts, 'rgba(255,255,255,.42)', 1, 1.6, 0);

        var bw = Math.min(52, (L.mid1 - L.mid0) * 0.52), bh = 30;
        ctx.beginPath();
        ctx.rect(mx0 - bw / 2, py - bh / 2, bw, bh);
        ctx.fillStyle = 'rgba(53,224,192,.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(53,224,192,.8)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx0 - bw / 2 + 6, py - bh / 2 + 6);
        ctx.lineTo(mx0 + bw / 2 - 6, py + bh / 2 - 6);
        ctx.strokeStyle = 'rgba(53,224,192,.30)';
        ctx.stroke();

        txt('m', mx0, py, 'rgba(200,255,240,.9)', '400 12px "JetBrains Mono", monospace');
        txt('k', mx0 + coilW + 16, (topY + py) / 2, 'rgba(255,255,255,.42)', '300 11px "JetBrains Mono", monospace', 'left');

        if(P.ghost){
          lineAt(px, py, mx0 - bw / 2, py, 'rgba(53,224,192,.5)', 1, [4,5]);
          lineAt(mx0 + bw / 2, py, L.gx0, py, 'rgba(53,224,192,.28)', 1, [4,5]);
        }
        txt('MHS = projeção do MCU', mx0, topY - 34, 'rgba(255,255,255,.4)', '300 11px "JetBrains Mono", monospace');
      }

      lineAt(L.gx0, py, L.gx1, py, 'rgba(53,224,192,.16)', 1, [3,6]);
    }
  });

  /* =========================================================
     CENA 8 — SÉRIE DE FOURIER
     ========================================================= */
  function fourierSum(shape, n, x){
    var sum = 0, k;
    if(shape === 'square'){
      for(k = 1; k <= n; k += 2) sum += (4 / PI) * Math.sin(k * x) / k;
    } else if(shape === 'saw'){
      for(k = 1; k <= n; k++) sum += (2 / PI) * Math.sin(k * x) / k;
    } else if(shape === 'tri'){
      for(k = 1; k <= n; k += 2) sum += (8 / (PI * PI)) * Math.pow(-1, (k - 1) / 2) * Math.sin(k * x) / (k * k);
    }
    return sum;
  }

  function fourierTarget(shape, x){
    var s = ((x % TAU) + TAU) % TAU;
    if(shape === 'square') return s < PI ? 1 : -1;
    if(shape === 'saw')    return (s < PI) ? (s / PI) : (s / PI - 2);
    if(shape === 'tri')    return (s < PI / 2) ? (4 * s / (PI)) - 1
                              : (s < 3 * PI / 2 ? 3 - 4 * s / PI : 4 * s / PI - 5);
    return 0;
  }

  SCENES.push({
    id:'fourier', tab:'Fourier',
    tag:'Toda onda é uma soma de senos',
    blurb:'Fourier descobriu que qualquer onda periódica é a soma de senos puros. Aqui a onda alvo (fraca) vai sendo reconstruída pela soma de harmônicos (forte) conforme você aumenta o número de termos.',
    hint:'Aumente os harmônicos e veja o erro cair.',
    usesTheta:true,
    params:{ shape:'square', n:9, target:true, err:true },
    controls:function(){
      return [
        {k:'chips', id:'shape', label:'Onda alvo', opts:[
          {v:'square', t:'quadrada'},
          {v:'saw', t:'dente de serra'},
          {v:'tri', t:'triangular'}
        ]},
        {k:'range', id:'n', label:'Harmônicos', min:1, max:41, step:2,
         fmt:function(v){ return String(Math.round(v)); }},
        {k:'toggle', id:'target', label:'mostrar onda alvo'},
        {k:'toggle', id:'err', label:'erro RMS'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var th = theta(p);
      var n = Math.round(P.n);
      var err = 0, N = 240;
      for(var i = 0; i < N; i++){
        var x = TAU * i / N;
        var d = fourierSum(P.shape, n, x) - fourierTarget(P.shape, x);
        err += d * d;
      }
      err = Math.sqrt(err / N);
      return [
        {k:'<span class="sym">θ</span>', v: fmt(p*360,1) + '°'},
        {k:'<span class="sym">n</span> &nbsp;harmônicos', v: String(n), c:'tan'},
        {k:'<span class="sym">f(θ)</span> &nbsp;série', v: fmt(fourierSum(P.shape, n, th), 4), c:'sin'},
        {k:'<span class="sym">alvo</span>', v: fmt(fourierTarget(P.shape, th), 4), c:'cos'},
        {k:'<span class="sym">erro RMS</span>', v: fmt(err, 4), c:'alt'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var th = theta(p);
      var n = Math.round(P.n);
      var pad = L.pad;
      var x0 = pad + 44, x1 = W - pad - 12;
      var y0 = pad + 34, y1 = H - pad - 34;
      var cy = (y0 + y1) / 2;
      var A = (y1 - y0) / 2 * 0.84;
      var i, x;

      function X(a){ return x0 + (a / TAU) * (x1 - x0); }
      function Y(v){ return cy - A * v; }

      for(var m = -2; m <= 2; m++){
        lineAt(x0, Y(m / 2), x1, Y(m / 2), m === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.055)', 1);
      }
      for(i = 0; i <= 12; i++){
        var a = i * PI / 6;
        lineAt(X(a), y0, X(a), y1, (i % 3 === 0) ? 'rgba(255,255,255,.075)' : 'rgba(255,255,255,.03)', 1);
      }
      var labs = ['0', 'π/2', 'π', '3π/2', '2π'];
      for(i = 0; i <= 4; i++){
        txt(labs[i], X(i * PI / 2), y1 + 18, 'rgba(255,255,255,.30)', '300 10.5px "JetBrains Mono", monospace',
            i === 0 ? 'left' : (i === 4 ? 'right' : 'center'));
      }
      for(m = -2; m <= 2; m++){
        txt(String(m / 2).replace('.', ','), x0 - 12, Y(m / 2), 'rgba(255,255,255,.26)', '300 10.5px "JetBrains Mono", monospace', 'right');
      }

      if(P.target){
        var tp = [];
        var Nt = Math.max(200, (x1 - x0) * 3);
        for(i = 0; i <= Nt; i++){
          var ax = TAU * i / Nt;
          tp.push([X(ax), Y(fourierTarget(P.shape, ax))]);
        }
        strokePts(tp, 'rgba(255,255,255,.20)', 1, 1.4, 0);
      }

      clipRect(x0 - 2, y0 - 2, (x1 - x0) + 4, (y1 - y0) + 4, function(){
        var full = [], lead = [];
        var Nf = Math.max(240, (x1 - x0) * 3);
        for(i = 0; i <= Nf; i++){
          var bx = TAU * i / Nf;
          var pt = [X(bx), Y(fourierSum(P.shape, n, bx))];
          full.push(pt);
          if(bx <= th) lead.push(pt);
        }
        strokePts(full, COLORS.sin, .20, 1.5, 0);
        if(lead.length > 1) strokePts(lead, COLORS.sin, 1, 2.4, 16);
      });

      var hx = X(th);
      lineAt(hx, y0, hx, y1, 'rgba(255,255,255,.20)', 1);
      dotAt(hx, Y(fourierSum(P.shape, n, th)), 3.8, COLORS.sin, 18);
      if(P.target) dotAt(hx, Y(fourierTarget(P.shape, th)), 3.2, 'rgba(255,255,255,.6)', 8);

      txt('soma de ' + n + ' harmônico' + (n > 1 ? 's' : ''), x1, y0 - 14,
          'rgba(53,224,192,.7)', '300 11px "JetBrains Mono", monospace', 'right');
      if(P.target) txt('onda alvo', x1, y0 - 14 + 16,
          'rgba(255,255,255,.35)', '300 11px "JetBrains Mono", monospace', 'right');
    }
  });

  /* =========================================================
     CENA 9 — EPICICLOS (DECOMPOSIÇÃO DE FOURIER)
     ========================================================= */
  function shapePoint(name, t){
    var q, i, f, a, b;
    if(name === 'circle'){
      var ang = t * TAU;
      return { re: 0.6 + 0.6 * Math.cos(ang), im: 0.6 * Math.sin(ang) };
    }
    if(name === 'square'){
      q = t * 4;
      if(q < 1) return { re: -1 + q * 2, im: -1 };
      if(q < 2) return { re: 1, im: -1 + (q - 1) * 2 };
      if(q < 3) return { re: 1 - (q - 2) * 2, im: 1 };
      return { re: -1, im: 1 - (q - 3) * 2 };
    }
    if(name === 'triangle'){
      var tv = [[0, -1.1], [1.05, 0.7], [-1.05, 0.7]];
      return polyPoint(tv, t);
    }
    if(name === 'star'){
      var sv = [], k;
      for(k = 0; k < 10; k++){
        var ra = k % 2 === 0 ? 1.1 : 0.45;
        var aa = -PI / 2 + k * PI / 5;
        sv.push([ra * Math.cos(aa), ra * Math.sin(aa)]);
      }
      return polyPoint(sv, t);
    }
    if(name === 'heart'){
      var hx2 = t * TAU;
      return {
        re: Math.pow(Math.sin(hx2), 3),
        im: -(13 * Math.cos(hx2) - 5 * Math.cos(2 * hx2) - 2 * Math.cos(3 * hx2) - Math.cos(4 * hx2)) / 14
      };
    }
    return { re: Math.cos(t * TAU), im: Math.sin(t * TAU) };
  }

  function polyPoint(verts, t){
    var n = verts.length;
    var q = t * n;
    var i = Math.floor(q) % n;
    var f = q - Math.floor(q);
    var a = verts[i], b = verts[(i + 1) % n];
    return { re: a[0] + (b[0] - a[0]) * f, im: a[1] + (b[1] - a[1]) * f };
  }

  var EPI = {};

  function epiBuild(shape, M){
    var key = shape + '|' + M;
    if(EPI[key]) return EPI[key];

    var N = 128, k, n, re, im, ang, p;
    var pts = [];
    for(k = 0; k < N; k++) pts.push(shapePoint(shape, k / N));

    var coeffs = [];
    for(n = -N / 2 + 1; n <= N / 2; n++){
      re = 0; im = 0;
      for(k = 0; k < N; k++){
        ang = -TAU * n * k / N;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        re += pts[k].re * ca - pts[k].im * sa;
        im += pts[k].re * sa + pts[k].im * ca;
      }
      re /= N; im /= N;
      coeffs.push({ f: n, re: re, im: im, amp: Math.sqrt(re * re + im * im) });
    }
    coeffs.sort(function(a, b){ return b.amp - a.amp; });
    var use = coeffs.slice(0, Math.max(1, Math.min(M, coeffs.length)));

    var trace = [];
    for(k = 0; k <= 420; k++){
      p = epiEval(use, k / 420);
      trace.push([p.re, p.im]);
    }
    EPI[key] = { use: use, trace: trace };
    return EPI[key];
  }

  function epiEval(use, t){
    var re = 0, im = 0;
    for(var i = 0; i < use.length; i++){
      var c = use[i];
      var ang = TAU * c.f * t;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      re += c.re * ca - c.im * sa;
      im += c.re * sa + c.im * ca;
    }
    return { re: re, im: im };
  }

  SCENES.push({
    id:'epi', tab:'Epiciclos',
    tag:'Desenhando com círculos girando',
    blurb:'Cada círculo gira com um raio e uma velocidade próprios; a ponta da corrente desenha a figura. É a <b>série de Fourier vista por dentro</b> — e vale para qualquer curva fechada.',
    hint:'Poucos círculos já dão a forma geral; muitos reproduzem o detalhe.',
    usesTheta:false,
    params:{ shape:'square', m:12, circles:true },
    controls:function(){
      return [
        {k:'chips', id:'shape', label:'Figura', opts:[
          {v:'square', t:'quadrado'},
          {v:'triangle', t:'triângulo'},
          {v:'star', t:'estrela'},
          {v:'heart', t:'coração'},
          {v:'circle', t:'círculo fora do centro'}
        ]},
        {k:'range', id:'m', label:'Círculos', min:1, max:64, step:1,
         fmt:function(v){ return String(Math.round(v)); }},
        {k:'toggle', id:'circles', label:'mostrar círculos'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var d = epiBuild(P.shape, Math.round(P.m));
      var tip = epiEval(d.use, p);
      var amp0 = d.use[0] ? d.use[0].amp : 0;
      return [
        {k:'<span class="sym">t</span> &nbsp;fase', v: fmt(p, 4)},
        {k:'<span class="sym">círculos</span>', v: String(d.use.length), c:'tan'},
        {k:'<span class="sym">ponta</span>', v: '(' + fmt(tip.re, 3) + ', ' + fmt(tip.im, 3) + ')', c:'sin'},
        {k:'<span class="sym">maior raio</span>', v: fmt(amp0, 4), c:'cos'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var M = Math.round(P.m);
      var d = epiBuild(P.shape, M);
      var ox = W / 2, oy = H / 2;
      var sc = Math.min(W, H) * 0.30;
      var i, j;

      function T(pt){ return [ox + pt[0] * sc, oy - pt[1] * sc]; }

      var full = d.trace.map(T);
      strokePts(full, 'rgba(255,255,255,.13)', 1, 1.4, 0, true);

      var upto = Math.max(2, Math.round(p * d.trace.length));
      var lead = full.slice(0, upto);
      if(lead.length > 1) strokePts(lead, COLORS.sin, 1, 2.4, 16);

      var x = ox, y = oy;
      var t = p;
      for(i = 0; i < d.use.length; i++){
        var c = d.use[i];
        var ang = TAU * c.f * t;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var vx = (c.re * ca - c.im * sa) * sc;
        var vy = (c.re * sa + c.im * ca) * sc;
        var nx = x + vx, ny = y - vy;
        var rad = c.amp * sc;

        if(P.circles && i < 40 && rad > 1.2){
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TAU);
          ctx.strokeStyle = 'rgba(177,140,255,' + (0.34 - Math.min(0.24, i * 0.007)).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if(i < 26){
          lineAt(x, y, nx, ny, 'rgba(255,255,255,.16)', 1);
        }
        x = nx; y = ny;
      }

      halo(x, y, 0, 22, 'rgba(53,224,192,.18)');
      dotAt(x, y, 4.4, '#ffffff', 22);
      dotAt(ox, oy, 2.4, 'rgba(255,255,255,.6)', 0);

      txt('soma de ' + d.use.length + ' vetores girando', W / 2, H - 30,
          'rgba(255,255,255,.34)', '300 11px "JetBrains Mono", monospace');
    }
  });

  /* =========================================================
     CENA 10 — FIGURAS DE LISSAJOUS
     ========================================================= */
  var LIS = {};

  function lissBuild(a, b, dl){
    var key = a + '|' + b + '|' + dl.toFixed(3);
    if(LIS[key]) return LIS[key];
    var pts = [];
    for(var i = 0; i <= 900; i++){
      var t = TAU * i / 900;
      pts.push([Math.sin(a * t + dl), Math.sin(b * t)]);
    }
    LIS[key] = pts;
    return pts;
  }

  SCENES.push({
    id:'lis', tab:'Lissajous',
    tag:'x = sen(at + δ) · y = sen(bt)',
    blurb:'Dois movimentos harmônicos independentes, um na horizontal e outro na vertical. A combinação gera as <b>figuras de Lissajous</b> — as mesmas que aparecem em osciloscópios e em instrumentos de corda afinados.',
    hint:'Ajuste as frequências a e b e a defasagem δ.',
    usesTheta:false,
    params:{ a:3, b:2, d:0, grid:true },
    controls:function(){
      return [
        {k:'range', id:'a', label:'Frequência horizontal a', min:1, max:9, step:1,
         fmt:function(v){ return String(Math.round(v)); }},
        {k:'range', id:'b', label:'Frequência vertical b', min:1, max:9, step:1,
         fmt:function(v){ return String(Math.round(v)); }, tone:'warm'},
        {k:'range', id:'d', label:'Defasagem δ', min:0, max:3.1416, step:0.01,
         fmt:function(v){ return (+v).toFixed(2).replace('.', ',') + ' rad'; }, tone:'cool'},
        {k:'toggle', id:'grid', label:'grade e eixos'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var t = p * TAU;
      var x = Math.sin(P.a * t + P.d), y = Math.sin(P.b * t);
      return [
        {k:'<span class="sym">t</span> &nbsp;parâmetro', v: fmt(t, 4)},
        {k:'<span class="sym">x</span> = sen(a·t + δ)', v: fmt(x), c:'cos'},
        {k:'<span class="sym">y</span> = sen(b·t)', v: fmt(y), c:'sin'},
        {k:'<span class="sym">a : b</span>', v: Math.round(P.a) + ' : ' + Math.round(P.b), c:'tan'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var side = Math.min(W - 2 * L.pad, H - 2 * L.pad) * 0.86;
      var ox = W / 2, oy = H / 2, h = side / 2;

      function T(pt){ return [ox + pt[0] * h, oy - pt[1] * h]; }

      if(P.grid){
        ctx.strokeStyle = 'rgba(255,255,255,.055)';
        ctx.lineWidth = 1;
        for(var k = -2; k <= 2; k++){
          ctx.beginPath();
          ctx.moveTo(ox - h, oy + h * k / 2); ctx.lineTo(ox + h, oy + h * k / 2);
          ctx.moveTo(ox + h * k / 2, oy - h); ctx.lineTo(ox + h * k / 2, oy + h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.beginPath();
        ctx.moveTo(ox - h, oy); ctx.lineTo(ox + h, oy);
        ctx.moveTo(ox, oy - h); ctx.lineTo(ox, oy + h);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.strokeRect(ox - h, oy - h, h * 2, h * 2);
        txt('1', ox + h + 10, oy, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace', 'left');
        txt('−1', ox - h - 10, oy, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace', 'right');
      }

      var pts = lissBuild(P.a, P.b, P.d);
      var full = pts.map(T);
      strokePts(full, 'rgba(255,255,255,.12)', 1, 1.4, 0);

      var upto = Math.max(2, Math.round(p * (full.length - 1)));
      var lead = full.slice(0, upto);
      if(lead.length > 1) strokePts(lead, COLORS.sin, 1, 2.2, 14);

      var t = p * TAU;
      var px = Math.sin(P.a * t + P.d), py = Math.sin(P.b * t);
      lineAt(ox - h, oy - py * h, ox + px * h, oy - py * h, 'rgba(53,224,192,.22)', 1, [3,5]);
      lineAt(ox + px * h, oy + h, ox + px * h, oy - py * h, 'rgba(232,182,76,.22)', 1, [3,5]);
      dotAt(ox + px * h, oy - py * h, 4.2, '#ffffff', 20);
    }
  });

  /* =========================================================
     CENA 11 — COORDENADAS POLARES
     ========================================================= */
  var POLAR = {
    rosa:      { label:'rosácea  r = cos(kθ)',   max: 2,  r:function(k, th){ return Math.cos(k * th); }, tmax:function(k){ return (k % 2 === 1) ? PI : TAU; } },
    cardioide: { label:'cardioide r = 1 − cos θ', max: 0,  r:function(k, th){ return 1 - Math.cos(th); }, tmax:function(){ return TAU; } },
    espiral:   { label:'espiral  r = 0,3·θ',      max: 0,  r:function(k, th){ return 0.30 * th; }, tmax:function(){ return 4 * PI; } },
    lemniscata:{ label:'lemniscata  r = √|cos 2θ|', max: 0, r:function(k, th){ return Math.sqrt(Math.abs(Math.cos(2 * th))); }, tmax:function(){ return TAU; } },
    limacon:   { label:'limaçon  r = 1 + 0,6 cos θ', max: 0, r:function(k, th){ return 1 + 0.6 * Math.cos(th); }, tmax:function(){ return TAU; } }
  };

  SCENES.push({
    id:'pol', tab:'Polares',
    tag:'r = f(θ) no plano polar',
    blurb:'Aqui o ângulo continua girando, mas o raio deixa de ser 1: ele passa a ser dado por uma função. Uma equação simples como <b>r = cos(kθ)</b> desenha rosáceas de pétalas; <b>r = 1 − cos θ</b> desenha um coração.',
    hint:'Escolha a curva e o número de pétalas.',
    usesTheta:false,
    params:{ curve:'rosa', k:5, grid:true },
    controls:function(){
      return [
        {k:'chips', id:'curve', label:'Curva', opts:[
          {v:'rosa', t:'rosácea'},
          {v:'cardioide', t:'cardioide'},
          {v:'espiral', t:'espiral'},
          {v:'lemniscata', t:'lemniscata'},
          {v:'limacon', t:'limaçon'}
        ]},
        {k:'range', id:'k', label:'Pétalas / fator k', min:2, max:9, step:1,
         fmt:function(v){ return String(Math.round(v)); }},
        {k:'toggle', id:'grid', label:'grade polar'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var C = POLAR[P.curve];
      var tmax = C.tmax(Math.round(P.k));
      var th = p * tmax;
      var r = C.r(Math.round(P.k), th);
      return [
        {k:'<span class="sym">θ</span>', v: fmt(th,4) + '<span class="sub">' + fmt(th * DEG,1) + '°</span>'},
        {k:'<span class="sym">r</span>', v: fmt(r,4), c:'sin'},
        {k:'<span class="sym">x</span> = r cos θ', v: fmt(r * Math.cos(th),4), c:'cos'},
        {k:'<span class="sym">y</span> = r sen θ', v: fmt(r * Math.sin(th),4), c:'cos'},
        {k:'<span class="sym">volta</span>', v: fmt(p * 100,1) + ' %'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var C = POLAR[P.curve];
      var K = Math.round(P.k);
      var tmax = C.tmax(K);
      var th = p * tmax;

      var ox = W / 2, oy = H / 2;
      var maxR = 0;
      for(var i = 0; i <= 400; i++){
        var v = Math.abs(C.r(K, tmax * i / 400));
        if(v > maxR) maxR = v;
      }
      maxR = Math.max(0.4, maxR);
      var sc = (Math.min(W - 2 * L.pad, H - 2 * L.pad) * 0.44) / maxR;

      if(P.grid){
        for(var ring = 1; ring <= 4; ring++){
          ctx.beginPath();
          ctx.arc(ox, oy, sc * maxR * ring / 4, 0, TAU);
          ctx.strokeStyle = 'rgba(255,255,255,.045)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        for(var a = 0; a < 12; a++){
          var ang = a * PI / 6;
          lineAt(ox, oy, ox + Math.cos(ang) * sc * maxR, oy - Math.sin(ang) * sc * maxR, 'rgba(255,255,255,.045)', 1);
        }
        lineAt(ox - sc * maxR, oy, ox + sc * maxR, oy, 'rgba(255,255,255,.14)', 1);
        lineAt(ox, oy - sc * maxR, ox, oy + sc * maxR, 'rgba(255,255,255,.14)', 1);
        txt('0°', ox + sc * maxR + 12, oy, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace', 'left');
        txt('90°', ox, oy - sc * maxR - 12, 'rgba(255,255,255,.3)', '300 10px "JetBrains Mono", monospace');
      }

      var full = [];
      var N = 720;
      for(i = 0; i <= N; i++){
        var t2 = tmax * i / N;
        var r2 = C.r(K, t2);
        full.push([ox + r2 * Math.cos(t2) * sc, oy - r2 * Math.sin(t2) * sc]);
      }
      strokePts(full, 'rgba(255,255,255,.12)', 1, 1.4, 0);

      var upto = Math.max(2, Math.round(p * N));
      if(upto > 1) strokePts(full.slice(0, upto), COLORS.sin, 1, 2.4, 16);

      var rr = C.r(K, th);
      var px = ox + rr * Math.cos(th) * sc;
      var py = oy - rr * Math.sin(th) * sc;
      lineAt(ox, oy, px, py, 'rgba(232,182,76,.75)', 1.6);
      dotAt(ox, oy, 2.6, 'rgba(255,255,255,.7)', 0);
      halo(px, py, 0, 22, 'rgba(53,224,192,.18)');
      dotAt(px, py, 4.4, '#ffffff', 20);

      txt(C.label, W / 2, H - 30, 'rgba(255,255,255,.36)', '300 11.5px "JetBrains Mono", monospace');
    }
  });

  /* =========================================================
     CENA 12 — EXPLORADOR A·sen(Bx + C) + D
     ========================================================= */
  SCENES.push({
    id:'par', tab:'Parâmetros',
    tag:'y = A · sen(Bx + C) + D',
    blurb:'Cada parâmetro faz uma coisa só: <b>A</b> estica na vertical, <b>B</b> comprime na horizontal, <b>C</b> desloca a fase e <b>D</b> sobe ou desce a curva. Ligue a segunda onda para ver o <b>batimento</b> — a base do som e da interferência.',
    hint:'Aproxime as duas frequências e veja o batimento aparecer.',
    usesTheta:false,
    params:{ A:1, B:1, C:0, D:0, two:false, A2:1, B2:1.2, showBase:true },
    controls:function(){
      return [
        {k:'range', id:'A',  label:'A · amplitude',     min:0.1, max:2, step:0.01, fmt:function(v){ return (+v).toFixed(2).replace('.', ','); }},
        {k:'range', id:'B',  label:'B · frequência',    min:0.5, max:5, step:0.01, tone:'warm', fmt:function(v){ return (+v).toFixed(2).replace('.', ','); }},
        {k:'range', id:'C',  label:'C · fase',          min:-PI, max:PI, step:0.01, tone:'cool', fmt:function(v){ return (+v).toFixed(2).replace('.', ',') + ' rad'; }},
        {k:'range', id:'D',  label:'D · deslocamento',  min:-1, max:1, step:0.01, fmt:function(v){ return (+v).toFixed(2).replace('.', ','); }},
        {k:'toggle', id:'two', label:'segunda onda + soma'},
        {k:'range', id:'A2', label:'A₂', min:0.1, max:2, step:0.01, tone:'cool', fmt:function(v){ return (+v).toFixed(2).replace('.', ','); }},
        {k:'range', id:'B2', label:'B₂', min:0.5, max:5, step:0.01, tone:'cool', fmt:function(v){ return (+v).toFixed(2).replace('.', ','); }},
        {k:'toggle', id:'showBase', label:'mostrar sen x original'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var x = p * TAU;
      var y1 = P.A * Math.sin(P.B * x + P.C) + P.D;
      var y2 = P.A2 * Math.sin(P.B2 * x);
      return [
        {k:'<span class="sym">x</span>', v: fmt(x,4) + '<span class="sub">' + fmt(x * DEG,1) + '°</span>'},
        {k:'<span class="sym">y</span>', v: fmt(y1), c:'sin'},
        {k:'<span class="sym">y₂</span>', v: fmt(y2), c:'cos'},
        {k:'<span class="sym">y + y₂</span>', v: fmt(y1 + y2), c:'tan'},
        {k:'<span class="sym">período</span>', v: fmt(TAU / P.B, 4)}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var pad = L.pad;
      var x0 = pad + 46, x1 = W - pad - 12;
      var y0 = pad + 34, y1 = H - pad - 34;
      var cy = (y0 + y1) / 2;
      var A = (y1 - y0) / 2 * 0.80;
      var i, a;

      function X(v){ return x0 + (v / TAU) * (x1 - x0); }
      function Y(v){ return cy - A * v / 1.6; }

      for(var m = -2; m <= 2; m++){
        lineAt(x0, Y(m * 0.8), x1, Y(m * 0.8), m === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.055)', 1);
      }
      for(i = 0; i <= 12; i++){
        a = i * PI / 6;
        lineAt(X(a), y0, X(a), y1, (i % 3 === 0) ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.03)', 1);
      }
      var labs = ['0', 'π/2', 'π', '3π/2', '2π'];
      for(i = 0; i <= 4; i++){
        txt(labs[i], X(i * PI / 2), y1 + 18, 'rgba(255,255,255,.30)', '300 10.5px "JetBrains Mono", monospace',
            i === 0 ? 'left' : (i === 4 ? 'right' : 'center'));
      }
      for(m = -2; m <= 2; m++){
        txt(fmt(m * 0.8, 1), x0 - 12, Y(m * 0.8), 'rgba(255,255,255,.26)', '300 10.5px "JetBrains Mono", monospace', 'right');
      }

      var N = 720;
      var base = [], one = [], two = [], sum = [];
      for(i = 0; i <= N; i++){
        var xv = TAU * i / N;
        var v1 = P.A * Math.sin(P.B * xv + P.C) + P.D;
        var v2 = P.A2 * Math.sin(P.B2 * xv);
        if(P.showBase) base.push([X(xv), Y(Math.sin(xv))]);
        one.push([X(xv), Y(v1)]);
        if(P.two){ two.push([X(xv), Y(v2)]); sum.push([X(xv), Y(v1 + v2)]); }
      }

      clipRect(x0 - 2, y0 - 2, (x1 - x0) + 4, (y1 - y0) + 4, function(){
        if(P.showBase) strokePts(base, 'rgba(255,255,255,.13)', 1, 1.4, 0);
        if(P.two){
          strokePts(two, COLORS.cos, .45, 1.6, 0);
          strokePts(sum, COLORS.tan, .95, 2.2, 12);
        }
        strokePts(one, COLORS.sin, 1, 2.4, 16);
      });

      var hx = X(p * TAU);
      lineAt(hx, y0, hx, y1, 'rgba(255,255,255,.20)', 1);
      dotAt(hx, Y(P.A * Math.sin(P.B * p * TAU + P.C) + P.D), 4, COLORS.sin, 18);
      if(P.two) dotAt(hx, Y(P.A2 * Math.sin(P.B2 * p * TAU)), 3.4, COLORS.cos, 12);

      txt('y = ' + fmt(P.A,2) + ' · sen(' + fmt(P.B,2) + 'x + ' + fmt(P.C,2) + ') + ' + fmt(P.D,2),
          x1, y0 - 14, 'rgba(53,224,192,.75)', '300 11.5px "JetBrains Mono", monospace', 'right');
      if(P.two){
        txt('soma (batimento)', x1, y0 + 4, 'rgba(177,140,255,.7)', '300 11px "JetBrains Mono", monospace', 'right');
      }
    }
  });

  /* =========================================================
     CENA 13 — HÉLICE (A ONDA COMO PROJEÇÃO)
     ========================================================= */
  SCENES.push({
    id:'hel', tab:'Hélice',
    tag:'A onda é a sombra da hélice',
    blurb:'Uma mola girando no espaço. Vista de lado, ela parece uma onda — a curva de cosseno é literalmente a <b>projeção da hélice</b> no plano de trás. As linhas tracejadas mostram cada ponto caindo na sua sombra.',
    hint:'Gire a hélice e acompanhe a sombra.',
    usesTheta:false,
    params:{ turns:2.5, links:true, wall:true },
    controls:function(){
      return [
        {k:'range', id:'turns', label:'Voltas', min:0.75, max:5, step:0.25,
         fmt:function(v){ return (+v).toFixed(2).replace('.', ',') + '×'; }},
        {k:'toggle', id:'links', label:'linhas de projeção'},
        {k:'toggle', id:'wall', label:'plano de fundo'}
      ];
    },
    readouts:function(p){
      var P = cur.params;
      var a = p * P.turns * TAU;
      return [
        {k:'<span class="sym">a</span> &nbsp;parâmetro', v: fmt(a,4)},
        {k:'<span class="sym">a / 2π</span>', v: fmt(a / TAU,3) + ' voltas'},
        {k:'<span class="sym">cos a</span> &nbsp;altura', v: fmt(Math.cos(a)), c:'cos'},
        {k:'<span class="sym">sen a</span> &nbsp;profundidade', v: fmt(Math.sin(a)), c:'sin'}
      ];
    },
    draw:function(g, p){
      var P = cur.params;
      var pad = L.pad;
      var ox = pad + 54, oy = H * 0.36;
      var R = Math.min(H * 0.145, 76);
      var kx = 0.52, ky = 0.28;
      var aMax = P.turns * TAU;
      var c = (W - ox - pad - R * kx - 26) / aMax;
      var D = R * 2.2;
      var i, a;

      function proj(X, Y, Z){ return [ox + X + Z * kx, oy - Y - Z * ky]; }

      if(P.wall){
        var wx0 = 0, wx1 = aMax;
        var c1 = proj(wx0, 1.35 * R, -D), c2 = proj(wx1, 1.35 * R, -D);
        var c3 = proj(wx1, -1.35 * R, -D), c4 = proj(wx0, -1.35 * R, -D);
        ctx.beginPath();
        ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]);
        ctx.lineTo(c3[0], c3[1]); ctx.lineTo(c4[0], c4[1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,.014)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        for(i = 0; i <= 12; i++){
          var Xg = aMax * i / 12;
          var g1 = proj(Xg, 1.35 * R, -D), g2 = proj(Xg, -1.35 * R, -D);
          lineAt(g1[0], g1[1], g2[0], g2[1], 'rgba(255,255,255,.035)', 1);
        }
        for(i = -2; i <= 2; i++){
          var Yg = R * i / 2;
          var h1 = proj(0, Yg, -D), h2 = proj(aMax, Yg, -D);
          lineAt(h1[0], h1[1], h2[0], h2[1], 'rgba(255,255,255,.035)', 1);
        }
      }

      var shadow = [];
      for(i = 0; i <= 400; i++){
        a = aMax * i / 400;
        shadow.push(proj(c * a, R * Math.cos(a), -D));
      }
      strokePts(shadow, 'rgba(232,182,76,.55)', 1.6, 1.8, 10);

      var seg = 700;
      for(i = 0; i < seg; i++){
        var a1 = aMax * i / seg, a2 = aMax * (i + 1) / seg;
        var P1 = proj(c * a1, R * Math.cos(a1), R * Math.sin(a1));
        var P2 = proj(c * a2, R * Math.cos(a2), R * Math.sin(a2));
        var front = (Math.sin(a1) + 1) / 2;
        var col = 'rgba(' +
          Math.round(232 - 179 * front) + ',' +
          Math.round(182 + 42 * front) + ',' +
          Math.round(76 + 116 * front) + ',' + (0.28 + 0.62 * front).toFixed(3) + ')';
        lineAt(P1[0], P1[1], P2[0], P2[1], col, 1.7);
      }

      var aNow = p * aMax;
      if(P.links){
        for(i = 0; i <= 16; i++){
          var al = aMax * i / 16;
          var h1b = proj(c * al, R * Math.cos(al), R * Math.sin(al));
          var h2b = proj(c * al, R * Math.cos(al), -D);
          lineAt(h1b[0], h1b[1], h2b[0], h2b[1], 'rgba(255,255,255,.10)', 1, [3,4]);
        }
      }

      var Pn = proj(c * aNow, R * Math.cos(aNow), R * Math.sin(aNow));
      var Ps = proj(c * aNow, R * Math.cos(aNow), -D);
      lineAt(Pn[0], Pn[1], Ps[0], Ps[1], 'rgba(255,255,255,.42)', 1.2, [4,4]);
      halo(Pn[0], Pn[1], 0, 22, 'rgba(53,224,192,.20)');
      dotAt(Pn[0], Pn[1], 4.4, '#ffffff', 22);
      dotAt(Ps[0], Ps[1], 3.6, COLORS.cos, 16);

      txt('hélice', ox + 6, oy - R - 26, 'rgba(255,255,255,.42)', '300 11px "JetBrains Mono", monospace', 'left');
      txt('projeção: cos a', ox + 6, oy + D * ky + R * 1.35 + 22, 'rgba(232,182,76,.65)', '300 11px "JetBrains Mono", monospace', 'left');
    }
  });

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */
  boot();

})();