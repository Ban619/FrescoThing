import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createEngine } from '@arcships/light-ocr';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

let engine = null;
  async function getEngine() {
    if (!engine) {
      engine = await createEngine({ execution: { 
        provider: 'auto' }, queueCapacity: 4 });
      try { 
        console.log('ocr:', JSON.stringify(engine.info.execution.selectionTrace)); 

      } catch { 
        
      }
    }
  return engine;
}

app.get('/api/health', async (req, res) => {
  try {
    await getEngine();
    res.json({ ok: true, engine: 'light-ocr' });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
});

app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no image uploaded' });
    const e = await getEngine();
    const result = await e.recognizeEncoded(req.file.buffer, { applyExif: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
});

const port = process.env.PORT || 3001;
const server = app.listen(port, () => console.log('server on :' + port));

async function shutdown() {
  server.close();
  try { if (engine) await engine.close(); } catch { 
    
   }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
