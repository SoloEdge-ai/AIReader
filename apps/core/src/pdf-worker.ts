import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Chapter,Passage} from '../../../packages/protocol/src/index';
const require=createRequire(import.meta.url);
async function parse(){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot=dirname(require.resolve('pdfjs-dist/package.json'));
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await readFile(workerData.path)),useSystemFonts:true,isEvalSupported:false,standardFontDataUrl:pathToFileURL(join(pdfRoot,'standard_fonts')+'/').href}).promise;
  const labels=await pdf.getPageLabels()??Array.from({length:pdf.numPages},(_,i)=>String(i+1));
  const chapters:Chapter[]=[];
  const walk=async(items:any[])=>{for(const item of items){try{const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;if(dest){const page=typeof dest[0]==='number'?dest[0]+1:await pdf.getPageIndex(dest[0])+1;chapters.push({id:`chapter-${chapters.length}`,title:String(item.title),page,endPage:pdf.numPages,inferred:false});}}catch{}if(item.items)await walk(item.items);}};
  await walk(await pdf.getOutline()??[]);chapters.sort((a,b)=>a.page-b.page);
  if(!chapters.length){for(let i=1;i<=pdf.numPages;i+=10)chapters.push({id:`pages-${i}`,title:`第 ${i}–${Math.min(i+9,pdf.numPages)} 页`,page:i,endPage:Math.min(i+9,pdf.numPages),inferred:true});}
  else chapters.forEach((chapter,i)=>{chapter.endPage=Math.max(chapter.page,(chapters[i+1]?.page??pdf.numPages+1)-1);});
  parentPort!.postMessage({type:'metadata',pages:pdf.numPages,labels,chapters});
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);const view=page.getViewport({scale:1});const content=await page.getTextContent();const passages:Passage[]=[];
    let text='';let rects:number[][]=[];const flush=()=>{if(text.trim()){const id=`${workerData.bookId}:${pageNo}:${passages.length}`;passages.push({id,bookId:workerData.bookId,page:pageNo,text:text.trim(),anchor:{bookId:workerData.bookId,fingerprint:workerData.fingerprint,passageId:id,indexVersion:1,page:pageNo,label:labels[pageNo-1],rects}});}text='';rects=[];};
    for(const raw of content.items){if(!('str' in raw))continue;const item=raw;const matrix=pdfjs.Util.transform(view.transform,item.transform);const height=Math.hypot(matrix[2],matrix[3]);
      text+=item.str+(item.hasEOL?'\n':' ');rects.push([Math.max(0,matrix[4]/view.width),Math.max(0,(matrix[5]-height)/view.height),Math.min(1,item.width/view.width),Math.min(1,height/view.height)]);
      if(text.length>=1800&&(item.hasEOL||text.length>2600))flush();
    }flush();parentPort!.postMessage({type:'page',page:pageNo,passages});page.cleanup();
  }
  await pdf.destroy();parentPort!.postMessage({type:'done'});
}
parse().catch(error=>parentPort!.postMessage({type:'error',error:error instanceof Error?error.message:String(error)}));
