import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/depth-anything-v2-small';
const MAX_INPUT_SIZE = 512;

let estimatorPromise;

async function getEstimator(onStatus) {
  if (!estimatorPromise) {
    onStatus('Loading the local depth model; first use downloads model files…');
    estimatorPromise = pipeline('depth-estimation', MODEL_ID, { dtype: 'q8' }).catch((error) => {
      estimatorPromise = null;
      throw new Error(`Could not load the depth-estimation model: ${error.message}`);
    });
  }
  return estimatorPromise;
}

function normalizeDepth(values, alpha) {
  const foregroundValues = new Float32Array(values.length);
  let foregroundCount = 0;
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) {
      throw new Error('The depth model returned an invalid depth value.');
    }
    if (alpha[index] >= 128) {
      foregroundValues[foregroundCount] = values[index];
      foregroundCount++;
    }
  }
  if (!foregroundCount) throw new Error('The isolated image has no visible pixels for depth estimation.');
  const sorted = foregroundValues.subarray(0, foregroundCount).sort();
  const low = sorted[Math.floor((sorted.length - 1) * 0.04)];
  const high = sorted[Math.floor((sorted.length - 1) * 0.96)];
  if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < 1e-6) {
    throw new Error('The depth model returned a flat or invalid foreground depth map.');
  }
  const range = high - low;
  return Float32Array.from(values, (value) => Math.max(0, Math.min(1, (value - low) / range)));
}

export async function estimateDepthMap(imageUrl, onStatus = () => {}) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not open the isolated image for depth estimation.'));
    element.src = imageUrl;
  });
  const scale = Math.min(1, MAX_INPUT_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not prepare the isolated image for depth estimation.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const inputPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = inputPixels[index * 4 + 3];
  context.fillStyle = '#808080';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const flippedCanvas = document.createElement('canvas');
  flippedCanvas.width = canvas.width;
  flippedCanvas.height = canvas.height;
  const flippedContext = flippedCanvas.getContext('2d');
  if (!flippedContext) throw new Error('Could not prepare the flipped image for depth refinement.');
  flippedContext.translate(canvas.width, 0);
  flippedContext.scale(-1, 1);
  flippedContext.drawImage(canvas, 0, 0);

  const estimator = await getEstimator(onStatus);
  onStatus('Estimating depth from two local image passes…');
  const { predicted_depth: predictedDepth } = await estimator(canvas);
  const { predicted_depth: flippedDepth } = await estimator(flippedCanvas);
  const [height, width] = predictedDepth.dims.slice(-2);
  if (
    !width
    || !height
    || predictedDepth.data.length !== width * height
    || flippedDepth.data.length !== width * height
    || flippedDepth.dims.slice(-2)[0] !== height
    || flippedDepth.dims.slice(-2)[1] !== width
  ) {
    throw new Error('The depth model returned an invalid depth map.');
  }
  if (alpha.length !== predictedDepth.data.length) {
    throw new Error('The depth model output does not match the isolated image dimensions.');
  }
  const combinedDepth = new Float32Array(predictedDepth.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      combinedDepth[index] = (predictedDepth.data[index] + flippedDepth.data[y * width + width - 1 - x]) / 2;
    }
  }
  return {
    values: normalizeDepth(combinedDepth, alpha),
    width,
    height,
  };
}
