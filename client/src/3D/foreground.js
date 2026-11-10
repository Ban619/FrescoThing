const MEDIAPIPE_VERSION = '1.2.0';
const MEDIAPIPE_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-assets/deeplabv3.tflite?generation=1661875711618421';
const MAX_INFERENCE_SIZE = 512;
const MAX_CROP_SIZE = 2048;
const FOREGROUND_THRESHOLDS = [0.32, 0.24, 0.18, 0.12, 0.08];

let segmenterPromise;

async function getSegmenter(onStatus) {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      onStatus('Loading the object-isolation model…');
      const { FilesetResolver, ImageSegmenter } = await import(
        /* @vite-ignore */
        MEDIAPIPE_MODULE_URL
      );
      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
      );
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })().catch((error) => {
      segmenterPromise = null;
      throw new Error(`Could not load the object-isolation model. Check your internet connection and try again. ${error.message}`);
    });
  }
  return segmenterPromise;
}

export function findMainObject(foreground, width, height) {
  let components = [];
  let thresholdUsed = FOREGROUND_THRESHOLDS[0];
  const minComponentArea = Math.max(8, Math.floor(foreground.length * 0.00005));

  for (const threshold of FOREGROUND_THRESHOLDS) {
    const visited = new Uint8Array(foreground.length);
    const queue = new Int32Array(foreground.length);
    const candidates = [];

    for (let start = 0; start < foreground.length; start++) {
      if (visited[start] || foreground[start] < threshold) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;

      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        for (let dy = -1; dy <= 1; dy++) {
          const nextY = y + dy;
          if (nextY < 0 || nextY >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            if (nextX < 0 || nextX >= width) continue;
            const next = nextY * width + nextX;
            if (visited[next] || foreground[next] < threshold) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }

      if (tail < minComponentArea) continue;
      candidates.push({
        area: tail,
        pixels: queue.slice(0, tail),
        minX,
        minY,
        maxX,
        maxY,
      });
    }

    candidates.sort((a, b) => b.area - a.area);
    if (candidates[0]?.area >= Math.max(8, Math.floor(foreground.length * 0.0001))) {
      components = candidates.slice(0, 96);
      thresholdUsed = threshold;
      break;
    }
  }

  const object = components[0];
  if (!object) return null;

  const selected = [object];
  const remaining = components.slice(1);
  const maxGap = Math.max(2, Math.round(Math.hypot(width, height) * 0.025));
  const minNearbyArea = Math.max(8, Math.floor(object.area * 0.005));
  let bounds = { minX: object.minX, minY: object.minY, maxX: object.maxX, maxY: object.maxY };
  let expanded = true;

  while (expanded) {
    expanded = false;
    for (let index = remaining.length - 1; index >= 0; index--) {
      const component = remaining[index];
      if (component.area < minNearbyArea) continue;
      const gapX = Math.max(0, bounds.minX - component.maxX - 1, component.minX - bounds.maxX - 1);
      const gapY = Math.max(0, bounds.minY - component.maxY - 1, component.minY - bounds.maxY - 1);
      if (Math.hypot(gapX, gapY) > maxGap) continue;

      selected.push(component);
      bounds = {
        minX: Math.min(bounds.minX, component.minX),
        minY: Math.min(bounds.minY, component.minY),
        maxX: Math.max(bounds.maxX, component.maxX),
        maxY: Math.max(bounds.maxY, component.maxY),
      };
      remaining.splice(index, 1);
      expanded = true;
    }
  }

  return {
    threshold: thresholdUsed,
    components: selected,
    ...bounds,
  };
}

export function createForegroundMask(classMasks, backgroundIndex = -1) {
  if (!classMasks.length) return new Float32Array();
  const pixelCount = classMasks[0].length;
  const foreground = new Float32Array(pixelCount);
  let containsLogits = false;

  for (const mask of classMasks) {
    for (const value of mask) {
      if (value < 0 || value > 1) {
        containsLogits = true;
        break;
      }
    }
    if (containsLogits) break;
  }

  if (classMasks.length === 1) {
    const mask = classMasks[0];
    for (let index = 0; index < pixelCount; index++) {
      const value = mask[index];
      const confidence = containsLogits ? 1 / (1 + Math.exp(-value)) : value;
      foreground[index] = backgroundIndex === 0 ? 1 - confidence : confidence;
    }
    return foreground;
  }

  for (let index = 0; index < pixelCount; index++) {
    if (containsLogits) {
      let maxScore = -Infinity;
      for (const mask of classMasks) maxScore = Math.max(maxScore, mask[index]);
      let total = 0;
      let background = 0;
      for (let category = 0; category < classMasks.length; category++) {
        const score = Math.exp(classMasks[category][index] - maxScore);
        total += score;
        if (category === backgroundIndex) background = score;
      }
      foreground[index] = total ? 1 - background / total : 0;
    } else {
      let total = 0;
      for (const mask of classMasks) total += mask[index];
      const background = classMasks[backgroundIndex]?.[index] || 0;
      foreground[index] = total ? Math.max(0, Math.min(1, 1 - background / total)) : 0;
    }
  }

  return foreground;
}

function createCenterCrop(image) {
  const scale = Math.min(1, MAX_CROP_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale * 0.78));
  const height = Math.max(1, Math.round(image.naturalHeight * scale * 0.78));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare an automatic focus crop.');
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const left = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
  const top = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
  context.drawImage(image, left, top, sourceWidth, sourceHeight, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve({ blob, usedFallback: true });
      else reject(new Error('Could not prepare an automatic focus crop.'));
    }, 'image/png');
  });
}

async function createSaliencyCrop(image) {
  const scale = Math.min(1, MAX_INFERENCE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not analyze the image for an automatic crop.');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const edge = [];
  const edgeWidth = Math.max(1, Math.round(Math.min(width, height) * 0.04));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= edgeWidth && x < width - edgeWidth && y >= edgeWidth && y < height - edgeWidth) continue;
      const offset = (y * width + x) * 4;
      edge.push([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
    }
  }
  const channelMedian = (channel) => {
    const values = edge.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const background = [channelMedian(0), channelMedian(1), channelMedian(2)];
  const foreground = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] - background[0];
      const green = pixels[offset + 1] - background[1];
      const blue = pixels[offset + 2] - background[2];
      const colorDistance = Math.sqrt(red * red + green * green + blue * blue) / 441.67;
      const centerDistance = Math.hypot((x - width / 2) / Math.max(1, width / 2), (y - height / 2) / Math.max(1, height / 2));
      foreground[y * width + x] = Math.min(1, colorDistance * Math.max(0.65, 1.2 - centerDistance * 0.35));
    }
  }

  const object = findMainObject(foreground, width, height);
  if (!object) return null;
  const boxWidth = object.maxX - object.minX + 1;
  const boxHeight = object.maxY - object.minY + 1;
  if (boxWidth >= width * 0.96 && boxHeight >= height * 0.96) return null;
  const crop = await createCroppedImage(image, foreground, width, height, object);
  return { ...crop, usedFallback: true };
}

async function createFallbackCrop(image) {
  const crop = await createSaliencyCrop(image);
  return crop || createCenterCrop(image);
}

function createCroppedImage(image, foreground, maskWidth, maskHeight, object) {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const objectMask = new Uint8Array(foreground.length);
  for (const component of object.components) {
    for (const index of component.pixels) objectMask[index] = 1;
  }
  const alphaFloor = Math.min(0.16, object.threshold * 0.5);
  const alphaRange = Math.max(0.12, 0.54 - alphaFloor);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskWidth;
  maskCanvas.height = maskHeight;
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) throw new Error('Could not prepare the object mask.');
  const maskImage = maskContext.createImageData(maskWidth, maskHeight);
  for (let index = 0; index < objectMask.length; index++) {
    const offset = index * 4;
    const alpha = objectMask[index]
      ? Math.max(0.55, Math.min(1, (foreground[index] - alphaFloor) / alphaRange))
      : 0;
    maskImage.data[offset] = 255;
    maskImage.data[offset + 1] = 255;
    maskImage.data[offset + 2] = 255;
    maskImage.data[offset + 3] = Math.round(alpha * 255);
  }
  maskContext.putImageData(maskImage, 0, 0);

  const scaleX = sourceWidth / maskWidth;
  const scaleY = sourceHeight / maskHeight;
  const padding = Math.max(4, Math.round(Math.min(sourceWidth, sourceHeight) * 0.04));
  const left = Math.max(0, Math.floor(object.minX * scaleX - padding));
  const top = Math.max(0, Math.floor(object.minY * scaleY - padding));
  const right = Math.min(sourceWidth, Math.ceil((object.maxX + 1) * scaleX + padding));
  const bottom = Math.min(sourceHeight, Math.ceil((object.maxY + 1) * scaleY + padding));
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  const outputScale = Math.min(1, MAX_CROP_SIZE / Math.max(cropWidth, cropHeight));
  const outputWidth = Math.max(1, Math.round(cropWidth * outputScale));
  const outputHeight = Math.max(1, Math.round(cropHeight * outputScale));

  const output = document.createElement('canvas');
  output.width = outputWidth;
  output.height = outputHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not create the cropped object image.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(
    maskCanvas,
    0,
    0,
    maskWidth,
    maskHeight,
    -left * outputScale,
    -top * outputScale,
    sourceWidth * outputScale,
    sourceHeight * outputScale,
  );

  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (blob) resolve({ blob, usedFallback: false });
      else reject(new Error('Could not save the isolated object crop.'));
    }, 'image/png');
  });
}

export async function isolateMainObject(imageUrl, onStatus = () => {}) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not open the selected image.'));
    element.src = imageUrl;
  });

  const scale = Math.min(1, MAX_INFERENCE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const inferenceCanvas = document.createElement('canvas');
  inferenceCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  inferenceCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const inferenceContext = inferenceCanvas.getContext('2d');
  if (!inferenceContext) throw new Error('Could not prepare the image for object detection.');
  inferenceContext.drawImage(image, 0, 0, inferenceCanvas.width, inferenceCanvas.height);

  let segmenter;
  try {
    segmenter = await getSegmenter(onStatus);
  } catch (error) {
    onStatus(`Object isolation could not start. Creating an automatic focus crop instead. ${error.message}`);
    return createFallbackCrop(image);
  }
  onStatus('Detecting and cropping the main object…');
  let result;
  try {
    result = segmenter.segment(inferenceCanvas);
  } catch (error) {
    onStatus(`Object detection failed. Creating an automatic focus crop instead. ${error.message}`);
    return createFallbackCrop(image);
  }
  try {
    const confidenceMasks = result.confidenceMasks;
    if (!confidenceMasks?.length) {
      onStatus('The model returned no subject mask. Creating an automatic focus crop instead…');
      return await createFallbackCrop(image);
    }
    const maskWidth = confidenceMasks[0].width;
    const maskHeight = confidenceMasks[0].height;
    const foreground = new Float32Array(maskWidth * maskHeight);
    const classMasks = confidenceMasks.map((mask) => mask.getAsFloat32Array());
    const labels = segmenter.getLabels?.() || [];
    const labelBackgroundIndex = labels.findIndex((label) => label.trim().toLowerCase() === 'background');
    const backgroundIndex = labelBackgroundIndex >= 0 ? labelBackgroundIndex : (classMasks.length > 1 ? 0 : -1);
    foreground.set(createForegroundMask(classMasks, backgroundIndex));
    const object = findMainObject(foreground, maskWidth, maskHeight);
    const coversWholeImage = object
      && object.maxX - object.minX + 1 >= maskWidth * 0.96
      && object.maxY - object.minY + 1 >= maskHeight * 0.96;
    const objectBoxArea = object
      ? (object.maxX - object.minX + 1) * (object.maxY - object.minY + 1)
      : 0;
    const weakMask = object
      && (object.threshold < 0.18 || object.area < foreground.length * 0.002 || objectBoxArea < foreground.length * 0.04);
    if (!object || coversWholeImage || weakMask) {
      onStatus('The subject mask was too weak to trust. Creating an automatic focus crop instead…');
      return await createFallbackCrop(image);
    }
    if (object.threshold < FOREGROUND_THRESHOLDS[0]) {
      onStatus('Using a more sensitive subject selection to isolate this image…');
    }
    return await createCroppedImage(image, foreground, maskWidth, maskHeight, object);
  } finally {
    result.close();
  }
}
