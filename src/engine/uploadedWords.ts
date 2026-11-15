import type { Profile, UploadedWord } from '../types';

export function wordKey(text: string) {
  return text.trim().normalize('NFC');
}

export function uploadedWordIndex(profile?: Profile) {
  const index = new Map<string, UploadedWord>();
  for (const word of profile?.wordSamples || []) {
    const key = wordKey(word.text);
    // A crop can represent one word. Do not pretend a multiword OCR label
    // identifies separate source words or discard capitalization/punctuation.
    if (key && !/\s/.test(key) && !index.has(key)) index.set(key, word);
  }
  return index;
}

export function uploadedWordVariants(profile?:Profile){
  const index=new Map<string,UploadedWord[]>();
  for(const word of profile?.wordSamples||[]){
    const key=wordKey(word.text);if(!key||/\s/.test(key))continue;
    const pool=index.get(key)||[];
    if(!pool.some(sample=>sample.image===word.image)){pool.push(word);index.set(key,pool);}
  }
  return index;
}

export function uploadCoverage(text: string, profile?: Profile) {
  const index = uploadedWordIndex(profile);
  const tokens = text.match(/\S+/g) || [];
  const found = tokens.filter(word => index.has(wordKey(word)));
  const missing = [...new Set(tokens.filter(word => !index.has(wordKey(word))))];
  return { index, found, missing, total: tokens.length };
}

export function sourceTranscript(words: UploadedWord[]) {
  const lines = [...new Set(words.map(word => word.line ?? 0))].sort((a, b) => a - b);
  return lines.map((line,index) => {
    const group=words.filter(word=>(word.line??0)===line);
    const previous=index?words.find(word=>(word.line??0)===lines[index-1]):undefined;
    return (previous&&previous.page!==group[0].page?'\n':'')+group.map(word=>word.text.trim()).join(' ');
  }).join('\n');
}
