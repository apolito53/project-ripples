/// <reference types="@webgpu/types" />

type WebGlDisjointTimerExtension = {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
};

/**
 * Non-blocking WebGL2 timer-query wrapper used only by the benchmark harness.
 * Results are polled several frames later so measurement never stalls the GPU.
 */
export class WebGlGpuFrameTimer {
  readonly mode: "webgl-disjoint-query" | "unavailable";
  private readonly extension: WebGlDisjointTimerExtension | null;
  private readonly pendingQueries: WebGLQuery[] = [];
  private activeQuery: WebGLQuery | null = null;
  private lastDurationMs: number | null = null;
  private resultSequence = 0;
  private errorCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    enabled: boolean
  ) {
    this.extension = enabled
      ? gl.getExtension("EXT_disjoint_timer_query_webgl2") as WebGlDisjointTimerExtension | null
      : null;
    this.mode = this.extension ? "webgl-disjoint-query" : "unavailable";
  }

  begin(): void {
    this.poll();
    if (!this.extension || this.activeQuery || this.pendingQueries.length >= 8) return;

    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
  }

  end(): void {
    if (!this.extension || !this.activeQuery) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pendingQueries.push(this.activeQuery);
    this.activeQuery = null;
  }

  getLatestResult(): { readonly sequence: number; readonly durationMs: number } | null {
    this.poll();
    return this.lastDurationMs === null
      ? null
      : { sequence: this.resultSequence, durationMs: this.lastDurationMs };
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  dispose(): void {
    if (this.extension && this.activeQuery) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.activeQuery);
      this.activeQuery = null;
    }
    for (const query of this.pendingQueries) this.gl.deleteQuery(query);
    this.pendingQueries.length = 0;
  }

  private poll(): void {
    const query = this.pendingQueries[0];
    if (!this.extension || !query) return;
    if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) return;

    this.pendingQueries.shift();
    const disjoint = Boolean(this.gl.getParameter(this.extension.GPU_DISJOINT_EXT));
    if (!disjoint) {
      const elapsedNanoseconds = Number(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT));
      if (Number.isFinite(elapsedNanoseconds)) {
        this.lastDurationMs = elapsedNanoseconds / 1_000_000;
        this.resultSequence += 1;
      } else {
        this.errorCount += 1;
      }
    } else {
      this.errorCount += 1;
    }
    this.gl.deleteQuery(query);
  }
}

type WebGpuTimerSlot = {
  readonly queryIndex: number;
  readonly resolveBuffer: GPUBuffer;
  readonly readBuffer: GPUBuffer;
  state: "idle" | "encoded" | "pending";
};

/**
 * Timestamp-query ring for WebGPU. Mapping happens after submission and is
 * deliberately detached from the animation loop.
 */
export class WebGpuFrameTimer {
  readonly mode: "webgpu-timestamp-query" | "unavailable";
  private readonly querySet: GPUQuerySet | null;
  private readonly slots: WebGpuTimerSlot[];
  private encodedSlot: WebGpuTimerSlot | null = null;
  private lastDurationMs: number | null = null;
  private resultSequence = 0;
  private errorCount = 0;
  private disposed = false;

  constructor(
    device: GPUDevice,
    enabled: boolean,
    slotCount = 4
  ) {
    const available = enabled && device.features.has("timestamp-query");
    this.mode = available ? "webgpu-timestamp-query" : "unavailable";
    this.querySet = available
      ? device.createQuerySet({ type: "timestamp", count: slotCount * 2 })
      : null;
    this.slots = this.querySet
      ? Array.from({ length: slotCount }, (_, index) => ({
          queryIndex: index * 2,
          resolveBuffer: device.createBuffer({
            label: `Ripple benchmark timestamp resolve ${index}`,
            size: 16,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
          }),
          readBuffer: device.createBuffer({
            label: `Ripple benchmark timestamp read ${index}`,
            size: 16,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
          }),
          state: "idle" as const
        }))
      : [];
  }

  begin(commandEncoder: GPUCommandEncoder): void {
    if (!this.querySet || this.encodedSlot) return;
    const slot = this.slots.find((candidate) => candidate.state === "idle");
    if (!slot) return;
    const marker = commandEncoder.beginComputePass({
      label: "Ripple benchmark frame-start timestamp",
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: slot.queryIndex
      }
    });
    marker.end();
    slot.state = "encoded";
    this.encodedSlot = slot;
  }

  end(commandEncoder: GPUCommandEncoder): void {
    const slot = this.encodedSlot;
    if (!this.querySet || !slot) return;
    const marker = commandEncoder.beginComputePass({
      label: "Ripple benchmark frame-end timestamp",
      timestampWrites: {
        querySet: this.querySet,
        endOfPassWriteIndex: slot.queryIndex + 1
      }
    });
    marker.end();
    commandEncoder.resolveQuerySet(this.querySet, slot.queryIndex, 2, slot.resolveBuffer, 0);
    commandEncoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readBuffer, 0, 16);
  }

  afterSubmit(): void {
    const slot = this.encodedSlot;
    this.encodedSlot = null;
    if (!slot) return;
    slot.state = "pending";

    void slot.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
      if (this.disposed) return;
      const values = new BigUint64Array(slot.readBuffer.getMappedRange().slice(0));
      if (values.length >= 2 && values[1] >= values[0]) {
        this.lastDurationMs = Number(values[1] - values[0]) / 1_000_000;
        this.resultSequence += 1;
      } else {
        this.errorCount += 1;
      }
      slot.readBuffer.unmap();
      slot.state = "idle";
    }).catch(() => {
      if (!this.disposed) {
        this.errorCount += 1;
        slot.state = "idle";
      }
    });
  }

  getLatestResult(): { readonly sequence: number; readonly durationMs: number } | null {
    return this.lastDurationMs === null
      ? null
      : { sequence: this.resultSequence, durationMs: this.lastDurationMs };
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  dispose(): void {
    this.disposed = true;
    this.querySet?.destroy();
    for (const slot of this.slots) {
      if (slot.readBuffer.mapState === "mapped") slot.readBuffer.unmap();
      slot.resolveBuffer.destroy();
      slot.readBuffer.destroy();
    }
  }
}
