import {expect,it} from 'vitest';
import {uploadCoverage,sourceTranscript} from '../src/engine/uploadedWords';
import {layout} from '../src/engine/layout';
import {validateProfile} from '../src/lib/storage';
import {isolateProfile} from '../src/engine/generate';
import {defaults,type Profile,type UploadedWord} from '../src/types';
const word:UploadedWord={id:'word-1',text:'Hi',image:'data:image/png;base64,AAAA',width:70,height:44,baseline:35,em:38,line:0};
const profile:Profile={id:'p',name:'Sample',version:1,createdAt:0,em:64,glyphs:{},kind:'reference',references:Array(5).fill('data:image/png;base64,AAAA'),wordSamples:[word]};
it('uses the original word asset and preserves case and punctuation',()=>{
 const coverage=uploadCoverage('Hi Hi hi Hi, new new',profile);
 expect(coverage.index.get('Hi')).toBe(word);
 expect(coverage.found).toEqual(['Hi','Hi']);
 expect(coverage.missing).toEqual(['hi','Hi,','new']);
});
it('preserves original image geometry without decorative variation',()=>{
 const plan=layout({text:'Hi Hi',mode:'personalized',engine:'neural',styleId:'classic',profile,settings:{...defaults,variation:1},seed:42,fallback:false},()=>({width:70,image:word.image,imageHeight:44,imageBaseline:35,imageEm:38,origin:'uploaded',sourceWordId:word.id}),30,10);
 for(const item of plan[0].items){expect(item.scale).toBe(1);expect(item.rotation).toBeCloseTo(0,12);expect(item.opacity).toBe(defaults.opacity);expect(item.image).toBe(word.image);expect(item.sourceWordId).toBe(word.id);}
 expect(plan[0].items[0].y).toBe(plan[0].items[1].y);
});
it('corrected labels update coverage and the readable transcript',()=>{
 const corrected={...profile,wordSamples:[{...word,text:'Hello'}, {...word,id:'word-2',text:'world',line:1}]};
 expect(uploadCoverage('Hello Hi',corrected).missing).toEqual(['Hi']);
 expect(sourceTranscript(corrected.wordSamples)).toBe('Hello\nworld');
});
it('rejects invalid image metrics in an imported word library',()=>{
 expect(()=>validateProfile({...profile,wordSamples:[{...word,baseline:200}]})).toThrow('measurements');
 expect(validateProfile(profile).wordSamples?.[0].image).toBe(word.image);
});
it('removes all uploaded reference data from default generation requests',()=>{
 const request={text:'Hi',mode:'default' as const,engine:'neural' as const,styleId:'classic',profile,references:profile.references,settings:defaults,seed:42,fallback:false};
 const isolated=isolateProfile(request);
 expect(isolated.profile).toBeUndefined();
 expect(isolated.references).toBeUndefined();
 expect(request.profile).toBe(profile);
 expect(isolateProfile({...request,mode:'personalized'}).profile).toBe(profile);
});
