/* dream.vaked.dev — particle worker
   A ternary-quant WASM magot futtatja: a részecskék {-1,0,+1} súlyokkal
   kvantált mezőben mozognak. A főszál csak a pozíciókat kapja. */
"use strict";

let wasm = null;      // WebAssembly.Instance
let mem = null;       // Int32Array view of wasm memory
let particles = [];   // [{x, y, w0, w1, w2, w3, hue, r, a}]
let seedState = 1;
let running = false;

function lcg() {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}

self.onmessage = function (e) {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      const count = msg.count || 160;
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: lcg(), y: lcg(),
          w0: Math.floor(lcg() * 3) - 1,   // {-1,0,+1}
          w1: Math.floor(lcg() * 3) - 1,
          w2: Math.floor(lcg() * 3) - 1,
          w3: Math.floor(lcg() * 3) - 1,
          hue: Math.floor(lcg() * 40) + 10,
          r: lcg() * 2 + 0.5,
          a: lcg() * 0.5 + 0.2
        });
      }
      running = true;
      self.postMessage({ type: "ready", count });
      break;
    }
    case "load_wasm": {
      // msg.wasm: ArrayBuffer
      WebAssembly.instantiate(msg.wasm, {}).then(function (res) {
        wasm = res.instance;
        mem = new Int32Array(wasm.exports.memory.buffer);
        self.postMessage({ type: "wasm_ready" });
      }).catch(function (err) {
        self.postMessage({ type: "wasm_error", error: String(err) });
      });
      break;
    }
    case "step": {
      if (!running || !wasm) { self.postMessage({ type: "frame", points: [] }); return; }
      const t = msg.t | 0;
      const stage = msg.stage | 0;
      const W = msg.W, H = msg.H;
      const points = new Array(particles.length);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // WASM particle_step: kvantált mozgás
        const packed = wasm.exports.particle_step(
          (p.x * 65535) | 0, (p.y * 65535) | 0,
          p.w0, p.w1, p.w2, p.w3, t + i
        );
        let nx = (packed >>> 16) / 65535;
        let ny = (packed & 0xffff) / 65535;
        // a megvilágosodásnál felfelé szállnak (a szivárvány-test)
        if (stage >= 7) ny -= 0.004;
        // drift + enyhe visszahúzás a középre
        nx = (nx + (0.5 - nx) * 0.01 + (lcg() - 0.5) * 0.01) % 1;
        ny = (ny + (0.5 - ny) * 0.01 + (lcg() - 0.5) * 0.01) % 1;
        if (nx < 0) nx += 1; if (ny < 0) ny += 1;
        p.x = nx; p.y = ny;
        points[i] = {
          x: nx * W, y: ny * H,
          r: p.r * (0.8 + 0.6 * Math.abs(Math.sin(t * 0.02 + i))),
          hue: (p.hue + stage * 5) % 360,
          a: p.a * (0.5 + 0.5 * Math.sin(t * 0.02 + i))
        };
      }
      self.postMessage({ type: "frame", points }, []);
      break;
    }
    case "stop": running = false; break;
    case "start": running = true; break;
  }
};
