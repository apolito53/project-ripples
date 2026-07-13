import { PNG } from "pngjs";

const HISTOGRAM_BIN_COUNT = 16;
const COARSE_GRID_WIDTH = 32;
const COARSE_GRID_HEIGHT = 18;

/**
 * Compare two renderer captures without pretending that independent rasterizers
 * should produce identical pixels. The aligned RGB delta remains useful for
 * heatmaps, while histogram and coarse-luma metrics survive small shader and
 * sampling differences more gracefully.
 */
export function compareRendererCaptures(referenceBuffer, candidateBuffer) {
  const reference = PNG.sync.read(referenceBuffer);
  const candidate = PNG.sync.read(candidateBuffer);
  assertMatchingDimensions(reference, candidate);

  const pixelCount = Math.max(1, reference.width * reference.height);
  const referenceHistogram = new Float64Array(HISTOGRAM_BIN_COUNT);
  const candidateHistogram = new Float64Array(HISTOGRAM_BIN_COUNT);
  let absoluteRgbDelta = 0;
  let changedPixels = 0;

  for (let index = 0; index < reference.data.length; index += 4) {
    const redDelta = Math.abs(reference.data[index] - candidate.data[index]);
    const greenDelta = Math.abs(reference.data[index + 1] - candidate.data[index + 1]);
    const blueDelta = Math.abs(reference.data[index + 2] - candidate.data[index + 2]);
    const pixelDelta = (redDelta + greenDelta + blueDelta) / 3;
    absoluteRgbDelta += pixelDelta;
    if (pixelDelta > 8) changedPixels += 1;

    referenceHistogram[toHistogramBin(readLuma(reference.data, index))] += 1;
    candidateHistogram[toHistogramBin(readLuma(candidate.data, index))] += 1;
  }

  const referenceGrid = createCoarseLumaGrid(reference);
  const candidateGrid = createCoarseLumaGrid(candidate);
  const referenceEdgeDensity = calculateEdgeDensity(reference);
  const candidateEdgeDensity = calculateEdgeDensity(candidate);

  return {
    width: reference.width,
    height: reference.height,
    meanAbsoluteRgbDelta: round(absoluteRgbDelta / pixelCount),
    changedPixelRatio: round(changedPixels / pixelCount),
    lumaHistogramIntersection: round(histogramIntersection(
      referenceHistogram,
      candidateHistogram,
      pixelCount
    )),
    coarseLumaCorrelation: round(correlation(referenceGrid, candidateGrid)),
    referenceEdgeDensity: round(referenceEdgeDensity),
    candidateEdgeDensity: round(candidateEdgeDensity),
    edgeDensityDelta: round(Math.abs(referenceEdgeDensity - candidateEdgeDensity))
  };
}

/**
 * Produce a review strip ordered as WebGL reference, WebGPU candidate, and an
 * amplified absolute-difference heatmap. File names carry the labels so this
 * helper can stay font-free and deterministic.
 */
export function createRendererParityStrip(referenceBuffer, candidateBuffer) {
  const reference = PNG.sync.read(referenceBuffer);
  const candidate = PNG.sync.read(candidateBuffer);
  assertMatchingDimensions(reference, candidate);

  const strip = new PNG({
    width: reference.width * 3,
    height: reference.height,
    colorType: 6
  });

  copyImage(reference, strip, 0);
  copyImage(candidate, strip, reference.width);

  const diffOffset = reference.width * 2;
  for (let y = 0; y < reference.height; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      const sourceIndex = (y * reference.width + x) * 4;
      const targetIndex = (y * strip.width + diffOffset + x) * 4;
      const redDelta = Math.abs(reference.data[sourceIndex] - candidate.data[sourceIndex]);
      const greenDelta = Math.abs(reference.data[sourceIndex + 1] - candidate.data[sourceIndex + 1]);
      const blueDelta = Math.abs(reference.data[sourceIndex + 2] - candidate.data[sourceIndex + 2]);
      const amplified = Math.min(255, Math.round((redDelta + greenDelta + blueDelta) * 1.4));
      strip.data[targetIndex] = amplified;
      strip.data[targetIndex + 1] = Math.min(255, Math.round(greenDelta * 2.5));
      strip.data[targetIndex + 2] = Math.min(255, Math.round(blueDelta * 2.5));
      strip.data[targetIndex + 3] = 255;
    }
  }

  return PNG.sync.write(strip);
}

function createCoarseLumaGrid(png) {
  const totals = new Float64Array(COARSE_GRID_WIDTH * COARSE_GRID_HEIGHT);
  const counts = new Uint32Array(totals.length);

  for (let y = 0; y < png.height; y += 1) {
    const gridY = Math.min(COARSE_GRID_HEIGHT - 1, Math.floor(y * COARSE_GRID_HEIGHT / png.height));
    for (let x = 0; x < png.width; x += 1) {
      const gridX = Math.min(COARSE_GRID_WIDTH - 1, Math.floor(x * COARSE_GRID_WIDTH / png.width));
      const gridIndex = gridY * COARSE_GRID_WIDTH + gridX;
      const pixelIndex = (y * png.width + x) * 4;
      totals[gridIndex] += readLuma(png.data, pixelIndex);
      counts[gridIndex] += 1;
    }
  }

  return Float64Array.from(totals, (total, index) => total / Math.max(1, counts[index]));
}

function calculateEdgeDensity(png) {
  let edgePixels = 0;
  let samples = 0;

  for (let y = 0; y < png.height - 1; y += 2) {
    for (let x = 0; x < png.width - 1; x += 2) {
      const index = (y * png.width + x) * 4;
      const right = (y * png.width + x + 1) * 4;
      const down = ((y + 1) * png.width + x) * 4;
      const luma = readLuma(png.data, index);
      const gradient = Math.abs(luma - readLuma(png.data, right)) +
        Math.abs(luma - readLuma(png.data, down));
      if (gradient > 28) edgePixels += 1;
      samples += 1;
    }
  }

  return edgePixels / Math.max(1, samples);
}

function histogramIntersection(reference, candidate, pixelCount) {
  let overlap = 0;
  for (let index = 0; index < reference.length; index += 1) {
    overlap += Math.min(reference[index], candidate[index]);
  }
  return overlap / pixelCount;
}

function correlation(reference, candidate) {
  const referenceMean = mean(reference);
  const candidateMean = mean(candidate);
  let covariance = 0;
  let referenceVariance = 0;
  let candidateVariance = 0;

  for (let index = 0; index < reference.length; index += 1) {
    const referenceCentered = reference[index] - referenceMean;
    const candidateCentered = candidate[index] - candidateMean;
    covariance += referenceCentered * candidateCentered;
    referenceVariance += referenceCentered * referenceCentered;
    candidateVariance += candidateCentered * candidateCentered;
  }

  const denominator = Math.sqrt(referenceVariance * candidateVariance);
  return denominator > 0 ? covariance / denominator : 0;
}

function mean(values) {
  let total = 0;
  for (const value of values) total += value;
  return total / Math.max(1, values.length);
}

function readLuma(data, index) {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function toHistogramBin(luma) {
  return Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor(luma * HISTOGRAM_BIN_COUNT / 256));
}

function copyImage(source, target, targetX) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = (y * target.width + targetX) * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + source.width * 4);
  }
}

function assertMatchingDimensions(reference, candidate) {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `Renderer captures must match dimensions; got ${reference.width}x${reference.height} and ` +
      `${candidate.width}x${candidate.height}.`
    );
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
