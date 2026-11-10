<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import './painting.css';
import { createPainter } from './engine.js';
import ReliefPanel from '../3D/ReliefPanel.vue';

const FINISHES = [
  ['impasto', 'Oil / Impasto'],
  ['watercolor', 'Watercolor'],
  ['impressionist', 'Impressionist'],
  ['knife', 'Palette knife'],
  ['gouache', 'Gouache'],
  ['sketch', 'Pencil sketch'],
  ['pointillism', 'Pointillism'],
  ['inkwash', 'Ink wash (sumi-e)'],
  ['pastel', 'Soft pastel'],
  ['poster', 'Posterize / pop-art'],
  ['mosaic', 'Mosaic'],
  ['pixel', 'Pixel art'],
  ['acrylic', 'Acrylic'],
  ['charcoal', 'Charcoal'],
  ['flow', 'Flow lines'],
  ['sculpt', 'Sculpted oil'],
  ['dagger', 'Dagger taper'],
  ['stamp', 'Leaf stamps'],
];
const DETAIL_NAMES = { 1: 'Draft', 2: 'Medium', 3: 'Fine', 4: 'High', 5: 'Museum', 6: 'Gallery', 7: 'Masterwork' };

const paintRef = ref(null);
const overlayRef = ref(null);
const fileRef = ref(null);
const previewUrl = ref('');
const painterRef = ref(null);
const bytesRef = ref(null);
const workerRef = ref(null);

const ocrPhase = ref('');
const ready = ref(false);
const prog = ref({ drawn: 0, total: 0, playing: false, secs: 0, like: 0 });
const plan = ref('Drop Image');
const style = ref('impasto');
const backend = ref('natural');
const detail = ref(4);
const speed = ref(160);
const target = ref(85);
const quality = ref('balanced');
const psm = ref('3');
const contrast = ref(true);
const ocrLang = ref('eng');
const lines = ref([]);
const ocrBusy = ref(false);
const ocrError = ref('');
const showBoxes = ref(true);
const minned = ref(false);
const maxed = ref(false);
const reliefMinned = ref(true);
const reliefMaxed = ref(false);
const frontWindow = ref('painting');
const windowRef = ref(null);
const reliefWindowRef = ref(null);
const windowOffset = ref({ x: 0, y: 0 });
const reliefWindowOffset = ref({ x: 0, y: 0 });
const clockTime = ref('');
const clockDate = ref('');
const trayClockTime = ref('');
const trayClockDate = ref('');
const loadedImageName = ref('');
const windowStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate(${windowOffset.value.x}px, ${windowOffset.value.y}px)`,
}));
const reliefWindowStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate(${reliefWindowOffset.value.x}px, ${reliefWindowOffset.value.y}px)`,
}));
const pct = computed(() => (prog.value.total ? (100 * prog.value.drawn) / prog.value.total : 0));

let keyHandler = null;
let dragStart = null;
let clockTimer = null;

const openReliefWindow = async () => {
  reliefMinned.value = false;
  frontWindow.value = 'relief';
};

const showWindow = async (name) => {
  frontWindow.value = name;
  if (name === 'painting') {
    minned.value = false;
    return;
  }
  await openReliefWindow();
};

const toggleTaskbarWindow = (name) => {
  const isMinimized = name === 'painting' ? minned.value : reliefMinned.value;
  if (isMinimized || frontWindow.value !== name) {
    showWindow(name);
  } else if (name === 'painting') {
    minned.value = true;
  } else {
    reliefMinned.value = true;
    if (!minned.value) frontWindow.value = 'painting';
  }
};

const closeReliefWindow = () => {
  reliefMinned.value = true;
  if (frontWindow.value === 'relief' && !minned.value) frontWindow.value = 'painting';
};

const closePaintingWindow = () => {
  minned.value = true;
  if (frontWindow.value === 'painting' && !reliefMinned.value) frontWindow.value = 'relief';
};

const updateClock = () => {
  const now = new Date();
  clockTime.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  clockDate.value = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  trayClockTime.value = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).formatToParts(now);
  const datePart = (type) => dateParts.find((part) => part.type === type)?.value;
  trayClockDate.value = `${datePart('day')}-${datePart('month')}-${datePart('year')}`;
};

const startWindowDrag = (event, name) => {
  const isMaxed = name === 'painting' ? maxed.value : reliefMaxed.value;
  const targetWindow = name === 'painting' ? windowRef.value : reliefWindowRef.value;
  if (event.button !== 0 || isMaxed || event.target.closest('.title-bar-controls')) return;
  frontWindow.value = name;
  const rect = targetWindow.getBoundingClientRect();
  const offset = name === 'painting' ? windowOffset.value : reliefWindowOffset.value;
  dragStart = {
    name,
    pointerX: event.clientX,
    pointerY: event.clientY,
    offsetX: offset.x,
    offsetY: offset.y,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  };
  event.preventDefault();
};

const moveWindow = (event) => {
  if (!dragStart) return;
  const deltaX = event.clientX - dragStart.pointerX;
  const deltaY = event.clientY - dragStart.pointerY;
  const minX = 80 - dragStart.right;
  const maxX = window.innerWidth - 80 - dragStart.left;
  const minY = 32 - dragStart.bottom;
  const maxY = window.innerHeight - 48 - dragStart.top;
  const offset = {
    x: Math.min(maxX, Math.max(minX, dragStart.offsetX + deltaX)),
    y: Math.min(maxY, Math.max(minY, dragStart.offsetY + deltaY)),
  };
  if (dragStart.name === 'painting') windowOffset.value = offset;
  else reliefWindowOffset.value = offset;
};

const stopWindowDrag = () => {
  dragStart = null;
};

const toggleMaximize = () => {
  maxed.value = !maxed.value;
};

const toggleReliefMaximize = () => {
  reliefMaxed.value = !reliefMaxed.value;
};

const syncCfg = (patch, restart) => {
  const p = painterRef.value;
  if (!p) return;
  Object.assign(p.cfg, patch);
  if (restart && p.hasJob) p.restart();
};

const drawOverlay = () => {
  const ov = overlayRef.value;
  const paint = paintRef.value;
  if (!ov || !paint) return;
  const g = ov.getContext('2d');
  g.clearRect(0, 0, ov.width, ov.height);
  if (!showBoxes.value || !lines.value.length) return;

  const found = lines.value;
  const sx = ov.width / (found.pageW || 1);
  const sy = ov.height / (found.pageH || 1);
  g.lineWidth = Math.max(2, ov.width / 400);

  found.forEach((ln, idx) => {
    g.strokeStyle = idx % 2 ? '#1f5f9f' : '#c73b3b';
    g.beginPath();
    ln.box.forEach((pt, i) => {
      const X = pt.x * sx;
      const Y = pt.y * sy;
      if (i === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    });
    g.closePath();
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.font = `600 ${Math.max(11, ov.width / 60)}px "Segoe UI", Tahoma, sans-serif`;
    g.fillText(`${idx + 1}`, ln.box[0].x * sx + 3, ln.box[0].y * sy - 4);
  });
};

const loadFile = async (f) => {
  if (!f || !f.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }

  let bytes;
  try {
    bytes = new Uint8Array(await f.arrayBuffer());
  } catch {
    alert('Could not read that image.');
    return;
  }

  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });

    const { w, h } = await painterRef.value.loadImage(img);
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = url;
    loadedImageName.value = f.name;
    bytesRef.value = bytes;
    lines.value = [];
    ocrError.value = '';
    const ov = overlayRef.value;
    ov.width = w;
    ov.height = h;
    ov.getContext('2d').clearRect(0, 0, w, h);
  } catch {
    URL.revokeObjectURL(url);
    alert('Could not read that image.');
  }
};

const ocrBytes = async () => {
  if (!bytesRef.value) return null;

  const blob0 = new Blob([bytesRef.value], { type: 'image/png' });
  try {
    const bmp = await createImageBitmap(blob0);
    const m = Math.max(bmp.width, bmp.height);
    const sc = m >= 1200 ? 1 : 1200 / m;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * sc));
    c.height = Math.max(1, Math.round(bmp.height * sc));
    const g = c.getContext('2d');
    if (contrast.value) g.filter = 'grayscale(1) contrast(1.35)';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    if (sc === 1 && !contrast.value) return blob0;
    return await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  } catch {
    return blob0;
  }
};

async function getWorker() {
  if (workerRef.value) return workerRef.value;
  if (!window.Tesseract) throw new Error('OCR engine failed to load (needs internet once)');

  ocrPhase.value = 'loading';
  const langs = ocrLang.value.includes('+') ? ocrLang.value.split('+') : ocrLang.value;
  const w = await window.Tesseract.createWorker(langs);
  workerRef.value = w;
  return w;
}

watch(ocrLang, () => {
  if (!workerRef.value) return;
  workerRef.value.terminate().catch(() => {});
  workerRef.value = null;
});

watch([lines, showBoxes], drawOverlay, { deep: true });

const readText = async () => {
  if (!bytesRef.value) {
    alert('Drop a photo first.');
    return;
  }

  ocrBusy.value = true;
  ocrError.value = '';
  ocrPhase.value = 'reading';

  let url = null;
  try {
    const worker = await getWorker();
    const blob = await ocrBytes();
    url = URL.createObjectURL(blob);

    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });

    try {
      await worker.setParameters({ tessedit_pageseg_mode: Number(psm.value) });
    } catch {
      // keep defaults
    }

    const { data } = await worker.recognize(img);
    URL.revokeObjectURL(url);
    url = null;

    const items = (data.lines || [])
      .map((l) => {
        const b = l.bbox || {};
        const x0 = b.x0 ?? 0;
        const y0 = b.y0 ?? 0;
        const x1 = b.x1 ?? x0;
        const y1 = b.y1 ?? y0;
        return {
          text: l.text,
          conf: (l.confidence || 0) / 100,
          box: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
        };
      })
      .filter((l) => l.text.trim());

    items.pageW = img.naturalWidth || 1;
    items.pageH = img.naturalHeight || 1;
    lines.value = items;

    if (!items.length) {
      ocrError.value = 'No text found in this photo.';
    }
  } catch (err) {
    if (url) URL.revokeObjectURL(url);
    ocrError.value = `OCR failed: ${err.message}`;
  } finally {
    ocrBusy.value = false;
    ocrPhase.value = '';
  }
};

const handleFileSelection = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  loadFile(file);
  event.target.value = '';
};

const handleDrop = (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
};

const togglePlayback = () => {
  if (!painterRef.value) return;
  if (prog.value.playing) painterRef.value.pause();
  else painterRef.value.resume();
};

const restartPainting = () => {
  if (painterRef.value) painterRef.value.restart();
};

const finishPainting = () => {
  if (painterRef.value) painterRef.value.finish();
};

const exportPng = () => {
  if (painterRef.value) painterRef.value.exportPNG();
};

const exportSvg = () => {
  if (painterRef.value) painterRef.value.exportSVG();
};

const setLikeness = (event) => {
  const value = Number(event.target.value);
  target.value = value;
  if (painterRef.value) painterRef.value.setTarget(value);
};

onMounted(() => {
  const p = createPainter(paintRef.value, {
    onProgress: (s) => {
      prog.value = s;
    },
    onPlan: (s) => {
      plan.value = s;
    },
  });

  painterRef.value = p;
  p.boot();
  ready.value = true;
  updateClock();
  clockTimer = window.setInterval(updateClock, 30000);

  keyHandler = (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (painterRef.value) {
        if (prog.value.playing) painterRef.value.pause();
        else painterRef.value.resume();
      }
    }
    if (e.key === 'f' || e.key === 'F') {
      if (painterRef.value) painterRef.value.finish();
    }
  };

  window.addEventListener('keydown', keyHandler);
  window.addEventListener('pointermove', moveWindow);
  window.addEventListener('pointerup', stopWindowDrag);
  window.addEventListener('pointercancel', stopWindowDrag);
});

onBeforeUnmount(() => {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  window.removeEventListener('pointermove', moveWindow);
  window.removeEventListener('pointerup', stopWindowDrag);
  window.removeEventListener('pointercancel', stopWindowDrag);
  if (clockTimer) window.clearInterval(clockTimer);
  if (painterRef.value) painterRef.value.destroy();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>

<template>
  <div class="desktop">
    <div class="desktop-workspace">
    <section class="desktop-clock" aria-label="Current date and time">
      <time class="desktop-clock-time" :datetime="new Date().toISOString()">{{ clockTime }}</time>
      <time class="desktop-clock-date">{{ clockDate }}</time>
    </section>

    <div
      ref="windowRef"
      v-show="!minned"
      class="window glass active app-window"
      :class="{ 'window-maximized': maxed, 'window-front': frontWindow === 'painting' }"
      :style="windowStyle"
      @pointerdown="frontWindow = 'painting'"
    >
      <div
        class="title-bar app-title-bar"
        @pointerdown="startWindowDrag($event, 'painting')"
        @click="frontWindow = 'painting'"
        @dblclick="toggleMaximize"
      >
        <div class="title-bar-text">FrescoThing — Painting</div>
        <div class="title-bar-controls" @dblclick.stop>
          <button aria-label="Minimize" @click="minned = true" />
          <button :aria-label="maxed ? 'Restore' : 'Maximize'" @click="toggleMaximize" />
          <button aria-label="Close" @click="closePaintingWindow" />
        </div>
      </div>

      <div class="window-body has-space">
        <section
          id="painting-panel"
          class="tab-panel"
        >
        <div class="hp-grid">
          <div>
            <fieldset>
              <legend>Photo</legend>
              <div class="field-row" style="margin-top: 8px;">
                <button @click="readText" :disabled="ocrBusy || !ready">
                  {{ ocrBusy ? (ocrPhase === 'loading' ? 'Loading OCR engine…' : 'Reading…') : 'Read text (OCR)' }}
                </button>
              </div>
              <div v-if="ocrError" class="err">{{ ocrError }}</div>
              <div class="field-row" style="margin-top: 6px;">
                <input id="showboxes" v-model="showBoxes" type="checkbox" />
                <label for="showboxes">Show text boxes</label>
              </div>
              <div class="field-row" style="margin-top: 6px;">
                <label for="psm">OCR mode</label>
                <select id="psm" :value="psm" @change="psm = $event.target.value">
                  <option value="3">Auto layout</option>
                  <option value="6">Uniform block</option>
                  <option value="11">Sparse text</option>
                </select>
              </div>
              <div class="field-row" style="margin-top: 6px;">
                <input id="ocrcontrast" v-model="contrast" type="checkbox" />
                <label for="ocrcontrast">Contrast cleanup</label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Text found {{ lines.length ? `(${lines.length})` : '' }}</legend>
              <div class="lines">
                <div v-if="!lines.length" class="dim">Press “Read text (OCR)” after loading a photo.</div>
                <div v-for="(line, index) in lines" :key="index" class="line">
                  <span class="n">{{ index + 1 }}</span>
                  <span class="t">{{ line.text }}</span>
                  <span class="c">{{ Math.round(line.conf * 100) }}%</span>
                </div>
              </div>
              <div
                v-if="previewUrl"
                class="image-preview"
                role="button"
                tabindex="0"
                aria-label="Change image"
                @click="fileRef?.click()"
                @keydown.enter.prevent="fileRef?.click()"
                @keydown.space.prevent="fileRef?.click()"
                @dragover.prevent
                @drop.prevent="handleDrop($event)"
              >
                <img :src="previewUrl" alt="Selected image preview" />
                <span>Click or drop to change image</span>
              </div>
              <div
                v-else
                class="drop"
                role="button"
                tabindex="0"
                @click="fileRef?.click()"
                @keydown.enter.prevent="fileRef?.click()"
                @keydown.space.prevent="fileRef?.click()"
                @dragover.prevent
                @drop.prevent="handleDrop($event)"
              >
                <b>Drag &amp; drop</b> or click to choose<br />JPG / PNG / WebP — stays on this PC
              </div>
              <input
                ref="fileRef"
                type="file"
                accept="image/*"
                style="display: none;"
                @change="handleFileSelection($event)"
              />
            </fieldset>
          </div>

          <div>
            <fieldset>
              <legend>Canvas</legend>
              <fieldset class="mini-style-panel">
                <legend>Style</legend>
                <div class="mini-style-scroll">
                  <div class="mini-style-row">
                    <div class="mini-row">
                      <label for="canvas-quality">Quality</label>
                      <select id="canvas-quality" :value="quality" @change="quality = $event.target.value; syncCfg({ quality: $event.target.value }, true)">
                        <option value="fast">Fast (768px)</option>
                        <option value="balanced">Balanced (1024px)</option>
                        <option value="high">High (1536px)</option>
                        <option value="ultra">Ultra (2048px)</option>
                      </select>
                    </div>
                    <div class="mini-row">
                      <label for="canvas-finish">Finish</label>
                      <select id="canvas-finish" :value="style" @change="style = $event.target.value; syncCfg({ style: $event.target.value }, true)">
                        <option v-for="[value, label] in FINISHES" :key="value" :value="value">{{ label }}</option>
                      </select>
                    </div>
                    <div class="mini-row">
                      <label for="canvas-brush">Brush</label>
                      <select id="canvas-brush" :value="backend" @change="backend = $event.target.value; syncCfg({ backend: $event.target.value }, true)">
                        <option value="natural">Natural (p5.brush)</option>
                        <option value="classic">Classic (Canvas2D)</option>
                      </select>
                    </div>
                    <div class="mini-row">
                      <label for="canvas-detail">Detail ({{ DETAIL_NAMES[detail] }})</label>
                      <input id="canvas-detail" type="range" min="1" max="7" step="1" :value="detail" @input="detail = Number($event.target.value); syncCfg({ detail: Number($event.target.value) }, true)" />
                    </div>
                    <div class="mini-row">
                      <label for="canvas-speed">Speed ({{ speed }})</label>
                      <input id="canvas-speed" type="range" min="20" max="600" step="10" :value="speed" @input="speed = Number($event.target.value); syncCfg({ speed: Number($event.target.value) }, false)" />
                    </div>
                    <div class="mini-row">
                      <label for="canvas-like">Likeness ({{ target }}%)</label>
                      <input id="canvas-like" type="range" min="70" max="98" step="1" :value="target" @input="setLikeness($event)" />
                    </div>
                  </div>
                </div>
              </fieldset>
              <div class="planline">{{ plan }}</div>
              <div class="sunken-panel" style="padding: 4px;">
                <div class="stack">
                  <canvas ref="paintRef" id="paint" width="1024" height="768" />
                  <canvas ref="overlayRef" class="overlay" width="1024" height="768" />
                </div>
              </div>
              <div class="field-row" style="margin-top: 8px; flex-wrap: wrap; gap: 6px;">
                <button @click="togglePlayback">{{ prog.playing ? 'Pause' : 'Resume' }}</button>
                <button @click="restartPainting">Restart</button>
                <button @click="finishPainting">Finish</button>
                <button @click="exportPng">Save PNG</button>
                <button @click="exportSvg">Save SVG</button>
                <span class="kbdhint">Space = pause / resume</span>
              </div>
              <div role="progressbar" class="animate" style="margin-top: 8px;">
                <div :style="{ width: pct + '%' }" />
              </div>
            </fieldset>
          </div>
        </div>
        </section>
      </div>

      <div class="status-bar">
        <p class="status-bar-field" style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          {{ prog.playing ? 'Painting' : 'Ready' }} — {{ prog.drawn.toLocaleString() }} / {{ prog.total.toLocaleString() }} strokes
        </p>
        <p class="status-bar-field">local only · OCR on this PC{{ prog.secs ? ` · done in ${prog.secs.toFixed(1)}s · likeness ${prog.like}%` : '' }}</p>
        <p class="status-bar-field">made by <a href="https://www.instagram.com/bancansustain/" target="_blank" rel="noreferrer">@bancansustain</a> · <a href="https://github.com/Ban619" target="_blank" rel="noreferrer">GitHub</a></p>
      </div>
    </div>

    <div
      ref="reliefWindowRef"
      v-show="!reliefMinned"
      class="window glass active app-window relief-app-window"
      :class="{ 'window-maximized': reliefMaxed, 'window-front': frontWindow === 'relief' }"
      :style="reliefWindowStyle"
      @pointerdown="frontWindow = 'relief'"
    >
      <div
        class="title-bar app-title-bar"
        @pointerdown="startWindowDrag($event, 'relief')"
        @click="frontWindow = 'relief'"
        @dblclick="toggleReliefMaximize"
      >
        <div class="title-bar-text">FrescoThing — 3D Relief</div>
        <div class="title-bar-controls" @dblclick.stop>
          <button class="is-minimize" aria-label="Minimize" title="Minimize 3D Relief" @click="closeReliefWindow" />
          <button
            :class="reliefMaxed ? 'is-restore' : 'is-maximize'"
            :aria-label="reliefMaxed ? 'Restore' : 'Maximize'"
            :title="reliefMaxed ? 'Restore 3D Relief' : 'Maximize 3D Relief'"
            @click="toggleReliefMaximize"
          />
          <button class="is-close" aria-label="Close" title="Close 3D Relief" @click="closeReliefWindow" />
        </div>
      </div>
      <div class="window-body has-space relief-window-body">
        <ReliefPanel
          :visible="!reliefMinned"
          :maximized="reliefMaxed"
          :preview-url="previewUrl"
          :image-name="loadedImageName"
        />
      </div>
    </div>
    </div>

    <div class="taskbar">
      <span class="start-orb" aria-hidden="true">
        <span class="start-mark" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </span>
      </span>
      <button
        class="taskbar-app"
        :class="{ 'taskbar-app-minimized': minned, 'taskbar-app-active': frontWindow === 'painting' && !minned }"
        :aria-label="minned ? 'Open FrescoThing Painting' : 'Show FrescoThing Painting'"
        @click="toggleTaskbarWindow('painting')"
      >
        <span class="app-task-icon" aria-hidden="true">F</span>
        <span>FrescoThing</span>
      </button>
      <button
        class="taskbar-app taskbar-app-relief"
        :class="{ 'taskbar-app-minimized': reliefMinned, 'taskbar-app-active': frontWindow === 'relief' && !reliefMinned }"
        :aria-label="reliefMinned ? 'Open 3D Relief' : 'Switch to 3D Relief'"
        @click="toggleTaskbarWindow('relief')"
      >
        <span class="app-task-icon" aria-hidden="true">3D</span>
        <span>3D Relief</span>
      </button>
      <div class="system-tray">
        <time class="tray-clock" :datetime="new Date().toISOString()">
          {{ trayClockTime }}<br /><small>{{ trayClockDate }}</small>
        </time>
      </div>
      <div class="show-desktop" aria-hidden="true"></div>
    </div>

  </div>
</template>
