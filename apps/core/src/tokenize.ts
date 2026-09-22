const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
export function tokens(text:string):string[]{
  const normalized=text.normalize('NFKC').toLowerCase();
  const result=Array.from(segmenter.segment(normalized)).filter(x=>x.isWordLike).map(x=>x.segment);
  // Han bigrams supplement dictionary segmentation for names and mixed technical terms.
  for(const run of normalized.match(/[\p{Script=Han}]+/gu)??[]){for(let i=0;i<run.length-1;i++)result.push(run.slice(i,i+2));if(run.length===1)result.push(run);}
  return [...new Set(result)];
}
export function normalize(text:string){return text.normalize('NFKC').replace(/\s+/g,' ').trim();}
