/** xoshiro128++ PRNG with SplitMix64 seeding. */
export class Rng {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);

    // SplitMix64 state expansion (64-bit arithmetic via BigInt).
    let sm = BigInt(seed >>> 0) & 0xFFFFFFFFFFFFFFFFn;

    const splitmix64 = (): bigint => {
      sm = (sm + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
      let z = sm;
      z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
      z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
      return (z ^ (z >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
    };

    const a = splitmix64();
    const b = splitmix64();

    this.s[0] = Number(a & 0xFFFFFFFFn);
    this.s[1] = Number((a >> 32n) & 0xFFFFFFFFn);
    this.s[2] = Number(b & 0xFFFFFFFFn);
    this.s[3] = Number((b >> 32n) & 0xFFFFFFFFn);

    // xoshiro cannot run with an all-zero state.
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) {
      this.s[0] = 0x9E3779B9;
      this.s[1] = 0x243F6A88;
      this.s[2] = 0xB7E15162;
      this.s[3] = 0x8AED2A6B;
    }
  }

  /** Return the next uint32 from the xoshiro128++ stream. */
  nextU32(): number {
    const s = this.s;

    // result = rotl32(s[0] + s[3], 7) + s[0]
    const sum03 = (s[0] + s[3]) >>> 0;
    const rotated = ((sum03 << 7) | (sum03 >>> 25)) >>> 0;
    const result = (rotated + s[0]) >>> 0;

    const t = (s[1] << 9) >>> 0;

    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;

    s[2] = (s[2] ^ t) >>> 0;
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0;

    return result;
  }

  /** Uniform float in [0, 1) using the 53-bit mantissa technique. */
  nextFloat(): number {
    const hi = this.nextU32() >>> 5;  // 27 bits
    const lo = this.nextU32() >>> 6;  // 26 bits
    const mantissa = hi * 67108864 + lo;  // hi << 26 | lo, as Number
    return mantissa * (1.0 / 9007199254740992.0);  // * 2^-53
  }

  /** Uniform float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return Math.min(Math.floor(min + this.nextFloat() * (max - min + 1)), max);
  }

  /** Deterministic spatial hash for position-keyed seeds. */
  static deriveSpatialSeed(x: number, y: number, mapSeed: number, salt: number): number {
    return (
      (Math.imul(x | 0, 73856093) ^
       Math.imul(y | 0, 19349663) ^
       (mapSeed | 0) ^
       (salt | 0)) >>> 0
    );
  }
}
