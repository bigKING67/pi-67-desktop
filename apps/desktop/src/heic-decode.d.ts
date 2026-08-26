declare module "heic-decode" {
  export interface DecodedHeicImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  export interface DeferredHeicImage {
    width: number;
    height: number;
    decode(): Promise<DecodedHeicImage>;
  }

  export interface DeferredHeicImages extends Array<DeferredHeicImage> {
    dispose(): void;
  }

  interface HeicDecode {
    (input: { buffer: Uint8Array }): Promise<DecodedHeicImage>;
    all(input: { buffer: Uint8Array }): Promise<DeferredHeicImages>;
  }

  const decode: HeicDecode;
  export default decode;
}
