import { canvas, loadImage } from './image';
import type { Profile } from '../types';

export async function profileFromSample(file: File): Promise<Profile> {
  const source = await loadImage(file);
  const factor = Math.min(1, 1800 / Math.max(source.width, source.height));
  const page = canvas(source.width * factor, source.height * factor);
  page.getContext('2d')!.drawImage(source, 0, 0, page.width, page.height);
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:8000/recognize-sample', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({page:page.toDataURL('image/jpeg',.94)}),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new Error('Could not read the sample. Start the free local handwriting service at 127.0.0.1:8000 and upload again.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'The sample could not be read. Try a clearer image.');
  if (!result.words?.length || !result.transcript?.trim() || result.references?.length !== 5)
    throw new Error('No readable word library was returned. No empty profile was saved.');
  return {
    id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/, '').slice(0,70) || 'My handwriting',
    version:1,createdAt:Date.now(),em:64,glyphs:{},kind:'reference',
    automaticSample:true,references:result.references,sampleCount:result.referenceCount,
    wordSamples:result.words,sourceTranscript:result.transcript,sourceReadWarnings:result.warnings || [],
  };
}
