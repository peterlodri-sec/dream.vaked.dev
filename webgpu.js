/* dream.vaked.dev — WebGPU renderer with Canvas2D fallback
   A worker-től kapott ternary-quant részecske-pozíciókat rajzolja.
   WebGPU (pont-sprite shader) ha elérhető, különben Canvas2D. */
"use strict";

(function () {
  const canvas = document.getElementById("scene");
  const ctx2d = canvas.getContext("2d");

  let gpu = null;       // { device, pipeline, bindGroup, vertBuf, uniformBuf, renderPass }
  let useGPU = false;
  let W = 0, H = 0;
  let points = [];      // [{x,y,r,hue,a}]
  let bgHue = 20;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ── WebGPU init ── */
  async function initGPU() {
    if (!navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      const device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();
      const context = canvas.getContext("webgpu");
      if (!context) return false;
      context.configure({ device, format, alphaMode: "premultiplied" });

      // vertex buffer: max 512 részecske * 6 float (x,y,r,hue,a,pad)
      const MAX = 512;
      const vertBuf = device.createBuffer({
        size: MAX * 6 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });

      const shader = device.createShaderModule({
        code: `
          struct Particle { pos: vec2<f32>, size: f32, hue: f32, alpha: f32, pad: f32 };
          @group(0) @binding(0) var<uniform> uni: vec4<f32>; // (W, H, time, stage)
          struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) hue: f32, @location(1) alpha: f32 };
          @vertex fn vs_main(@location(0) p: vec2<f32>, @location(1) s: f32,
                             @location(2) h: f32, @location(3) a: f32) -> VSOut {
            var out: VSOut;
            let ndc = vec2<f32>((p.x / uni.x) * 2.0 - 1.0, 1.0 - (p.y / uni.y) * 2.0);
            out.pos = vec4<f32>(ndc, 0.0, 1.0);
            out.hue = h; out.alpha = a;
            // a pont méretét a vertex shader nem tudja közvetlenül állítani
            // (a point size nem része a modern WebGPU-nak) — a fragment
            // shaderben egy quad-ot rajzolunk a gl_PointSize helyett.
            return out;
          }
          @fragment fn fs_main(@location(0) h: f32, @location(1) a: f32) -> @location(0) vec4<f32> {
            // egyszerű glóriás pont (a fragment shader a quadot kerekíti)
            return vec4<f32>(hsv2rgb(vec3<f32>(h / 360.0, 0.8, 0.9)), a);
          }
          fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
            let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
            return c.z * mix(k.xxx, clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
          }
        `
      });

      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shader,
          entryPoint: "vs_main",
          buffers: [{
            arrayStride: 6 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32" },
              { shaderLocation: 2, offset: 12, format: "float32" },
              { shaderLocation: 3, offset: 16, format: "float32" }
            ]
          }]
        },
        fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "point-list" }
      });

      const uniformBuf = device.createBuffer({
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuf } }]
      });

      gpu = { device, pipeline, bindGroup, vertBuf, uniformBuf };
      useGPU = true;
      return true;
    } catch (e) {
      console.warn("WebGPU init failed, falling back to Canvas2D:", e);
      return false;
    }
  }

  /* ── render ── */
  function render(time, stage) {
    bgHue = [20, 0, 210, 260, 300, 180, 200, 45][stage] || 20;
    // RIVA légzés-ciklus: 4s belégzés, 4s kilégzés → 0..1 fázis
    var breath = Math.sin(time * (Math.PI / 4));
    var breathScale = 1 + breath * 0.15;   // a részecskék mérete a légzéssel
    if (useGPU && gpu) {
      const { device, pipeline, bindGroup, vertBuf, uniformBuf } = gpu;
      // feltöltjük a vertex buffert
      const data = new Float32Array(points.length * 6);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        data[i * 6] = p.x; data[i * 6 + 1] = p.y;
        data[i * 6 + 2] = p.r * breathScale; data[i * 6 + 3] = p.hue; data[i * 6 + 4] = p.a; data[i * 6 + 5] = 0;
      }
      device.queue.writeBuffer(vertBuf, 0, data);
      device.queue.writeBuffer(uniformBuf, 0, new Float32Array([W, H, time, stage]));

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0.03, g: 0.016, b: 0.024, a: 1 },
          loadOp: "clear", storeOp: "store"
        }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertBuf);
      pass.draw(points.length, 1, 0, 0);
      pass.end();
      device.queue.submit([encoder.finish()]);
    } else {
      // Canvas2D fallback
      const grad = ctx2d.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      grad.addColorStop(0, "hsla(" + bgHue + ",60%,12%,0.9)");
      grad.addColorStop(1, "#080406");
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, W, H);
      // a tűzgyűrű
      const ringR = Math.min(W, H) * 0.32;
      const ringA = (stage >= 6) ? 0.5 + 0.3 * Math.sin(time * 0.02) : 0.18 + 0.08 * Math.sin(time * 0.03);
      ctx2d.beginPath();
      ctx2d.arc(W / 2, H / 2, ringR, 0, Math.PI * 2);
      ctx2d.strokeStyle = "hsla(" + bgHue + ",90%,55%," + ringA + ")";
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
      for (let i = 0; i < 24; i++) {
        const ang = i / 24 * Math.PI * 2 + time * 0.01;
        const rr = ringR + Math.sin(time * 0.05 + i * 2) * 6;
        const x = W / 2 + Math.cos(ang) * rr, y = H / 2 + Math.sin(ang) * rr;
        ctx2d.beginPath();
        ctx2d.arc(x, y, 2 + Math.sin(time * 0.1 + i) * 1.5, 0, Math.PI * 2);
        ctx2d.fillStyle = "hsla(" + (bgHue + 20) + ",90%,60%," + ringA + ")";
        ctx2d.fill();
      }
      // a részecskék
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.r * breathScale, 0, Math.PI * 2);
        ctx2d.fillStyle = "hsla(" + p.hue + ",80%,65%," + p.a + ")";
        ctx2d.fill();
      }
      // a meditáló alak
      const fy = H / 2 + ringR * 0.4, figH = ringR * 0.9;
      ctx2d.beginPath();
      ctx2d.arc(W / 2, fy - figH * 0.35, figH * 0.12, 0, Math.PI * 2);
      ctx2d.fillStyle = stage >= 4 ? "hsla(45,90%,70%,0.9)" : "hsla(" + bgHue + ",40%,50%,0.8)";
      ctx2d.fill();
      if (stage >= 7) {
        ctx2d.beginPath();
        ctx2d.arc(W / 2, fy - figH * 0.35, figH * 0.2 + Math.sin(time * 0.05) * 4, 0, Math.PI * 2);
        ctx2d.strokeStyle = "hsla(45,90%,75%,0.6)";
        ctx2d.lineWidth = 2; ctx2d.stroke();
      }
      ctx2d.beginPath();
      ctx2d.moveTo(W / 2 - figH * 0.18, fy - figH * 0.25);
      ctx2d.quadraticCurveTo(W / 2, fy + figH * 0.1, W / 2 + figH * 0.18, fy - figH * 0.25);
      ctx2d.fillStyle = stage >= 4 ? "hsla(45,70%,60%,0.5)" : "hsla(" + bgHue + ",30%,35%,0.5)";
      ctx2d.fill();
      ctx2d.beginPath();
      ctx2d.arc(W / 2, fy + figH * 0.15, figH * 0.16, Math.PI, 0);
      ctx2d.strokeStyle = stage >= 4 ? "hsla(45,70%,60%,0.5)" : "hsla(" + bgHue + ",30%,35%,0.5)";
      ctx2d.lineWidth = 3; ctx2d.stroke();
    }
  }

  function setPoints(pts) { points = pts; }
  function isGPU() { return useGPU; }

  /* ── Kagyu-fa: a 17 Karmapa vonala felhő-fákként ── */
  var KAGYU = [
    "Vajradhara","Tilopa","Naropa","Marpa","Milarepa","Gampopa",
    "Düsum Khyenpa","Karma Pakshi","Rangjung Dorje","Rolpe Dorje",
    "Deshin Shekpa","Thongwa Dönden","Chödrak Gyatso","Mikyö Dorje",
    "Wangchuk Dorje","Chöying Dorje","Yeshe Dorje","Changchub Dorje",
    "Düdul Dorje","Thekchok Dorje","Khakyab Dorje","Rangjung Rigpe Dorje",
    "Ogyen Trinley Dorje"
  ];
  function drawKagyuTree(time, stage) {
    // a fa a bal felső sarokban nő, a felhők a gyökerekből
    var baseX = W * 0.12, baseY = H * 0.88;
    var trunkH = Math.min(H, W) * 0.18;
    var count = KAGYU.length;
    for (var i = 0; i < count; i++) {
      var t = i / (count - 1);
      var y = baseY - trunkH * t;
      var spread = Math.sin(t * Math.PI) * W * 0.18;
      var x = baseX + Math.sin(t * 3.1 + time * 0.001) * spread * 0.5;
      // a felhő (a Karmapa feje)
      var cloudR = 4 + t * 10 + Math.sin(time * 0.01 + i) * 1.5;
      var alpha = 0.25 + t * 0.5;
      ctx2d.beginPath();
      ctx2d.arc(x, y, cloudR, 0, Math.PI * 2);
      ctx2d.fillStyle = "hsla(" + (bgHue + 20) + ",60%,70%," + alpha + ")";
      ctx2d.fill();
      // a törzs (a vonal)
      if (i > 0) {
        var py = baseY - trunkH * ((i - 1) / (count - 1));
        var px = baseX + Math.sin((i - 1) / (count - 1) * 3.1 + time * 0.001) * Math.sin((i - 1) / (count - 1) * Math.PI) * W * 0.18 * 0.5;
        ctx2d.beginPath();
        ctx2d.moveTo(px, py);
        ctx2d.lineTo(x, y);
        ctx2d.strokeStyle = "hsla(" + (bgHue + 10) + ",40%,50%,0.3)";
        ctx2d.lineWidth = 1;
        ctx2d.stroke();
      }
      // a név (a megvilágosodásnál fényesebb)
      if (stage >= 7 && i % 4 === 0) {
        ctx2d.font = "7px 'SF Mono',monospace";
        ctx2d.fillStyle = "hsla(45,90%,75%,0.5)";
        ctx2d.fillText(KAGYU[i], x + cloudR + 3, y + 3);
      }
    }
  }

  /* ── Zen-kert alap: a homok-körök és a kavicsok ── */
  function drawZenGarden(time, stage) {
    // a homok-körök a középpont körül
    var cx = W / 2, cy = H / 2;
    var maxR = Math.min(W, H) * 0.46;
    for (var i = 0; i < 6; i++) {
      var r = maxR * (0.3 + i * 0.12);
      var wobble = Math.sin(time * 0.002 + i) * 2;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r + wobble, 0, Math.PI * 2);
      ctx2d.strokeStyle = "hsla(" + bgHue + ",30%,45%,0.12)";
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    }
    // a kavicsok (a részecskék a homokon)
    for (var p = 0; p < points.length && p < 40; p++) {
      var pt = points[p];
      ctx2d.beginPath();
      ctx2d.arc(pt.x, pt.y, 1.2, 0, Math.PI * 2);
      ctx2d.fillStyle = "hsla(" + pt.hue + ",40%,60%,0.4)";
      ctx2d.fill();
    }
  }

  /* ── Buddha-formák: Mahakala (jobb felső) + Csenrezig (bal felső) ──
     forma (sziluett) · alak (a mandala) · sugárzás (aura) · fény (a ragyogás)
     A mantrák: Mahakala 0.21, Csenrezig 0.17 — a formák mellett szólnak. */
  var mahakalaAudio = null, chenrezigAudio = null, buddhaAudioStarted = false;
  function startBuddhaAudio() {
    if (buddhaAudioStarted) return;
    buddhaAudioStarted = true;
    try {
      mahakalaAudio = new Audio("audio/mahakala-mantra.mp3");
      mahakalaAudio.loop = true; mahakalaAudio.volume = 0.21;
      mahakalaAudio.play().catch(function(){});
      chenrezigAudio = new Audio("audio/chenrezig-mantra.mp3");
      chenrezigAudio.loop = true; chenrezigAudio.volume = 0.17;
      chenrezigAudio.play().catch(function(){});
    } catch (e) { /* a hang nem kritikus */ }
  }
  function stopBuddhaAudio() {
    buddhaAudioStarted = false;
    if (mahakalaAudio) { mahakalaAudio.pause(); mahakalaAudio = null; }
    if (chenrezigAudio) { chenrezigAudio.pause(); chenrezigAudio = null; }
  }
  function drawBuddhaForms(time, stage) {
    startBuddhaAudio();
    var cx = W / 2, cy = H / 2;
    var pulse = 0.5 + 0.5 * Math.sin(time * 0.01);
    var size = Math.min(W, H) * 0.16;

    /* ── MAHAKALA — a dühös védelmező, a tűzgyűrű ── (jobb felső) */
    var mx = W - size * 1.1, my = size * 1.1;
    // sugárzás: a tűz-aura
    var aura = ctx2d.createRadialGradient(mx, my, 0, mx, my, size * 1.6);
    aura.addColorStop(0, "hsla(20,95%,55%,0.28)");
    aura.addColorStop(0.6, "hsla(15,90%,40%,0.10)");
    aura.addColorStop(1, "hsla(15,90%,30%,0)");
    ctx2d.fillStyle = aura;
    ctx2d.beginPath();
    ctx2d.arc(mx, my, size * 1.6, 0, Math.PI * 2);
    ctx2d.fill();
    // a tűzgyűrű (a Mahakala jelképe)
    ctx2d.beginPath();
    ctx2d.arc(mx, my, size * 1.15, 0, Math.PI * 2);
    ctx2d.strokeStyle = "hsla(20,95%,60%," + (0.5 + pulse * 0.3) + ")";
    ctx2d.lineWidth = 2.5;
    ctx2d.stroke();
    // a gyűrű lángjai
    for (var i = 0; i < 16; i++) {
      var ang = i / 16 * Math.PI * 2 + time * 0.02;
      var rr = size * 1.15 + Math.sin(time * 0.05 + i * 2) * 4;
      var lx = mx + Math.cos(ang) * rr, ly = my + Math.sin(ang) * rr;
      ctx2d.beginPath();
      ctx2d.arc(lx, ly, 2 + Math.sin(time * 0.1 + i) * 1.2, 0, Math.PI * 2);
      ctx2d.fillStyle = "hsla(25,95%,60%," + (0.5 + pulse * 0.3) + ")";
      ctx2d.fill();
    }
    // a forma: a dühös alak (a fej + a korona + a test)
    ctx2d.beginPath();
    ctx2d.arc(mx, my - size * 0.2, size * 0.22, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(25,60%,35%,0.9)";
    ctx2d.fill();
    // a korona (az öt koponya)
    for (var c = 0; c < 5; c++) {
      var ca = -Math.PI / 2 + (c - 2) * 0.5;
      var cr = size * 0.3;
      ctx2d.beginPath();
      ctx2d.arc(mx + Math.cos(ca) * cr, my - size * 0.2 + Math.sin(ca) * cr, 3, 0, Math.PI * 2);
      ctx2d.fillStyle = "hsla(40,60%,80%,0.8)";
      ctx2d.fill();
    }
    // a test (a tűzben álló)
    ctx2d.beginPath();
    ctx2d.moveTo(mx - size * 0.25, my + size * 0.5);
    ctx2d.quadraticCurveTo(mx, my + size * 0.1, mx + size * 0.25, my + size * 0.5);
    ctx2d.fillStyle = "hsla(25,60%,30%,0.7)";
    ctx2d.fill();
    // a fény: a szemek (a dühös tekintet)
    ctx2d.beginPath();
    ctx2d.arc(mx - size * 0.09, my - size * 0.24, 2.5, 0, Math.PI * 2);
    ctx2d.arc(mx + size * 0.09, my - size * 0.24, 2.5, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(45,100%,75%,0.95)";
    ctx2d.fill();

    /* ── CSENREZIG — Avalokiteśvara, az együttérzés ── (bal felső) */
    var ax = size * 1.1, ay = size * 1.1;
    // sugárzás: a fehér-fény aura
    var aaura = ctx2d.createRadialGradient(ax, ay, 0, ax, ay, size * 1.6);
    aaura.addColorStop(0, "hsla(210,80%,85%,0.30)");
    aaura.addColorStop(0.6, "hsla(210,70%,70%,0.12)");
    aaura.addColorStop(1, "hsla(210,70%,60%,0)");
    ctx2d.fillStyle = aaura;
    ctx2d.beginPath();
    ctx2d.arc(ax, ay, size * 1.6, 0, Math.PI * 2);
    ctx2d.fill();
    // a halo (a megvilágosodás fénye)
    ctx2d.beginPath();
    ctx2d.arc(ax, ay - size * 0.2, size * 0.3 + pulse * 4, 0, Math.PI * 2);
    ctx2d.strokeStyle = "hsla(210,90%,85%," + (0.4 + pulse * 0.3) + ")";
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
    // a forma: a békés alak (a fej + a korona + a test)
    ctx2d.beginPath();
    ctx2d.arc(ax, ay - size * 0.2, size * 0.2, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(210,40%,90%,0.9)";
    ctx2d.fill();
    // a korona (a meditációs Buddha)
    ctx2d.beginPath();
    ctx2d.arc(ax, ay - size * 0.42, size * 0.09, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(210,60%,85%,0.8)";
    ctx2d.fill();
    // a test (a meditáló, keresztbe tett lábakkal)
    ctx2d.beginPath();
    ctx2d.moveTo(ax - size * 0.22, ay + size * 0.45);
    ctx2d.quadraticCurveTo(ax, ay + size * 0.05, ax + size * 0.22, ay + size * 0.45);
    ctx2d.fillStyle = "hsla(210,40%,85%,0.7)";
    ctx2d.fill();
    // a keresztbe tett lábak
    ctx2d.beginPath();
    ctx2d.arc(ax, ay + size * 0.42, size * 0.14, Math.PI, 0);
    ctx2d.strokeStyle = "hsla(210,40%,85%,0.7)";
    ctx2d.lineWidth = 3;
    ctx2d.stroke();
    // a fény: a szív (az együttérzés) és a szemek
    ctx2d.beginPath();
    ctx2d.arc(ax - size * 0.08, ay - size * 0.24, 2, 0, Math.PI * 2);
    ctx2d.arc(ax + size * 0.08, ay - size * 0.24, 2, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(210,100%,95%,0.95)";
    ctx2d.fill();
    // a szív-fény a mellkasban
    ctx2d.beginPath();
    ctx2d.arc(ax, ay + size * 0.1, 3 + pulse * 2, 0, Math.PI * 2);
    ctx2d.fillStyle = "hsla(340,80%,80%,0.7)";
    ctx2d.fill();
  }

  window.__dreamRenderer = { initGPU, render, setPoints, isGPU, resize, drawKagyuTree, drawZenGarden, drawBuddhaForms, startBuddhaAudio, stopBuddhaAudio };
})();
