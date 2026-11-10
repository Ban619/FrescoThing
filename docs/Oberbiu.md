# Project overview

FrescoThing is a playful little app that turns a photo into a painted-looking artwork or a 3D relief right in the browser. You drop in an image, choose a finish, and watch it get rendered stroke by stroke with a hand-crafted, painterly feel. Or switch to 3D Relief to turn image brightness into a raised surface you can orbit and export as GLB. It also has OCR built in, so you can scan the image for text and see the detected lines highlighted on top.

## What it does

The app is built to feel simple and local:

- you keep your photo on your own machine
- there is no upload step for the normal workflow
- there is no cloud API key to manage
- the painting process happens in the browser
- the 3D Relief tab builds a textured, height-based surface from the photo
- OCR runs locally with Tesseract.js

## What the experience feels like (much better if you'll try it yourself)

The interface is styled like a retro Windows desktop window, using 7.css to create that familiar old-school app vibe. It gives you a surprisingly direct, tactile workflow:

- upload a photo
- pick a painting finish such as oil, watercolor, charcoal, or sketch
- tune quality, detail, speed, and likeness
- pause or resume the painting
- save the result as a PNG or SVG
- orbit a 3D relief, adjust its depth, and export a GLB
- run OCR and inspect the found text boxes

## The main building blocks

FrescoThing is a mix of browser graphics and lightweight image processing:

- Vite for development and build tooling
- Vue 3 for the interface layer
- p5.brush for natural-media brush behavior
- Three.js for the 3D relief viewer and GLB export
- Canvas 2D and a custom painting engine for stroke planning and rendering
- Tesseract.js for OCR and text detection

## One practical note

The root `server/` folder is an older OCR prototype from an earlier iteration of the project. It is not part of the way the app is meant to run today; the live app is intentionally designed to stay client-side and self-contained.
