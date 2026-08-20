;; dream.vaked.dev — ternary-quant core (BitNet b1.58 {-1,0,+1})
;; A techno-zen-buddhism vizuális magja: a részecskék és a mandala
;; {-1,0,+1} súlyokkal kvantált pontszorzáson keresztül mozognak.
;; Exportok:
;;   seed(state) -> next LCG state
;;   ternary_dot(weights_ptr, inputs_ptr, n) -> i32  (sum of {-1,0,+1} products)
;;   ultra(x) -> {-1,0,+1}  (b1.58 hard activation)
;;   particle_step(px, py, w0, w1, w2, w3, t) -> packed (new_x, new_y) as i32
(module
  (memory (export "memory") 1)

  ;; LCG: state = state * 1664525 + 1013904223 (mod 2^32)
  (func (export "seed") (param $s i32) (result i32)
    (i32.add
      (i32.mul (local.get $s) (i32.const 1664525))
      (i32.const 1013904223)))

  ;; ternary_dot(weights_ptr, inputs_ptr, n)
  ;; mindkét tömb {-1,0,+1} értékeket tartalmaz 8 bitesen (i32 store)
  (func (export "ternary_dot") (param $wp i32) (param $ip i32) (param $n i32) (result i32)
    (local $i i32) (local $sum i32) (local $w i32) (local $x i32)
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $w (i32.load (i32.add (local.get $wp) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $x (i32.load (i32.add (local.get $ip) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $sum (i32.add (local.get $sum) (i32.mul (local.get $w) (local.get $x))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
    (local.get $sum))

  ;; ultra(x): b1.58 hard activation -> {-1,0,+1}
  (func $ultra (export "ultra") (param $x i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $x) (i32.const 0))
      (then (i32.const -1))
      (else (if (result i32) (i32.gt_s (local.get $x) (i32.const 0))
        (then (i32.const 1))
        (else (i32.const 0))))))

  ;; particle_step(px, py, w0, w1, w2, w3, t) -> packed i32 (x<<16 | y)
  ;; A részecske a {-1,0,+1} súlyokkal kvantált mezőben mozog.
  ;; x' = ultra(px + w0*t + w1), y' = ultra(py + w2*t + w3)
  (func (export "particle_step") (param $px i32) (param $py i32)
    (param $w0 i32) (param $w1 i32) (param $w2 i32) (param $w3 i32) (param $t i32)
    (result i32)
    (local $nx i32) (local $ny i32)
    (local.set $nx (call $ultra
      (i32.add (local.get $px) (i32.add (i32.mul (local.get $w0) (local.get $t)) (local.get $w1)))))
    (local.set $ny (call $ultra
      (i32.add (local.get $py) (i32.add (i32.mul (local.get $w2) (local.get $t)) (local.get $w3)))))
    (i32.or (i32.shl (i32.and (local.get $nx) (i32.const 0xffff)) (i32.const 16))
            (i32.and (local.get $ny) (i32.const 0xffff))))
)
