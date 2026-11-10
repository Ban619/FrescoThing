import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function findBoundaryEdges(indices) {
  const edges = new Map();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]];
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, [a, b]);
    }
  }
  return [...edges.values()];
}

function findOuterBoundaryEdges(indices, columns) {
  const edges = findBoundaryEdges(indices);
  const outgoing = new Map();
  for (let index = 0; index < edges.length; index++) {
    const [start] = edges[index];
    if (!outgoing.has(start)) outgoing.set(start, []);
    outgoing.get(start).push(index);
  }

  const visited = new Uint8Array(edges.length);
  const loops = [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    if (visited[edgeIndex]) continue;
    const loop = [];
    const startVertex = edges[edgeIndex][0];
    let currentEdge = edgeIndex;
    let closed = false;

    while (!visited[currentEdge]) {
      visited[currentEdge] = 1;
      loop.push(edges[currentEdge]);
      const currentVertex = edges[currentEdge][1];
      if (currentVertex === startVertex) {
        closed = true;
        break;
      }
      const nextEdge = outgoing.get(currentVertex)?.find((candidate) => !visited[candidate]);
      if (nextEdge === undefined) break;
      currentEdge = nextEdge;
    }

    if (!closed) continue;
    let area = 0;
    for (const [a, b] of loop) {
      area += (a % columns) * Math.floor(b / columns) - (b % columns) * Math.floor(a / columns);
    }
    loops.push({ edges: loop, area: area / 2 });
  }

  const largestLoop = loops.reduce((largest, loop) => (
    Math.abs(loop.area) > Math.abs(largest?.area || 0) ? loop : largest
  ), null);
  if (!largestLoop || largestLoop.area === 0) return [];
  return loops
    .filter((loop) => loop.area * largestLoop.area > 0)
    .flatMap((loop) => loop.edges);
}

function buildSurfaceIndices(pixels, columns, rows, alphaThreshold = 48) {
  const indices = [];
  const isVisible = (index) => pixels[index * 4 + 3] >= alphaThreshold;

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < columns - 1; x++) {
      const a = y * columns + x;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if (isVisible(a) && isVisible(c) && isVisible(b)) indices.push(a, c, b);
      if (isVisible(b) && isVisible(c) && isVisible(d)) indices.push(b, c, d);
    }
  }

  return indices;
}

function smoothSurfaceValues(values, alpha, columns, rows) {
  const kernel = [1, 4, 6, 4, 1];
  const radius = Math.floor(kernel.length / 2);
  const count = columns * rows;
  const horizontal = new Float32Array(count);
  const horizontalWeight = new Float32Array(count);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = x + offset;
        if (sampleX < 0 || sampleX >= columns) continue;
        const sample = y * columns + sampleX;
        const weight = kernel[offset + radius] * alpha[sample];
        horizontal[index] += values[sample] * weight;
        horizontalWeight[index] += weight;
      }
    }
  }


  const smoothed = new Float32Array(count);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      let total = 0;
      let totalWeight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = y + offset;
        if (sampleY < 0 || sampleY >= rows) continue;
        const sample = sampleY * columns + x;
        const weight = kernel[offset + radius];
        total += horizontal[sample] * weight;
        totalWeight += horizontalWeight[sample] * weight;
      }
      smoothed[index] = totalWeight ? total / totalWeight : values[index];
    }
  }

  return smoothed;
}

function smoothSurfaceLuminance(pixels, columns, rows) {
  const luminance = new Float32Array(columns * rows);
  const alpha = new Float32Array(columns * rows);
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4;
    luminance[index] = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    alpha[index] = pixels[offset + 3] / 255;
  }
  return smoothSurfaceValues(luminance, alpha, columns, rows);
}

function buildSurfaceDepth(depthMap, luminance, pixels, columns, rows) {
  if (!depthMap) return luminance;
  const radius = 2;
  const spatialSigma = 1.65;
  const colorSigma = 0.12;
  const values = new Float32Array(columns * rows);
  const refined = new Float32Array(columns * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      values[index] = sampleDepthMap(depthMap, x / (columns - 1), y / (rows - 1));
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x;
      const centerOffset = index * 4;
      const centerRed = pixels[centerOffset];
      const centerGreen = pixels[centerOffset + 1];
      const centerBlue = pixels[centerOffset + 2];
      const centerDepth = values[index];
      let weightedDepth = 0;
      let totalWeight = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= rows) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= columns) continue;
          const sampleIndex = sampleY * columns + sampleX;
          const sampleOffset = sampleIndex * 4;
          const alpha = pixels[sampleOffset + 3] / 255;
          if (alpha < 0.1) continue;
          const redDifference = (pixels[sampleOffset] - centerRed) / 255;
          const greenDifference = (pixels[sampleOffset + 1] - centerGreen) / 255;
          const blueDifference = (pixels[sampleOffset + 2] - centerBlue) / 255;
          const colorDistance = (redDifference ** 2 + greenDifference ** 2 + blueDifference ** 2) / 3;
          const spatialDistance = dx * dx + dy * dy;
          const weight = alpha
            * Math.exp(-spatialDistance / (2 * spatialSigma ** 2))
            * Math.exp(-colorDistance / (2 * colorSigma ** 2));
          weightedDepth += values[sampleIndex] * weight;
          totalWeight += weight;
        }
      }

      refined[index] = totalWeight ? weightedDepth / totalWeight : centerDepth;
    }
  }
  return refined;
}

function sampleDepthMap(depthMap, x, y) {
  const mapX = clamp(x, 0, 1) * (depthMap.width - 1);
  const mapY = clamp(y, 0, 1) * (depthMap.height - 1);
  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(depthMap.width - 1, x0 + 1);
  const y1 = Math.min(depthMap.height - 1, y0 + 1);
  const top = depthMap.values[y0 * depthMap.width + x0] * (1 - (mapX - x0))
    + depthMap.values[y0 * depthMap.width + x1] * (mapX - x0);
  const bottom = depthMap.values[y1 * depthMap.width + x0] * (1 - (mapX - x0))
    + depthMap.values[y1 * depthMap.width + x1] * (mapX - x0);
  return top * (1 - (mapY - y0)) + bottom * (mapY - y0);
}

export function createReliefViewer(canvas, onError = () => {}, onFallback = () => {}) {
  let renderer = null;
  let controls = null;
  let renderCanvas = canvas;
  let softwareContext = null;
  try {
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (context) renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: false });
    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
  } catch {
    renderer = null;
  }
  if (!renderer) {
    softwareContext = renderCanvas.getContext('2d');
    if (!softwareContext) throw new Error('Neither WebGL nor 2D canvas rendering is available.');
    onFallback('WebGL is unavailable; using a lightweight software-rendered preview.');
  }

  const scene = renderer ? new THREE.Scene() : null;
  const camera = renderer ? new THREE.PerspectiveCamera(36, 1, 0.1, 100) : null;
  let controlsTarget = null;
  if (renderer) {
    scene.background = new THREE.Color('#dfe3e8');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5d6570, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.position.set(-2.5, 3.5, 5);
    scene.add(keyLight);
    camera.position.set(0, -0.35, 4.8);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 2.2;
    controls.maxDistance = 9;
    controls.target.set(0, 0, 0);
    controlsTarget = controls.target;
  }

  const model = new THREE.Group();
  if (scene) scene.add(model);
  let sourceImage = null;
  let depthMap = null;
  let materialImage = null;
  let materialSourceImage = null;
  let materialFinish = '';
  let materialTint = '';
  let texture = null;
  let modelParts = [];
  let depth = 0.42;
  let thickness = 0.16;
  let detail = 150;
  let invert = false;
  let finish = 'original';
  let tint = '#ffffff';
  let rebuildTimer = 0;
  let loadVersion = 0;
  let frame = 0;
  let destroyed = false;
  let softwareMesh = null;
  let softwareYaw = -0.18;
  let softwarePitch = 0.14;
  let softwareZoom = 1;
  let softwareDrag = null;

  function resize() {
    const width = renderCanvas.clientWidth;
    const height = renderCanvas.clientHeight;
    if (!width || !height || destroyed) return;
    if (renderer) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    } else {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      renderCanvas.width = Math.round(width * ratio);
      renderCanvas.height = Math.round(height * ratio);
      renderSoftware();
    }
  }

  function clearModel() {
    for (const part of modelParts) {
      model.remove(part);
      part.geometry.dispose();
    }
    modelParts = [];
    if (texture) {
      texture.dispose();
      texture = null;
    }
  }

  const imageMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: '#39424c',
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    color: '#4d5660',
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  function createMaterialImage(image) {
    if (finish === 'original' && tint === '#ffffff') return image;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not prepare the selected surface finish.');
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const tintRed = Number.parseInt(tint.slice(1, 3), 16);
    const tintGreen = Number.parseInt(tint.slice(3, 5), 16);
    const tintBlue = Number.parseInt(tint.slice(5, 7), 16);

    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      let red = pixels[index];
      let green = pixels[index + 1];
      let blue = pixels[index + 2];

      if (finish === 'monochrome') {
        red = luminance;
        green = luminance;
        blue = luminance;
      } else if (finish === 'bronze') {
        red = 62 + luminance * 0.69;
        green = 35 + luminance * 0.49;
        blue = 17 + luminance * 0.31;
      } else if (finish === 'stone') {
        const grain = ((index * 17) % 13) - 6;
        red = luminance * 0.78 + 43 + grain;
        green = luminance * 0.81 + 42 + grain;
        blue = luminance * 0.84 + 39 + grain;
      }

      pixels[index] = Math.round(red * tintRed / 255);
      pixels[index + 1] = Math.round(green * tintGreen / 255);
      pixels[index + 2] = Math.round(blue * tintBlue / 255);
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildSoftwareMesh(image) {
    const aspect = image.naturalWidth / image.naturalHeight;
    const segmentsX = Math.max(12, Math.round(detail / 4 * Math.min(aspect, 1)));
    const segmentsY = Math.max(12, Math.round(detail / 4 * Math.min(1 / aspect, 1)));
    const width = 2.8 * Math.min(aspect, 1);
    const height = 2.8 * Math.min(1 / aspect, 1);
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = segmentsX + 1;
    sampleCanvas.height = segmentsY + 1;
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const columns = segmentsX + 1;
    const surfaceLuminance = smoothSurfaceLuminance(pixels, columns, segmentsY + 1);
    const surfaceDepth = buildSurfaceDepth(depthMap, surfaceLuminance, pixels, columns, segmentsY + 1);
    const positions = new Float32Array(columns * (segmentsY + 1) * 3);

    for (let y = 0; y <= segmentsY; y++) {
      for (let x = 0; x <= segmentsX; x++) {
        const index = y * columns + x;
        const depthValue = surfaceDepth[index];
        const reliefDepth = invert ? 1 - depthValue : depthValue;
        positions[index * 3] = (x / segmentsX - 0.5) * width;
        positions[index * 3 + 1] = (0.5 - y / segmentsY) * height;
        positions[index * 3 + 2] = (0.1 + reliefDepth * 0.8) * depth;
      }
    }

    const indices = buildSurfaceIndices(pixels, columns, segmentsY + 1);

    softwareMesh = {
      positions,
      indices,
      boundaryEdges: findOuterBoundaryEdges(indices, columns),
      segmentsX,
      segmentsY,
      width,
      height,
    };
  }

  function mapTextureTriangle(context, image, vertices) {
    const [p0, p1, p2] = vertices;
    const [x0, y0] = p0.source;
    const [x1, y1] = p1.source;
    const [x2, y2] = p2.source;
    const denominator = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (Math.abs(denominator) < 0.001) return;

    const a = (p0.x * (y1 - y2) + p1.x * (y2 - y0) + p2.x * (y0 - y1)) / denominator;
    const c = (p0.x * (x2 - x1) + p1.x * (x0 - x2) + p2.x * (x1 - x0)) / denominator;
    const e = (p0.x * (x1 * y2 - x2 * y1) + p1.x * (x2 * y0 - x0 * y2) + p2.x * (x0 * y1 - x1 * y0)) / denominator;
    const b = (p0.y * (y1 - y2) + p1.y * (y2 - y0) + p2.y * (y0 - y1)) / denominator;
    const d = (p0.y * (x2 - x1) + p1.y * (x0 - x2) + p2.y * (x1 - x0)) / denominator;
    const f = (p0.y * (x1 * y2 - x2 * y1) + p1.y * (x2 * y0 - x0 * y2) + p2.y * (x0 * y1 - x1 * y0)) / denominator;

    context.save();
    context.beginPath();
    context.moveTo(p0.x, p0.y);
    context.lineTo(p1.x, p1.y);
    context.lineTo(p2.x, p2.y);
    context.closePath();
    context.clip();
    context.setTransform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
    context.restore();
  }

  function renderSoftware() {
    if (!softwareContext || !renderCanvas.width || !renderCanvas.height) return;
    const context = softwareContext;
    const canvasWidth = renderCanvas.width;
    const canvasHeight = renderCanvas.height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#dfe3e8';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    if (!sourceImage || !softwareMesh) return;

    const { positions, indices, boundaryEdges, segmentsX, segmentsY, width, height } = softwareMesh;
    const scale = Math.min(canvasWidth / (width * 1.55), canvasHeight / (height * 1.55)) * softwareZoom;
    const focalLength = 5;
    const cosYaw = Math.cos(softwareYaw);
    const sinYaw = Math.sin(softwareYaw);
    const cosPitch = Math.cos(softwarePitch);
    const sinPitch = Math.sin(softwarePitch);
    const projected = new Array(positions.length / 3);
    const projectedBottom = new Array(projected.length);
    const viewDepth = new Float32Array(projected.length);

    for (let i = 0; i < projected.length; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const rotatedX = x * cosYaw + z * sinYaw;
      const rotatedZ = -x * sinYaw + z * cosYaw;
      const rotatedY = y * cosPitch - rotatedZ * sinPitch;
      const depthZ = y * sinPitch + rotatedZ * cosPitch;
      const perspective = focalLength / (focalLength - depthZ);
      projected[i] = {
        x: canvasWidth / 2 + rotatedX * scale * perspective,
        y: canvasHeight / 2 - rotatedY * scale * perspective,
        z: depthZ,
        source: [
          (i % (segmentsX + 1)) * sourceImage.naturalWidth / segmentsX,
          Math.floor(i / (segmentsX + 1)) * sourceImage.naturalHeight / segmentsY,
        ],
      };
      const bottomZ = -thickness;
      const bottomX = x * cosYaw + bottomZ * sinYaw;
      const bottomRotatedZ = -x * sinYaw + bottomZ * cosYaw;
      const bottomY = y * cosPitch - bottomRotatedZ * sinPitch;
      const bottomDepth = y * sinPitch + bottomRotatedZ * cosPitch;
      const bottomPerspective = focalLength / (focalLength - bottomDepth);
      projectedBottom[i] = {
        x: canvasWidth / 2 + bottomX * scale * bottomPerspective,
        y: canvasHeight / 2 - bottomY * scale * bottomPerspective,
      };
      viewDepth[i] = depthZ;
    }

    context.fillStyle = '#39424c';
    for (const [a, b] of boundaryEdges) {
      context.beginPath();
      context.moveTo(projected[a].x, projected[a].y);
      context.lineTo(projected[b].x, projected[b].y);
      context.lineTo(projectedBottom[b].x, projectedBottom[b].y);
      context.lineTo(projectedBottom[a].x, projectedBottom[a].y);
      context.closePath();
      context.fill();
    }

    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      triangles.push({ a, b, c, z: (viewDepth[a] + viewDepth[b] + viewDepth[c]) / 3 });
    }
    triangles.sort((a, b) => a.z - b.z);
    for (const triangle of triangles) {
      mapTextureTriangle(context, materialImage, [
        projected[triangle.a],
        projected[triangle.b],
        projected[triangle.c],
      ]);
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.beginPath();
    boundaryEdges.forEach(([a, b]) => {
      context.moveTo(projected[a].x, projected[a].y);
      context.lineTo(projected[b].x, projected[b].y);
    });
    context.strokeStyle = '#47525e';
    context.lineWidth = Math.max(2, canvasWidth / 500);
    context.stroke();
  }

  function setupSoftwareControls() {
    renderCanvas.addEventListener('pointerdown', (event) => {
      softwareDrag = { x: event.clientX, y: event.clientY };
      renderCanvas.setPointerCapture(event.pointerId);
    });
    renderCanvas.addEventListener('pointermove', (event) => {
      if (!softwareDrag) return;
      const rect = renderCanvas.getBoundingClientRect();
      softwareYaw += (event.clientX - softwareDrag.x) / rect.width * Math.PI * 2;
      softwarePitch = clamp(softwarePitch + (event.clientY - softwareDrag.y) / rect.height * Math.PI, -1.35, 1.35);
      softwareDrag = { x: event.clientX, y: event.clientY };
      renderSoftware();
    });
    const endDrag = () => { softwareDrag = null; };
    renderCanvas.addEventListener('pointerup', endDrag);
    renderCanvas.addEventListener('pointercancel', endDrag);
    renderCanvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      softwareZoom = clamp(softwareZoom * (event.deltaY < 0 ? 1.1 : 0.9), 0.6, 2.5);
      renderSoftware();
    }, { passive: false });
  }

  function buildModel(image) {
    clearModel();
    if (materialSourceImage !== image || materialFinish !== finish || materialTint !== tint) {
      materialImage = createMaterialImage(image);
      materialSourceImage = image;
      materialFinish = finish;
      materialTint = tint;
    }
    if (!renderer) buildSoftwareMesh(image);
    texture = materialImage === image
      ? new THREE.Texture(image)
      : new THREE.CanvasTexture(materialImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    imageMaterial.map = texture;
    imageMaterial.roughness = finish === 'bronze' ? 0.42 : finish === 'stone' ? 0.96 : 0.82;
    imageMaterial.metalness = finish === 'bronze' ? 0.58 : 0;
    imageMaterial.needsUpdate = true;
    backMaterial.color.set(finish === 'bronze' ? '#4a2d18' : finish === 'stone' ? '#4b4945' : '#4d5660');

    const aspect = image.naturalWidth / image.naturalHeight;
    const segmentsX = Math.max(20, Math.round(detail * Math.min(aspect, 1)));
    const segmentsY = Math.max(20, Math.round(detail * Math.min(1 / aspect, 1)));
    const width = 2.8 * Math.min(aspect, 1);
    const height = 2.8 * Math.min(1 / aspect, 1);
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = segmentsX + 1;
    sampleCanvas.height = segmentsY + 1;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const surfaceLuminance = smoothSurfaceLuminance(pixels, segmentsX + 1, segmentsY + 1);

    const columns = segmentsX + 1;
    const rows = segmentsY + 1;
    const surfaceDepth = buildSurfaceDepth(depthMap, surfaceLuminance, pixels, columns, rows);
    const positions = new Float32Array(columns * rows * 3);
    const uvs = new Float32Array(columns * rows * 2);
    const bottomZ = -thickness;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const index = y * columns + x;
        const depthValue = surfaceDepth[index];
        const reliefDepth = invert ? 1 - depthValue : depthValue;
        const reliefHeight = (0.1 + reliefDepth * 0.8) * depth;
        positions[index * 3] = (x / segmentsX - 0.5) * width;
        positions[index * 3 + 1] = (0.5 - y / segmentsY) * height;
        positions[index * 3 + 2] = reliefHeight;
        uvs[index * 2] = x / segmentsX;
        uvs[index * 2 + 1] = 1 - y / segmentsY;

      }
    }
    const indices = buildSurfaceIndices(pixels, columns, segmentsY + 1);
    if (!indices.length) throw new Error('The isolated image does not contain a visible object.');

    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    surfaceGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    surfaceGeometry.setIndex(indices);
    surfaceGeometry.computeVertexNormals();

    const surface = new THREE.Mesh(surfaceGeometry, imageMaterial);
    surface.name = 'FrescoThing image relief surface';
    model.add(surface);
    modelParts.push(surface);

    const boundary = findOuterBoundaryEdges(indices, columns);
    const sidePositions = new Float32Array(boundary.length * 4 * 3);
    const sideIndices = [];
    boundary.forEach(([vertexIndex, nextVertexIndex], edgeIndex) => {
      const currentOffset = vertexIndex * 3;
      const nextOffset = nextVertexIndex * 3;
      const offset = edgeIndex * 12;
      sidePositions.set(positions.subarray(currentOffset, currentOffset + 3), offset);
      sidePositions.set(positions.subarray(nextOffset, nextOffset + 3), offset + 3);
      sidePositions.set([positions[nextOffset], positions[nextOffset + 1], bottomZ], offset + 6);
      sidePositions.set([positions[currentOffset], positions[currentOffset + 1], bottomZ], offset + 9);
      const base = edgeIndex * 4;
      sideIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });

    const sidesGeometry = new THREE.BufferGeometry();
    sidesGeometry.setAttribute('position', new THREE.BufferAttribute(sidePositions, 3));
    sidesGeometry.setIndex(sideIndices);
    sidesGeometry.computeVertexNormals();
    const sides = new THREE.Mesh(sidesGeometry, sideMaterial);
    sides.name = 'Relief outer edge';
    model.add(sides);
    modelParts.push(sides);

    const backPositions = positions.slice();
    for (let index = 2; index < backPositions.length; index += 3) backPositions[index] = bottomZ;
    const backIndices = [];
    for (let index = 0; index < indices.length; index += 3) {
      backIndices.push(indices[index], indices[index + 2], indices[index + 1]);
    }
    const backGeometry = new THREE.BufferGeometry();
    backGeometry.setAttribute('position', new THREE.BufferAttribute(backPositions, 3));
    backGeometry.setIndex(backIndices);
    backGeometry.computeVertexNormals();
    const back = new THREE.Mesh(backGeometry, backMaterial);
    back.name = 'Relief backing';
    model.add(back);
    modelParts.push(back);

    model.scale.setScalar(1);
    if (controlsTarget) {
      controlsTarget.set(0, 0, 0);
      controls.update();
    } else {
      renderSoftware();
    }
  }

  function loadImage(url) {
    const version = ++loadVersion;
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (destroyed || version !== loadVersion) {
          resolve(false);
          return;
        }
        sourceImage = image;
        try {
          buildModel(image);
          resolve(true);
        } catch (error) {
          onError(error.message);
          reject(error);
        }
      };
      image.onerror = () => {
        const error = new Error('Could not load the image for 3D relief.');
        onError(error.message);
        reject(error);
      };
      image.src = url;
    });
  }

  function setOptions(options) {
    if (options.depth !== undefined) depth = clamp(Number(options.depth), 0.05, 0.9);
    if (options.thickness !== undefined) thickness = clamp(Number(options.thickness), 0.04, 0.45);
    if (options.detail !== undefined) detail = clamp(Math.round(Number(options.detail)), 60, 210);
    if (options.invert !== undefined) invert = Boolean(options.invert);
    if (options.finish !== undefined && ['original', 'monochrome', 'bronze', 'stone'].includes(options.finish)) {
      finish = options.finish;
    }
    if (options.tint !== undefined && /^#[\da-f]{6}$/i.test(options.tint)) tint = options.tint.toLowerCase();
    if (sourceImage) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = 0;
        if (!destroyed && sourceImage) buildModel(sourceImage);
      }, 100);
    }
  }

  function setDepthMap(nextDepthMap) {
    if (nextDepthMap && (
      !nextDepthMap.values?.length
      || nextDepthMap.values.length !== nextDepthMap.width * nextDepthMap.height
      || !nextDepthMap.width
      || !nextDepthMap.height
    )) {
      throw new Error('The estimated depth map is invalid.');
    }
    depthMap = nextDepthMap;
    if (sourceImage) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = 0;
        if (!destroyed && sourceImage) buildModel(sourceImage);
      }, 0);
    }
  }

  function exportGlb() {
    if (!sourceImage || !model.children.length) {
      throw new Error('Choose an image before exporting a 3D model.');
    }
    if (rebuildTimer) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = 0;
      buildModel(sourceImage);
    }
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(model, (result) => {
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'frescothing-relief.glb';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve(true);
      }, reject, { binary: true });
    });
  }

  function resetView() {
    if (renderer) {
      camera.position.set(0, -0.35, 4.8);
      controls.target.set(0, 0, 0);
      controls.update();
    } else {
      softwareYaw = -0.18;
      softwarePitch = 0.14;
      softwareZoom = 1;
      renderSoftware();
    }
  }

  function render() {
    if (destroyed) return;
    if (renderer) {
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    } else {
      renderSoftware();
    }
  }

  if (!renderer) setupSoftwareControls();
  resize();
  window.addEventListener('resize', resize);
  render();

  return {
    loadImage,
    setOptions,
    setDepthMap,
    exportGlb,
    resetView,
    resize,
    destroy() {
      destroyed = true;
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(frame);
      if (rebuildTimer) window.clearTimeout(rebuildTimer);
      if (controls) controls.dispose();
      clearModel();
      imageMaterial.dispose();
      sideMaterial.dispose();
      backMaterial.dispose();
      if (renderer) renderer.dispose();
    },
  };
}
