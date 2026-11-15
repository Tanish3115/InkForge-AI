export const contextualAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function contextHash(text:string,seed:number) {
  let hash=seed|0;
  for(const ch of text)hash=Math.imul(hash^ch.codePointAt(0)!,16777619);
  return hash>>>0;
}

/** Balance genuine available forms using neighboring text, without outline warps. */
export function variantSelector(seed:number) {
  const last=new Map<string,number>(),counts=new Map<string,number[]>();
  return (key:string,length:number,context:string) => {
    if(length<2)return 0;
    // A filtered image pool can change size. Never reuse incompatible counters.
    const previous=counts.get(key);
    const used=previous?.length===length?previous:Array(length).fill(0);
    const recent=previous?.length===length?last.get(key):undefined;
    const minimum=Math.min(...used.filter((_,index)=>index!==recent));
    const candidates=used.map((count,index)=>({count,index})).filter(value=>value.index!==recent&&value.count===minimum);
    const choice=candidates[contextHash(`${key}:${context}`,seed)%candidates.length].index;
    used[choice]++;counts.set(key,used);last.set(key,choice);
    return choice;
  };
}

/** These private characters map to existing designer alternates in InkForge Context. */
export function contextualText(text:string,wordIndex:number,seed:number,select:ReturnType<typeof variantSelector>,strength=1) {
  const letters=[...text],amount=Math.max(0,Math.min(1,strength));
  return letters.map((character,index)=>{
    const letter=contextualAlphabet.indexOf(character);
    if(letter<0||amount===0)return character;
    const context=`${wordIndex}:${letters[index-1]||'^'}:${letters[index+1]||'$'}:${index}:${seed}`;
    // Reduced strength changes how often alternate formations are used; it does
    // not interpolate/deform outlines or simulate captured pen pressure.
    if(contextHash(`use:${character}:${context}`,seed)/4294967296>Math.sqrt(amount))return character;
    const variant=select(character,3,context);
    return variant===0?character:String.fromCodePoint(0xE000+letter*2+variant-1);
  }).join('');
}
