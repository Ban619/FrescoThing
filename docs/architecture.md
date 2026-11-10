# Architecture

FrescoThing is structured around a browser-first client experience with a legacy server prototype kept only for reference.

## Client structure

The front end lives under `client/`:

- `index.html` — app shell and page metadata
- `src/main.js` — Vue app bootstrap
- `src/App.vue` — root component that loads the desktop application
- `src/app.css` — interface styling and window layout
- `src/2D/` — painting app, engine, and embedded WebAssembly vector-field payload
- `src/3D/` — relief UI, foreground/depth processing, Three.js viewer, and styles

## Runtime responsibilities

### 2D painting

`src/2D/PaintingApp.vue` owns the painting UI and interactions. Its `engine.js`
module is responsible for:

- loading the uploaded image
- scaling for quality settings
- computing field data for stroke direction/structure
- selecting brush and finish behavior
- drawing strokes progressively
- tracking progress, likeness, and completion states

### 3D relief

`src/3D/ReliefPanel.vue` owns the relief UI and processing lifecycle. The
supporting modules in `src/3D/` handle:

- on-device foreground segmentation and automatic cropping
- local depth estimation and Three.js relief rendering
- camera controls and GLB export
- relief-specific styling in `relief.css`

`src/2D/PaintingApp.vue` also hosts the desktop windows and passes the painting
preview to the 3D panel when that window is opened.

### OCR layer

OCR is performed in-browser through Tesseract.js, with the user controlling:

- language selection
- page segmentation mode
- contrast cleanup
- display of text boxes over the painting canvas

### 3D relief

The 3D Relief tab loads MediaPipe on demand to find and crop the main foreground
object, then loads Three.js to turn that transparent crop into a height relief.
The mesh follows the object's alpha silhouette, uses image luminance for depth,
and is exported as a binary GLB.

## Legacy server

The `server/` folder contains an older Node-based OCR prototype and is not part of the active app path. The main product intentionally prefers the client-only architecture.

## Build flow

The active app is built with Vite. The build process compiles the Vue app and bundles the painting client for deployment.
