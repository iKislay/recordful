import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  WebMOutputFormat,
} from "mediabunny";

// Copies a WebM's packets into a new file, without re-encoding. The recorder
// streams its file out, so it has no length and no seek index; the copy has
// both.
async function remuxWebm(blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const conversion = await Conversion.init({ input, output });
  await conversion.execute();
  return new Blob([target.buffer], { type: blob.type });
}

export default remuxWebm;
