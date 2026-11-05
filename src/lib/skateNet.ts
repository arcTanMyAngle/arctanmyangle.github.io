// Skate Lab policy network: a small tanh MLP whose output is a masked softmax over the eight foot actions. Written by
// hand (forward, backward, Adam, int8 checkpoints) on Float32Array so it runs the same in Bun, a Worker and the page,
// with no dependencies. Pure; every random draw comes from the seeded `rng` passed in.
import { rng as makeRng } from "./gameShell";

export interface Net {
  /** Layer widths, input first: [21, 64, 64, 8]. */
  sizes: number[];
  /** W[l] is sizes[l+1] × sizes[l], row-major (row = output unit). */
  W: Float32Array[];
  b: Float32Array[];
}

/** Activations kept from a forward pass, for the backward pass. */
export interface Cache {
  /** a[0] is the input; a[l] the tanh output of layer l; the last entry holds the probabilities. */
  a: Float32Array[];
  mask: Uint8Array;
}

export interface Grad {
  W: Float32Array[];
  b: Float32Array[];
}

export function createNet(sizes: number[], seed: number): Net {
  const r = makeRng(seed);
  const W: Float32Array[] = [];
  const b: Float32Array[] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l];
    const nOut = sizes[l + 1];
    // Glorot-uniform for tanh; the last layer starts small so the first policy is close to uniform over legal moves
    const last = l === sizes.length - 2;
    const lim = Math.sqrt(6 / (nIn + nOut)) * (last ? 0.1 : 1);
    const w = new Float32Array(nIn * nOut);
    for (let i = 0; i < w.length; i++) w[i] = (2 * r() - 1) * lim;
    W.push(w);
    b.push(new Float32Array(nOut));
  }
  return { sizes: sizes.slice(), W, b };
}

export function cloneNet(net: Net): Net {
  return { sizes: net.sizes.slice(), W: net.W.map((w) => w.slice()), b: net.b.map((x) => x.slice()) };
}

export function paramCount(net: Net) {
  let n = 0;
  for (let l = 0; l < net.W.length; l++) n += net.W[l].length + net.b[l].length;
  return n;
}

export function newCache(net: Net): Cache {
  return { a: net.sizes.map((n) => new Float32Array(n)), mask: new Uint8Array(net.sizes[net.sizes.length - 1]) };
}

export function zeroGrad(net: Net): Grad {
  return { W: net.W.map((w) => new Float32Array(w.length)), b: net.b.map((x) => new Float32Array(x.length)) };
}

export function clearGrad(g: Grad) {
  for (const w of g.W) w.fill(0);
  for (const x of g.b) x.fill(0);
}

/**
 * Forward pass. Returns the masked softmax probabilities (illegal actions get exactly 0), written into the cache's
 * last activation. `temperature` divides the logits.
 */
export function forward(net: Net, x: Float32Array, mask: Uint8Array, cache: Cache, temperature = 1): Float32Array {
  const L = net.W.length;
  cache.a[0].set(x);
  cache.mask.set(mask);
  for (let l = 0; l < L; l++) {
    const nIn = net.sizes[l];
    const nOut = net.sizes[l + 1];
    const w = net.W[l];
    const bias = net.b[l];
    const inp = cache.a[l];
    const out = cache.a[l + 1];
    for (let j = 0; j < nOut; j++) {
      let s = bias[j];
      const row = j * nIn;
      for (let i = 0; i < nIn; i++) s += w[row + i] * inp[i];
      out[j] = l < L - 1 ? Math.tanh(s) : s;
    }
  }
  const z = cache.a[L];
  let max = -Infinity;
  for (let j = 0; j < z.length; j++) if (mask[j] && z[j] > max) max = z[j];
  let sum = 0;
  for (let j = 0; j < z.length; j++) {
    const e = mask[j] ? Math.exp((z[j] - max) / temperature) : 0;
    z[j] = e;
    sum += e;
  }
  for (let j = 0; j < z.length; j++) z[j] /= sum;
  return z;
}

/**
 * Backward pass from dL/dlogits (`dz`, length = actions), accumulated into `g` scaled by `scale`. The cache must be
 * from the forward pass of the same input. `tmp` buffers are reused to avoid allocation in the hot loop.
 */
export function backward(net: Net, cache: Cache, dz: Float32Array, g: Grad, scale = 1, tmp: Float32Array[] = makeTmp(net)) {
  const L = net.W.length;
  let delta = tmp[L];
  for (let j = 0; j < dz.length; j++) delta[j] = cache.mask[j] ? dz[j] * scale : 0;
  for (let l = L - 1; l >= 0; l--) {
    const nIn = net.sizes[l];
    const nOut = net.sizes[l + 1];
    const w = net.W[l];
    const gw = g.W[l];
    const gb = g.b[l];
    const inp = cache.a[l];
    const prev = tmp[l];
    if (l > 0) prev.fill(0);
    for (let j = 0; j < nOut; j++) {
      const d = delta[j];
      if (d === 0) continue;
      gb[j] += d;
      const row = j * nIn;
      for (let i = 0; i < nIn; i++) {
        gw[row + i] += d * inp[i];
        if (l > 0) prev[i] += d * w[row + i];
      }
    }
    if (l > 0) {
      // tanh' = 1 − a²
      for (let i = 0; i < nIn; i++) prev[i] *= 1 - inp[i] * inp[i];
      delta = prev;
    }
  }
}

export function makeTmp(net: Net) {
  return net.sizes.map((n) => new Float32Array(n));
}

/** dL/dlogits of −log p(a) for a masked softmax is p − onehot(a); this writes coef·(onehot(a) − p) instead. */
export function dLogProb(p: Float32Array, a: number, coef: number, out: Float32Array) {
  for (let j = 0; j < p.length; j++) out[j] = coef * ((j === a ? 1 : 0) - p[j]);
  return out;
}

/** Entropy (nats) of a probability vector. */
export function entropy(p: Float32Array) {
  let h = 0;
  for (let j = 0; j < p.length; j++) if (p[j] > 0) h -= p[j] * Math.log(p[j]);
  return h;
}

export function argmax(p: Float32Array) {
  let best = 0;
  for (let j = 1; j < p.length; j++) if (p[j] > p[best]) best = j;
  return best;
}

/** Draw an index from `p` with a uniform number u in [0, 1). */
export function sampleIndex(p: Float32Array, u: number) {
  let acc = 0;
  let last = 0;
  for (let j = 0; j < p.length; j++) {
    if (p[j] <= 0) continue;
    acc += p[j];
    last = j;
    if (u < acc) return j;
  }
  return last;
}

export interface Adam {
  lr: number;
  b1: number;
  b2: number;
  eps: number;
  t: number;
  m: Grad;
  v: Grad;
}

export function createAdam(net: Net, lr = 3e-4, b1 = 0.9, b2 = 0.999, eps = 1e-8): Adam {
  return { lr, b1, b2, eps, t: 0, m: zeroGrad(net), v: zeroGrad(net) };
}

/** Global L2 norm of a gradient. */
export function gradNorm(g: Grad) {
  let s = 0;
  for (const w of g.W) for (let i = 0; i < w.length; i++) s += w[i] * w[i];
  for (const x of g.b) for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s);
}

/** One Adam step on the gradient of a loss to minimise, after clipping its global norm to `clip`. Returns the norm. */
export function adamStep(net: Net, g: Grad, opt: Adam, clip = 1) {
  const norm = gradNorm(g);
  const k = norm > clip ? clip / norm : 1;
  opt.t++;
  const c1 = 1 - Math.pow(opt.b1, opt.t);
  const c2 = 1 - Math.pow(opt.b2, opt.t);
  const upd = (p: Float32Array, gr: Float32Array, m: Float32Array, v: Float32Array) => {
    for (let i = 0; i < p.length; i++) {
      const gi = gr[i] * k;
      m[i] = opt.b1 * m[i] + (1 - opt.b1) * gi;
      v[i] = opt.b2 * v[i] + (1 - opt.b2) * gi * gi;
      p[i] -= (opt.lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + opt.eps);
    }
  };
  for (let l = 0; l < net.W.length; l++) {
    upd(net.W[l], g.W[l], opt.m.W[l], opt.v.W[l]);
    upd(net.b[l], g.b[l], opt.m.b[l], opt.v.b[l]);
  }
  return norm;
}

// Checkpoints: every tensor as int8 with one float scale (max |w| / 127), base64-encoded

export interface Int8Tensor {
  scale: number;
  q: string;
}

export interface Checkpoint {
  sizes: number[];
  W: Int8Tensor[];
  b: Int8Tensor[];
}

function quantise(x: Float32Array): Int8Tensor {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  const scale = max > 0 ? max / 127 : 1;
  const q = new Int8Array(x.length);
  for (let i = 0; i < x.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(x[i] / scale)));
  return { scale: Number(scale.toPrecision(8)), q: toBase64(new Uint8Array(q.buffer)) };
}

function dequantise(t: Int8Tensor, n: number): Float32Array {
  const q = new Int8Array(fromBase64(t.q).buffer);
  if (q.length !== n) throw new Error(`checkpoint tensor has ${q.length} values, expected ${n}`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = q[i] * t.scale;
  return out;
}

export function toCheckpoint(net: Net): Checkpoint {
  return { sizes: net.sizes.slice(), W: net.W.map(quantise), b: net.b.map(quantise) };
}

export function fromCheckpoint(c: Checkpoint): Net {
  const W: Float32Array[] = [];
  const b: Float32Array[] = [];
  for (let l = 0; l < c.sizes.length - 1; l++) {
    W.push(dequantise(c.W[l], c.sizes[l] * c.sizes[l + 1]));
    b.push(dequantise(c.b[l], c.sizes[l + 1]));
  }
  return { sizes: c.sizes.slice(), W, b };
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
