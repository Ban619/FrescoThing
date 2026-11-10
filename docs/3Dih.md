# 3D Relief

The **3D Relief** taskbar button opens a separate, independently
minimizable/resizable window from the Painting workspace. It analyzes the image with an on-device segmentation model,
isolates the main foreground object, removes the background, and tightly
crops it. It then estimates relative depth with Depth Anything V2 Small and
builds a denser relief mesh from that depth map. It is still a single-view
relief, not a reconstruction of hidden sides.

## Using it

1. Open **3D Relief** from its taskbar button and choose or drop an image. An
   image already loaded in the Painting window is automatically prepared when
   the relief window is opened.
2. Wait for the main object to be isolated, cropped, and turned into a relief.
   The first use downloads the segmentation and depth models; the image itself
   stays in the browser and is not uploaded.
3. Customize relief depth, thickness, mesh detail, surface finish, and finish
   tint. These settings are included in the exported model.
4. Drag the relief to orbit, scroll to zoom, and adjust depth if needed.
5. Choose **Export 3D model** to save a GLB.

Object isolation runs locally in the browser with MediaPipe's DeepLab v3 model.
Its class scores are normalized into per-pixel foreground probabilities before
the subject mask is selected. If the subject confidence is weak, the app
retries with more sensitive mask thresholds. If the model cannot produce a
reliable mask, a color-saliency crop is attempted, followed by a center-weighted
focus crop; the full uncropped image is not silently used as an isolated object.
Segmentation runtime/model files are fetched from jsDelivr and Google Storage.
Depth inference runs locally with the quantized
`onnx-community/depth-anything-v2-small` model, fetched from Hugging Face on
first use. Depth values are normalized against visible foreground pixels only,
so transparent crop margins do not compress the object's depth range. The
depth model runs on both the original and horizontally flipped image; the
aligned predictions are averaged to reduce orientation-specific artifacts.
Before meshing, depth is refined with an image-guided bilateral filter that
smooths within similar-color regions while retaining visible feature edges and
the foreground silhouette. The selected image is processed locally and is not
sent to either service. If depth estimation fails, the UI reports that it is
using image-derived depth instead.
Three.js is loaded after segmentation completes. If WebGL is unavailable, the
viewer falls back to a software-rendered preview with mouse orbit and zoom.
GLB export still uses the generated silhouette mesh. The depth surface is
smoothed before displacement, and mesh triangles are only created where all
three vertices belong to the visible object, preventing transparent edge
pixels from stretching into long spikes. Extruded sides are generated only on
the outer silhouette; internal cutouts do not create broad wall panels.

## Implementation

- `client/src/3D/foreground.js` uses foreground confidence to identify the
  main object and nearby meaningful segments, creates a feathered transparent
  crop, and limits oversized crops to 2048 pixels.
- `client/src/3D/relief3d.js` builds a silhouette mesh from the cropped
  alpha mask and smoothed AI depth map, then adds outer-contour sides and a
  backing. Smoothed image luminance is used only if the AI depth model fails. Its
  depth, thickness, detail, finish, and tint options are applied to the
  exported geometry and materials.
- `client/src/3D/depth-estimation.js` runs Depth Anything V2 Small locally
  with flipped-image test-time averaging and normalizes its relative depth map
  using visible foreground pixels.
- OrbitControls provide pointer orbiting and wheel zoom.
- GLTFExporter produces a binary GLB download.
