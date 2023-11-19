import { ChunkSource, ChunkOptions, Chunk } from "npm:@ndn/segmented-object"
import PLazy from "npm:p-lazy"

abstract class KnownSizeChunkSource implements ChunkSource {
  constructor(
    protected readonly chunkSize: number,
    protected readonly totalSize: number,
  ) {
    this.finalChunkSize = totalSize % chunkSize;
    this.final = (totalSize - this.finalChunkSize) / chunkSize;
    if (this.finalChunkSize === 0 && totalSize > 0) {
      this.finalChunkSize = chunkSize;
      this.final -= 1;
    }
  }

  protected readonly final: number;
  protected readonly finalChunkSize: number;

  /* c8 ignore start: not used when getChunk is present */
  public async *listChunks(): AsyncIterable<Chunk> {
    for (let i = 0; i <= this.final; ++i) {
      yield this.makeChunk(i);
    }
  }
  /* c8 ignore stop */

  public async getChunk(i: number): Promise<Chunk | undefined> {
    if (i > this.final) {
      return undefined;
    }
    return this.makeChunk(i);
  }

  private async makeChunk(i: number): Promise<Chunk> {
    const payload = await this.getPayload(i, i * this.chunkSize,
      i === this.final ? this.finalChunkSize : this.chunkSize);
    return {
      i,
      final: this.final,
      payload,
    };
  }

  protected abstract getPayload(i: number, offset: number, chunkSize: number): Promise<Uint8Array>;
}

interface ChunkSizeRange {
  /**
   * Minimum chunk size.
   * @default 64
   */
  minChunkSize?: number;

  /**
   * Maximum chunk size.
   * @default 4096
   */
  maxChunkSize?: number;
}

interface ChunkSizeExact {
  /** Exact chunk size. */
  chunkSize?: number;
}

function getMaxChunkSize(opts: ChunkOptions): number {
  return (opts as ChunkSizeRange).maxChunkSize ?? (opts as ChunkSizeExact).chunkSize ?? 4096;
}

class FileHandleChunkSource extends KnownSizeChunkSource {
  constructor(private readonly fh: Deno.FsFile, chunkSize: number, totalSize: number) {
    super(chunkSize, totalSize);
  }

  protected async getPayload(i: number, offset: number, chunkSize: number): Promise<Uint8Array> {
    void i;
    const payload = new Uint8Array(chunkSize);

    await this.fh.seek(offset, Deno.SeekMode.Start);
    await this.fh.read(payload);
    return payload;
  }

  public async close() {
    await this.fh.close();
  }
}

export class FileChunkSource implements ChunkSource {
  constructor(path: string, opts: ChunkOptions = {}) {
    const chunkSize = getMaxChunkSize(opts);
    this.opening = PLazy.from(async () => {
      const fh = await Deno.open(path, { read: true });
      const { size } = await fh.stat();
      return new FileHandleChunkSource(fh, chunkSize, size);
    });
  }

  private readonly opening: PLazy<FileHandleChunkSource>;

  /* c8 ignore start: not used when getChunk is present */
  public async *listChunks(): AsyncIterable<Chunk> {
    const h = await this.opening;
    yield* h.listChunks();
  }
  /* c8 ignore stop */

  public async getChunk(i: number): Promise<Chunk | undefined> {
    const h = await this.opening;
    return h.getChunk(i);
  }

  public async close() {
    const h = await this.opening;
    await h.close();
  }
}