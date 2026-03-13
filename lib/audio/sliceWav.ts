/**
 * Utilities to create a valid WAV Blob containing only a slice of the
 * original WAV data.
 *
 * The processed audio produced by FFmpeg in this project is 16 kHz mono
 * PCM WAV; however this implementation reads the header and copies the
 * original audio format fields so it works generally for PCM WAV inputs.
 *
 * Behavior notes:
 * - If the requested slice is out of range the function clamps to the
 *   available data and returns a valid, possibly empty, WAV blob.
 * - The function validates the RIFF/WAVE header and will throw on
 *   unsupported or non-PCM inputs.
 */
export async function sliceWavBlob(
  wavBlob: Blob | ArrayBuffer | Uint8Array,
  startSeconds: number,
  endSeconds: number,
): Promise<Blob> {
  let ab: ArrayBuffer;
  if (typeof (Object(wavBlob) as Blob).arrayBuffer === 'function') {
    ab = await (wavBlob as Blob).arrayBuffer();
  } else if (wavBlob instanceof ArrayBuffer) {
    ab = wavBlob;
  } else if (ArrayBuffer.isView(wavBlob)) {
    ab = (wavBlob as Uint8Array).buffer as ArrayBuffer;
  } else {
    throw new Error('Unsupported WAV input');
  }
  const dv = new DataView(ab);

  // Verify RIFF/WAVE
  function readStr(off: number, len: number): string {
    return String.fromCharCode(...new Uint8Array(ab, off, len));
  }
  if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV file');
  }

  // Walk chunks to find 'fmt ' and 'data'
  let offset = 12;
  let fmt: {
    audioFormat: number;
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= dv.byteLength) {
    const id = readStr(offset, 4);
    const size = dv.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (id === 'fmt ') {
      const audioFormat = dv.getUint16(chunkStart + 0, true);
      const numChannels = dv.getUint16(chunkStart + 2, true);
      const sampleRate = dv.getUint32(chunkStart + 4, true);
      const bitsPerSample = dv.getUint16(chunkStart + 14, true);
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    // advance (chunks may be padded to even byte boundaries)
    offset = chunkStart + size + (size % 2);
  }

  if (!fmt || dataOffset < 0) {
    throw new Error('Unsupported WAV format');
  }

  const { sampleRate, numChannels, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const bytesPerFrame = bytesPerSample * numChannels;

  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  const startFrame = Math.max(
    0,
    Math.min(Math.floor(startSeconds * sampleRate), totalFrames),
  );
  const endFrame = Math.max(
    startFrame,
    Math.min(Math.ceil(endSeconds * sampleRate), totalFrames),
  );

  const startByteInData = dataOffset + startFrame * bytesPerFrame;
  const endByteInData = Math.min(
    dataOffset + dataSize,
    dataOffset + endFrame * bytesPerFrame,
  );
  const newDataSize = Math.max(0, endByteInData - startByteInData);

  const out = new Uint8Array(44 + newDataSize);
  // RIFF header
  function writeStr(dest: Uint8Array, off: number, s: string) {
    for (let i = 0; i < s.length; i++) dest[off + i] = s.charCodeAt(i);
  }
  writeStr(out, 0, 'RIFF');
  // file size = 36 + data
  new DataView(out.buffer).setUint32(4, 36 + newDataSize, true);
  writeStr(out, 8, 'WAVE');
  // fmt chunk
  writeStr(out, 12, 'fmt ');
  new DataView(out.buffer).setUint32(16, 16, true); // PCM fmt chunk size
  new DataView(out.buffer).setUint16(20, fmt.audioFormat, true);
  new DataView(out.buffer).setUint16(22, fmt.numChannels, true);
  new DataView(out.buffer).setUint32(24, fmt.sampleRate, true);
  const byteRate = fmt.sampleRate * fmt.numChannels * bytesPerSample;
  new DataView(out.buffer).setUint32(28, byteRate, true);
  const blockAlign = fmt.numChannels * bytesPerSample;
  new DataView(out.buffer).setUint16(32, blockAlign, true);
  new DataView(out.buffer).setUint16(34, fmt.bitsPerSample, true);
  // data chunk header
  writeStr(out, 36, 'data');
  new DataView(out.buffer).setUint32(40, newDataSize, true);

  // copy data
  const src = new Uint8Array(ab, startByteInData, newDataSize);
  out.set(src, 44);

  return new Blob([out.buffer], { type: 'audio/wav' });
}

export default sliceWavBlob;
