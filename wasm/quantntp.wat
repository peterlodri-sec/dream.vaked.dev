;; quantNTP — the constellation's own time sync (search.vaked.dev)
;; A ternary-quant NTP client: the network offset is measured, filtered,
;; and quantized into balanced ternary {-1,0,+1} trits — the quant of the
;; moment, the stratum of the now.
;; Exportok:
;;   ntp_offset(t1, t2, t3, t4) -> i32  (the clock offset in ms, as i32)
;;   ntp_filter(ptr, n)          -> i32  (median of n samples at ptr)
;;   ntp_quantize(offset)        -> i32  (balanced ternary trit of the offset)
;;   ntp_stratum(offset)         -> i32  (the stratum of the now: 0..3)
;;   ntp_trits(offset, ptr)      -> void (writes 12 {-1,0,+1} trits to ptr)
(module
  (memory (export "memory") 1)

  ;; ntp_offset(t1, t2, t3, t4) -> (t2 - t1) - (t4 - t3), halved.
  ;; The classic NTP offset: ((T2 - T1) + (T3 - T4)) / 2, in ms.
  (func (export "ntp_offset") (param $t1 i32) (param $t2 i32) (param $t3 i32) (param $t4 i32) (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (i32.sub (local.get $t2) (local.get $t1)))
    (local.set $b (i32.sub (local.get $t3) (local.get $t4)))
    (i32.div_s (i32.add (local.get $a) (local.get $b)) (i32.const 2)))

  ;; ntp_filter(ptr, n) — the median of n i32 samples at ptr.
  ;; The NTP clock filter: the median of the last n offsets is trusted.
  ;; A tiny insertion sort on the buffer, then the middle element.
  (func (export "ntp_filter") (param $ptr i32) (param $n i32) (result i32)
    (local $i i32) (local $j i32) (local $v i32) (local $k i32)
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $v (i32.load (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $j (local.get $i))
        (block $inner
          (loop $innerloop
            (br_if $inner (i32.eqz (local.get $j)))
            (local.set $k (i32.load (i32.add (local.get $ptr) (i32.mul (i32.sub (local.get $j) (i32.const 1)) (i32.const 4)))))
            (br_if $inner (i32.le_s (local.get $k) (local.get $v)))
            (i32.store (i32.add (local.get $ptr) (i32.mul (local.get $j) (i32.const 4))) (local.get $k))
            (local.set $j (i32.sub (local.get $j) (i32.const 1)))
            (br $innerloop)))
        (i32.store (i32.add (local.get $ptr) (i32.mul (local.get $j) (i32.const 4))) (local.get $v))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer)))
    (i32.load (i32.add (local.get $ptr) (i32.mul (i32.div_u (local.get $n) (i32.const 2)) (i32.const 4)))))

  ;; ntp_quantize(offset) — the balanced ternary trit of the offset:
  ;;   < -1 ms  -> -1 (the now runs behind)
  ;;   -1..1 ms -> 0  (the now is centered)
  ;;   > 1 ms   -> +1 (the now runs ahead)
  (func (export "ntp_quantize") (param $offset i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $offset) (i32.const -1))
      (then (i32.const -1))
      (else (if (result i32) (i32.gt_s (local.get $offset) (i32.const 1))
        (then (i32.const 1))
        (else (i32.const 0))))))

  ;; ntp_stratum(offset) — the stratum of the now:
  ;;   0: the offset is centered (|offset| <= 1 ms)  — the now is exact
  ;;   1: |offset| <= 10 ms   — the now is near
  ;;   2: |offset| <= 100 ms  — the now is drifting
  ;;   3: otherwise           — the now is far
  (func (export "ntp_stratum") (param $offset i32) (result i32)
    (local $a i32)
    (local.set $a (local.get $offset))
    (if (i32.lt_s (local.get $a) (i32.const 0))
      (then (local.set $a (i32.sub (i32.const 0) (local.get $a)))))
    (if (result i32) (i32.le_s (local.get $a) (i32.const 1))
      (then (i32.const 0))
      (else (if (result i32) (i32.le_s (local.get $a) (i32.const 10))
        (then (i32.const 1))
        (else (if (result i32) (i32.le_s (local.get $a) (i32.const 100))
          (then (i32.const 2))
          (else (i32.const 3))))))))

  ;; ntp_trits(offset, ptr) — writes 12 balanced ternary trits of the
  ;; offset (the quant of the moment) to ptr as i32 {-1,0,+1} values.
  (func (export "ntp_trits") (param $offset i32) (param $ptr i32)
    (local $i i32) (local $x i32) (local $r i32) (local $d i32)
    (local.set $x (local.get $offset))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (i32.const 12)))
        (local.set $r (i32.rem_s (local.get $x) (i32.const 3)))
        (if (i32.eq (local.get $r) (i32.const 2))
          (then
            (local.set $d (i32.const -1))
            (local.set $x (i32.div_s (i32.add (local.get $x) (i32.const 1)) (i32.const 3))))
          (else (if (i32.eq (local.get $r) (i32.const -2))
            (then
              (local.set $d (i32.const 1))
              (local.set $x (i32.div_s (i32.sub (local.get $x) (i32.const 1)) (i32.const 3))))
            (else
              (local.set $d (local.get $r))
              (local.set $x (i32.div_s (i32.sub (local.get $x) (local.get $r)) (i32.const 3)))))))
        (i32.store (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4))) (local.get $d))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
))
