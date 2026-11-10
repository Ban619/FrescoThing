# FrescoThing

Turn a photo into a painting, explore it as a 3D relief, or read the text in
it—all from one browser-based workspace.

Made by [@bancansustain](https://www.instagram.com/bancansustain/) ·
[GitHub profile](https://github.com/Ban619)

![Vue 3](https://img.shields.io/badge/vue-3-42B883?logo=vuedotjs&logoColor=white)
![Vite 8](https://img.shields.io/badge/vite-8-9B5CF6?logo=vite&logoColor=white)
![Three.js](https://img.shields.io/badge/three.js-3D%20relief-black?logo=threedotjs)
![p5.brush 2.2.3](https://img.shields.io/badge/p5.brush-2.2.3-3c8d40)
![Tesseract.js 7](https://img.shields.io/badge/tesseract.js-7-FF6F00)
![7.css](https://img.shields.io/badge/7.css-win7-5fa9df)
![MIT](https://img.shields.io/badge/license-MIT-green)

## What you can do

- **Make a painting.** Choose from 18 finishes, including watercolor,
  impasto, charcoal, pixel art, and pencil sketch. Watch the image take shape
  stroke by stroke, and adjust the quality and likeness settings.
- **Create a 3D relief.** Open the separate Relief window to isolate the
  subject, adjust its depth and appearance, orbit the preview, and export the
  result as a GLB model.
- **Read text in an image.** Run OCR, choose a language and page layout, and
  view detected text with boxes over the image.

Your photos are processed in the browser and are not uploaded by the app.
Some libraries and processing assets may be downloaded when you use a feature.

## Get started

You’ll need [Node.js](https://nodejs.org/) 22 or later and npm.

```bash
cd client
npm install
npm run dev
```

Open the local address printed by Vite. To create and preview a production
build:

```bash
npm run build
npm run preview
```

The production files are written to `client/dist`.

## Built with

- [Vue 3](https://vuejs.org/) and [Vite](https://vite.dev/) power the app and
  development workflow.
- [p5.brush](https://github.com/acamposuribe/p5.brush) provides the natural
  media painting tools, alongside custom brushes and stroke planning.
- [Tesseract.js](https://github.com/naptha/tesseract.js) runs text recognition
  in the browser.
- [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision)
  helps find the foreground subject for relief generation.
- [Three.js](https://threejs.org/) renders the interactive relief and exports
  GLB models.
- [7.css](https://github.com/khang-nd/7.css) gives the workspace its classic
  Windows-style interface.

## Project layout

- `client/src/2D/` — painting interface, drawing engine, and related assets.
- `client/src/3D/` — relief interface, image processing, viewer, and styles.
- `docs/` — project and feature documentation.
- `server/` — an older OCR server prototype; it is not used by the browser app.

