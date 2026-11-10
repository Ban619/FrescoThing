<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import './relief.css';

const props = defineProps({
  visible: Boolean,
  maximized: Boolean,
  previewUrl: { type: String, default: '' },
  imageName: { type: String, default: '' },
});

const reliefCanvasRef = ref(null);
const reliefFileRef = ref(null);
const reliefViewerRef = ref(null);
const reliefDepth = ref(0.42);
const reliefThickness = ref(0.16);
const reliefDetail = ref(150);
const reliefInvert = ref(false);
const reliefFinish = ref('original');
const reliefTint = ref('#ffffff');
const reliefBusy = ref(false);
const reliefDragOver = ref(false);
const reliefStageDragOver = ref(false);
const reliefImageName = ref('');
const reliefSourceUrl = ref('');
const reliefCroppedUrl = ref('');
const reliefStep = ref('empty');
const reliefError = ref('');
const reliefNotice = ref('');
const reliefFullImageFallback = ref(false);

let ownedReliefSourceUrl = '';
let reliefTaskVersion = 0;

const updateReliefOptions = () => {
  reliefViewerRef.value?.setOptions({
    depth: reliefDepth.value,
    thickness: reliefThickness.value,
    detail: reliefDetail.value,
    invert: reliefInvert.value,
    finish: reliefFinish.value,
    tint: reliefTint.value,
  });
};

const setReliefSource = async (url, name, owned = false) => {
  const taskVersion = ++reliefTaskVersion;
  if (ownedReliefSourceUrl && ownedReliefSourceUrl !== url) URL.revokeObjectURL(ownedReliefSourceUrl);
  ownedReliefSourceUrl = owned ? url : '';
  if (reliefCroppedUrl.value) URL.revokeObjectURL(reliefCroppedUrl.value);
  reliefSourceUrl.value = url;
  reliefImageName.value = name || 'Image';
  reliefCroppedUrl.value = '';
  reliefError.value = '';
  reliefNotice.value = '';
  reliefFullImageFallback.value = false;
  reliefStep.value = url ? 'cropping' : 'empty';
  reliefViewerRef.value?.destroy();
  reliefViewerRef.value = null;
  if (!url) return;

  await nextTick();
  try {
    const { isolateMainObject } = await import('./foreground.js').catch((error) => {
      throw new Error(`Could not load object isolation: ${error.message}`);
    });
    const { blob, usedFallback } = await isolateMainObject(url, (message) => {
      if (taskVersion === reliefTaskVersion) reliefNotice.value = message;
    });
    if (taskVersion !== reliefTaskVersion) return;
    reliefCroppedUrl.value = URL.createObjectURL(blob);
    reliefFullImageFallback.value = usedFallback;
    reliefStep.value = 'cropped';
    reliefNotice.value = usedFallback
      ? 'The model could not produce a reliable mask, so an automatic focus crop was used.'
      : 'Object isolated. Creating its 3D relief…';
    await nextTick();
    if (taskVersion === reliefTaskVersion) await createReliefModel();
  } catch (error) {
    if (taskVersion !== reliefTaskVersion) return;
    reliefStep.value = 'error';
    reliefError.value = error.message || 'Could not isolate the main object.';
  }
};

const handleReliefFile = (file) => {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    reliefError.value = 'Choose a JPG, PNG, or WebP image.';
    return;
  }
  setReliefSource(URL.createObjectURL(file), file.name, true);
};

const handleReliefFileSelection = (event) => {
  handleReliefFile(event.target.files?.[0]);
  event.target.value = '';
};

const createReliefModel = async () => {
  if (!reliefCroppedUrl.value || reliefStep.value !== 'cropped') return;
  const taskVersion = reliefTaskVersion;
  const cropUrl = reliefCroppedUrl.value;
  reliefError.value = '';
  reliefStep.value = 'creating';
  await nextTick();
  if (taskVersion !== reliefTaskVersion) return;
  try {
    let depthMap = null;
    try {
      const { estimateDepthMap } = await import('./depth-estimation.js');
      depthMap = await estimateDepthMap(cropUrl, (message) => {
        if (taskVersion === reliefTaskVersion) reliefNotice.value = message;
      });
    } catch (error) {
      if (taskVersion !== reliefTaskVersion) return;
      reliefNotice.value = `AI depth estimation was unavailable; using image-based depth instead. ${error.message}`;
    }
    if (taskVersion !== reliefTaskVersion) return;
    if (!reliefViewerRef.value) {
      const { createReliefViewer } = await import('./relief3d.js').catch((error) => {
        throw new Error(`Could not load the 3D viewer module: ${error.message}`);
      });
      if (taskVersion !== reliefTaskVersion) return;
      reliefViewerRef.value = createReliefViewer(reliefCanvasRef.value, (message) => {
        reliefError.value = message;
      }, (message) => {
        reliefNotice.value = message;
      });
    }
    reliefViewerRef.value.setDepthMap(depthMap);
    reliefViewerRef.value.resize();
    updateReliefOptions();
    await reliefViewerRef.value.loadImage(cropUrl);
    if (taskVersion !== reliefTaskVersion) return;
    if (depthMap) reliefNotice.value = 'AI relative depth estimated locally. Adjust depth or invert to refine this single-view relief.';
    reliefStep.value = 'ready';
  } catch (error) {
    if (taskVersion !== reliefTaskVersion) return;
    reliefStep.value = 'cropped';
    reliefError.value = error.message || 'Could not create the 3D relief.';
  }
};

const setReliefDepth = (event) => {
  reliefDepth.value = Number(event.target.value);
  updateReliefOptions();
};

const resetReliefSettings = () => {
  reliefDepth.value = 0.42;
  reliefThickness.value = 0.16;
  reliefDetail.value = 150;
  reliefInvert.value = false;
  reliefFinish.value = 'original';
  reliefTint.value = '#ffffff';
  updateReliefOptions();
};

const exportRelief = async () => {
  if (!reliefViewerRef.value || reliefStep.value !== 'ready') {
    reliefError.value = 'Create the 3D relief before exporting it.';
    return;
  }
  reliefError.value = '';
  reliefBusy.value = true;
  try {
    await reliefViewerRef.value.exportGlb();
  } catch (error) {
    reliefError.value = error.message || 'Could not export the 3D model.';
  } finally {
    reliefBusy.value = false;
  }
};

const resetReliefView = () => reliefViewerRef.value?.resetView();

watch(
  () => [props.visible, props.maximized, props.previewUrl, props.imageName],
  async ([visible, , previewUrl, imageName]) => {
    if (!visible) return;
    if (previewUrl && previewUrl !== reliefSourceUrl.value) {
      setReliefSource(previewUrl, imageName);
    }
    await nextTick();
    reliefViewerRef.value?.resize();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  reliefTaskVersion++;
  reliefViewerRef.value?.destroy();
  if (ownedReliefSourceUrl) URL.revokeObjectURL(ownedReliefSourceUrl);
  if (reliefCroppedUrl.value) URL.revokeObjectURL(reliefCroppedUrl.value);
});
</script>

<template>
  <section id="relief-panel" class="tab-panel relief-panel">
    <div class="relief-heading">
      <div>
        <p class="relief-eyebrow">IMAGE TO 3D</p>
        <h2>Turn an image into a 3D object</h2>
        <p>FrescoThing analyzes the image, isolates the main object, then builds its 3D relief.</p>
      </div>
      <span class="relief-state">Ban</span>
    </div>

    <div class="relief-workspace">
      <aside class="relief-sidebar" aria-label="Relief settings">
        <section class="relief-card">
          <h3>Source image</h3>
          <button
            class="relief-image-picker"
            :class="{ 'relief-image-picker-dragging': reliefDragOver }"
            @click="reliefFileRef?.click()"
            @dragover.prevent="reliefDragOver = true"
            @dragleave.prevent="reliefDragOver = false"
            @drop.stop.prevent="reliefDragOver = false; handleReliefFile($event.dataTransfer?.files?.[0])"
          >
            <img v-if="reliefCroppedUrl || reliefSourceUrl" :src="reliefCroppedUrl || reliefSourceUrl" alt="" />
            <span v-else class="relief-image-icon" aria-hidden="true">+</span>
            <span class="relief-image-copy">
              <strong>{{ reliefSourceUrl ? reliefImageName : 'Choose or drop an image' }}</strong>
              <small>
                {{
                  reliefStep === 'cropping' ? 'Finding the main object…' :
                  reliefStep === 'cropped' || reliefStep === 'ready' ? (reliefFullImageFallback ? 'Automatic focus crop · click to replace' : 'Main object isolated · click to replace') :
                  'JPG, PNG, or WebP · stays on this PC'
                }}
              </small>
            </span>
          </button>
          <input
            ref="reliefFileRef"
            class="relief-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="handleReliefFileSelection($event)"
          />
        </section>

        <section v-if="reliefSourceUrl" class="relief-card">
          <div class="relief-card-heading">
            <h3>Surface depth</h3>
            <output for="relief-depth">{{ Number(reliefDepth).toFixed(2) }}</output>
          </div>
          <input
            id="relief-depth"
            class="relief-depth-slider"
            type="range"
            min="0.05"
            max="0.9"
            step="0.01"
            :value="reliefDepth"
            :disabled="reliefStep === 'empty' || reliefStep === 'cropping'"
            @input="setReliefDepth($event)"
          />
          <div class="relief-range-labels"><span>Subtle</span><span>Deep</span></div>
          <label class="relief-invert">
            <input v-model="reliefInvert" type="checkbox" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @change="updateReliefOptions" />
            <span><strong>Invert height</strong><small>Raise dark areas instead</small></span>
          </label>
        </section>

        <details v-if="reliefSourceUrl" class="relief-card relief-custom-settings" open>
          <summary>Customize the 3D model</summary>
          <label class="relief-setting">
            <span>Model thickness <output>{{ Number(reliefThickness).toFixed(2) }}</output></span>
            <input v-model.number="reliefThickness" type="range" min="0.04" max="0.45" step="0.01" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @input="updateReliefOptions" />
          </label>
          <label class="relief-setting">
            <span>Surface detail</span>
            <select v-model.number="reliefDetail" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @change="updateReliefOptions">
              <option :value="60">Low · faster</option>
              <option :value="100">Medium</option>
              <option :value="150">High</option>
              <option :value="210">Ultra · more polygons</option>
            </select>
          </label>
          <label class="relief-setting">
            <span>Surface finish</span>
            <select v-model="reliefFinish" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @change="updateReliefOptions">
              <option value="original">Original image</option>
              <option value="monochrome">Monochrome</option>
              <option value="bronze">Bronze</option>
              <option value="stone">Stone</option>
            </select>
          </label>
          <label class="relief-setting relief-tint-setting">
            <span>Finish tint</span>
            <input v-model="reliefTint" type="color" aria-label="Custom relief finish tint" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @input="updateReliefOptions" />
          </label>
          <button class="relief-reset-settings" :disabled="reliefStep === 'empty' || reliefStep === 'cropping'" @click="resetReliefSettings">Reset model settings</button>
        </details>

        <p v-if="reliefSourceUrl && reliefNotice" class="relief-notice" role="status">{{ reliefNotice }}</p>
        <p v-if="reliefSourceUrl && reliefError" class="err" role="alert">{{ reliefError }}</p>

        <div v-if="reliefStep === 'ready'" class="relief-actions">
          <button class="relief-export" :disabled="reliefBusy" @click="exportRelief">
            {{ reliefBusy ? 'Preparing model…' : 'Export 3D model' }}
          </button>
          <button class="relief-reset" @click="resetReliefView">Reset view</button>
        </div>
        <p v-if="reliefSourceUrl" class="relief-privacy">First use downloads the model; your image stays on this device.</p>
      </aside>

      <section
        class="relief-stage"
        :class="{ 'relief-stage-dragging': reliefStageDragOver }"
        aria-label="3D relief preview"
        @dragover.prevent="reliefStageDragOver = true"
        @dragleave.self.prevent="reliefStageDragOver = false"
        @drop.stop.prevent="reliefStageDragOver = false; handleReliefFile($event.dataTransfer?.files?.[0])"
      >
        <div class="relief-stage-bar">
          <strong>{{ reliefStep === 'cropped' ? (reliefFullImageFallback ? 'Automatic crop preview' : 'Object crop preview') : '3D preview' }}</strong>
          <span v-if="reliefStep === 'ready'">Drag to orbit <i aria-hidden="true">·</i> Scroll to zoom</span>
        </div>
        <div v-if="reliefStep === 'cropped'" class="relief-crop-review">
          <div class="relief-crop-image"><img :src="reliefCroppedUrl" :alt="reliefFullImageFallback ? 'Automatic focus crop used when precise object isolation was unavailable' : 'Automatically isolated main object'" /></div>
          <strong>{{ reliefFullImageFallback ? 'Automatic focus crop ready' : 'Main object isolated' }}</strong>
          <span>{{ reliefError ? 'The image is ready, but 3D generation needs another try.' : (reliefFullImageFallback ? 'Precise object isolation was unavailable, so the image was automatically cropped around its central subject.' : 'Background removed and crop tightened. Building the 3D relief…') }}</span>
          <span v-if="!reliefError" class="relief-spinner" role="status" aria-label="Creating 3D relief" />
          <button v-else @click="createReliefModel">Retry 3D generation</button>
        </div>
        <div v-else-if="reliefStep === 'creating' || reliefStep === 'ready'" class="relief-viewer">
          <canvas ref="reliefCanvasRef" aria-label="Interactive 3D image relief" />
          <div v-if="reliefStep === 'creating'" class="relief-generating" role="status">
            <span class="relief-spinner" aria-hidden="true" />
            <strong>Building the 3D relief…</strong>
          </div>
        </div>
        <div v-else class="relief-placeholder">
          <span v-if="reliefStep !== 'cropping'" class="relief-placeholder-icon" aria-hidden="true">◇</span>
          <span v-else class="relief-spinner" aria-hidden="true" />
          <strong>
            {{
              reliefStep === 'cropping' ? 'Automatically isolating the main object…' :
              reliefStep === 'error' ? 'Could not process this image' :
              'Choose an image to isolate its main object'
            }}
          </strong>
          <span>
            {{
              reliefStep === 'cropping' ? 'Analyzing the image and isolating its main object.' :
              reliefStep === 'error' ? reliefError :
              'Drop an image here or choose one. The object will be cropped before its relief is created.'
            }}
          </span>
          <button v-if="reliefStep !== 'cropping'" @click="reliefFileRef?.click()">Choose an image</button>
        </div>
      </section>
    </div>
  </section>
</template>
