// build-wasm.js — compile ternary.wat to ternary.wasm using wabt
const path = require('path');
const wabt = require(path.join('/tmp', 'node_modules', 'wabt'));
const fs = require('fs');

wabt().then(w => {
  const wat = fs.readFileSync(path.join(__dirname, 'wasm', 'ternary.wat'), 'utf8');
  const mod = w.parseWat('ternary.wat', wat);
  const bin = mod.toBinary({ log: false });
  fs.writeFileSync(path.join(__dirname, 'wasm', 'ternary.wasm'), Buffer.from(bin.buffer));
  console.log('WASM OK, bytes:', bin.buffer.length);
  // test exports
  return WebAssembly.instantiate(bin.buffer);
}).then(r => {
  const m = r.instance.exports;
  console.log('seed(1) =', m.seed(1));
  const mem = new Int32Array(m.memory.buffer);
  const wp = 0, ip = 16;
  mem[wp/4]=1; mem[wp/4+1]=-1; mem[wp/4+2]=0; mem[wp/4+3]=1;
  mem[ip/4]=1; mem[ip/4+1]=1; mem[ip/4+2]=1; mem[ip/4+3]=-1;
  console.log('ternary_dot =', m.ternary_dot(wp, ip, 4), '(expect -1)');
  console.log('ultra(-5)=', m.ultra(-5), 'ultra(0)=', m.ultra(0), 'ultra(7)=', m.ultra(7));
  console.log('particle_step(1,2,1,-1,0,1,3) =', m.particle_step(1,2,1,-1,0,1,3));
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
