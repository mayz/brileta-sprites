/** RGB color, each channel 0-255. */
export type Color = [number, number, number];

/** Three-tone palette: shadow, mid, highlight. */
export type Palette3 = [Color, Color, Color];

/** RGBA color, each channel 0-255. */
export type RGBA = [number, number, number, number];

/**
 * Row-major RGBA pixel buffer.
 * Stride = width * 4. Pixel (x, y) starts at offset (y * width + x) * 4.
 */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  getPixel(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const i = (y * this.width + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
}
