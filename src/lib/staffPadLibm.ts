// SPDX-License-Identifier: LGPL-2.1-or-later
// Copyright (C) 2018-2022 Free Software Foundation, Inc.
// Port of glibc 2.35 s_sinf.c, s_cosf.c, s_sincosf.h and sincosf_poly.h.
// The atanf/atan2f routines below retain their separate SunPro notice; see
// licenses/glibc-LGPL-2.1.txt and licenses/glibc-SunPro.txt.
// Audacity's Linux oracle calls these scalar routines through libm.

interface SincosTable {
  sign: readonly number[];
  c0: number; c1: number; c2: number; c3: number; c4: number;
  s1: number; s2: number; s3: number;
}
const HPI_INV = 10680707.430881744;
const HPI = 1.5707963267948966;
const PI63 = 3.4061215800865545e-19;
const PIO4 = Math.fround(0.7853981852531433);
const TABLE: readonly SincosTable[] = [
  { sign: [1, -1, -1, 1], c0: 1, c1: -0.49999999725108224, c2: 0.041666623324344516,
    c3: -0.001388676379437604, c4: 0.000024390450703564542,
    s1: -0.16666654943701084, s2: 0.008332178146138854, s3: -0.00019517298981385725 },
  { sign: [1, -1, -1, 1], c0: -1, c1: 0.49999999725108224, c2: -0.041666623324344516,
    c3: 0.001388676379437604, c4: -0.000024390450703564542,
    s1: -0.16666654943701084, s2: 0.008332178146138854, s3: -0.00019517298981385725 },
];
const INV_PIO4 = [
  0xa2, 0xa2f9, 0xa2f983, 0xa2f9836e, 0xf9836e4e, 0x836e4e44,
  0x6e4e4415, 0x4e441529, 0x441529fc, 0x1529fc27, 0x29fc2757, 0xfc2757d1,
  0x2757d1f5, 0x57d1f534, 0xd1f534dd, 0xf534ddc0, 0x34ddc0db, 0xddc0db62,
  0xc0db6295, 0xdb629599, 0x6295993c, 0x95993c43, 0x993c4390, 0x3c439041,
];
const storage = new ArrayBuffer(4);
const floats = new Float32Array(storage);
const words = new Uint32Array(storage);
const top12 = (value: number): number => {
  floats[0] = value;
  return (words[0] >>> 20) & 0x7ff;
};
const SMALL = top12(2 ** -12);
const LARGE = top12(120);
const QUARTER = top12(PIO4);
const INFINITE = top12(Infinity);
function poly(x: number, x2: number, p: SincosTable, n: number): number {
  if ((n & 1) === 0) {
    const x3 = x * x2;
    const s1 = p.s2 + x2 * p.s3;
    return Math.fround(x + x3 * p.s1 + x3 * x2 * s1);
  }
  const x4 = x2 * x2;
  const c2 = p.c3 + x2 * p.c4;
  const c1 = p.c0 + x2 * p.c1;
  return Math.fround(c1 + x4 * p.c2 + x4 * x2 * c2);
}
function reduceLarge(bits: number): { x: number; n: number } {
  const offset = (bits >>> 26) & 15;
  const shift = (bits >>> 23) & 7;
  const xi = ((bits & 0xffffff) | 0x800000) << shift;
  const mask = (value: bigint) => BigInt.asUintN(64, value);
  let res0 = BigInt(xi) * BigInt(INV_PIO4[offset]);
  const res1 = BigInt(xi) * BigInt(INV_PIO4[offset + 4]);
  const res2 = BigInt(xi) * BigInt(INV_PIO4[offset + 8]);
  res0 = mask((res2 >> 32n) | (res0 << 32n));
  res0 = mask(res0 + res1);
  const n = mask(res0 + (1n << 61n)) >> 62n;
  res0 = mask(res0 - (n << 62n));
  return { x: Number(BigInt.asIntN(64, res0)) * PI63, n: Number(n) };
}
function evaluate(value: number, cosine: boolean): number {
  const y = Math.fround(value);
  const absolute = top12(y);
  let x = y;
  if (absolute < QUARTER) {
    if (absolute < SMALL) return cosine ? 1 : y;
    return poly(x, x * x, TABLE[0], cosine ? 1 : 0);
  }
  let n: number;
  let sign: number;
  let table = TABLE[0];
  if (absolute < LARGE) {
    const r = x * HPI_INV;
    n = (Math.trunc(r) + 0x800000) >> 24;
    x -= n * HPI;
    sign = table.sign[n & 3];
  } else if (absolute < INFINITE) {
    floats[0] = y;
    const bits = words[0];
    const reduced = reduceLarge(bits);
    x = reduced.x;
    n = reduced.n;
    const quadrant = n + (bits >>> 31);
    sign = table.sign[quadrant & 3];
    if (quadrant & 2) table = TABLE[1];
    return poly(x * sign, x * x, table, n ^ (cosine ? 1 : 0));
  } else return NaN;
  if (n & 2) table = TABLE[1];
  return poly(x * sign, x * x, table, n ^ (cosine ? 1 : 0));
}
export function staffPadSinf(value: number): number { return evaluate(value, false); }
export function staffPadCosf(value: number): number { return evaluate(value, true); }

const fromWord = (word: number): number => {
  words[0] = word >>> 0;
  return floats[0];
};
const toWord = (value: number): number => {
  floats[0] = value;
  return words[0];
};
// atanf/atan2f portions:
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided that
// this notice is preserved.
const ATAN_HI = [0x3eed6338, 0x3f490fda, 0x3f7b985e, 0x3fc90fda].map(fromWord);
const ATAN_LO = [0x31ac3769, 0x33222168, 0x33140fb4, 0x33a22168].map(fromWord);
const AT = [0x3eaaaaab, 0xbe4ccccd, 0x3e124925, 0xbde38e38, 0x3dba2e6e,
  0xbd9d8795, 0x3d886b35, 0xbd6ef16b, 0x3d4bda59, 0xbd15a221, 0x3c8569d7].map(fromWord);
const f = Math.fround;
export function staffPadAtanf(value: number): number {
  let x = f(value);
  const hx = toWord(x) | 0;
  const ix = hx & 0x7fffffff;
  let id = -1;
  if (ix >= 0x4c000000) {
    if (ix > 0x7f800000) return f(x + x);
    return hx > 0 ? f(ATAN_HI[3] + ATAN_LO[3]) : f(-ATAN_HI[3] - ATAN_LO[3]);
  }
  if (ix < 0x3ee00000) {
    if (ix < 0x31000000) return x;
  } else {
    x = Math.abs(x);
    if (ix < 0x3f980000) {
      if (ix < 0x3f300000) {
        id = 0;
        x = f(f(f(2 * x) - 1) / f(2 + x));
      } else {
        id = 1;
        x = f(f(x - 1) / f(x + 1));
      }
    } else if (ix < 0x401c0000) {
      id = 2;
      x = f(f(x - 1.5) / f(1 + f(1.5 * x)));
    } else {
      id = 3;
      x = f(-1 / x);
    }
  }
  let z = f(x * x);
  const w = f(z * z);
  const odd = f(AT[8] + f(w * AT[10]));
  const odd2 = f(AT[6] + f(w * odd));
  const odd3 = f(AT[4] + f(w * odd2));
  const odd4 = f(AT[2] + f(w * odd3));
  const s1 = f(z * f(AT[0] + f(w * odd4)));
  const even = f(AT[7] + f(w * AT[9]));
  const even2 = f(AT[5] + f(w * even));
  const even3 = f(AT[3] + f(w * even2));
  const s2 = f(w * f(AT[1] + f(w * even3)));
  const sum = f(s1 + s2);
  if (id < 0) return f(x - f(x * sum));
  z = f(ATAN_HI[id] - f(f(f(x * sum) - ATAN_LO[id]) - x));
  return hx < 0 ? f(-z) : z;
}
const ATAN2_PI = fromWord(0x40490fdb);
const ATAN2_PI_LO = fromWord(0xb3bbbd2e);
const ATAN2_PI_O_2 = fromWord(0x3fc90fdb);
const ATAN2_PI_O_4 = fromWord(0x3f490fdb);
const ATAN2_TINY = f(1e-30);
export function staffPadAtan2f(yValue: number, xValue: number): number {
  const y = f(yValue);
  const x = f(xValue);
  const hx = toWord(x) | 0;
  const hy = toWord(y) | 0;
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if (ix > 0x7f800000 || iy > 0x7f800000) return f(x + y);
  if (hx === 0x3f800000) return staffPadAtanf(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if (iy === 0) {
    if (m < 2) return y;
    return m === 2 ? f(ATAN2_PI + ATAN2_TINY) : f(-ATAN2_PI - ATAN2_TINY);
  }
  if (ix === 0) return hy < 0 ? f(-ATAN2_PI_O_2 - ATAN2_TINY) : f(ATAN2_PI_O_2 + ATAN2_TINY);
  if (ix === 0x7f800000) {
    if (iy === 0x7f800000) {
      if (m === 0) return f(ATAN2_PI_O_4 + ATAN2_TINY);
      if (m === 1) return f(-ATAN2_PI_O_4 - ATAN2_TINY);
      return m === 2 ? f(f(3 * ATAN2_PI_O_4) + ATAN2_TINY) : f(f(-3 * ATAN2_PI_O_4) - ATAN2_TINY);
    }
    if (m === 0) return 0;
    if (m === 1) return -0;
    return m === 2 ? f(ATAN2_PI + ATAN2_TINY) : f(-ATAN2_PI - ATAN2_TINY);
  }
  if (iy === 0x7f800000) return hy < 0 ? f(-ATAN2_PI_O_2 - ATAN2_TINY) : f(ATAN2_PI_O_2 + ATAN2_TINY);
  const k = (iy - ix) >> 23;
  let z: number;
  if (k > 60) z = f(ATAN2_PI_O_2 + f(0.5 * ATAN2_PI_LO));
  else if (hx < 0 && k < -60) z = 0;
  else z = staffPadAtanf(Math.abs(f(y / x)));
  if (m === 0) return z;
  if (m === 1) return fromWord(toWord(z) ^ 0x80000000);
  if (m === 2) return f(ATAN2_PI - f(z - ATAN2_PI_LO));
  return f(f(z - ATAN2_PI_LO) - ATAN2_PI);
}
