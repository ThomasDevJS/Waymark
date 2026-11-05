/** The HD voice engine as the offscreen player sees it: the real model, or a stub in tests. */
export interface Audio {
  samples: Float32Array;
  sampleRate: number;
}

export interface HdEngine {
  /** Downloads and verifies the model files into the local cache (once). */
  download(onProgress: (loaded: number, total: number) => void): Promise<void>;
  /** Loads the cached model; never touches the network. */
  load(): Promise<void>;
  synth(text: string, speed: number): Promise<Audio>;
  /** Deletes the cached model files. */
  remove(): Promise<void>;
}
