import {useEffect,useRef,useState} from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {SourceAnchor} from '../../../packages/protocol/src';
import {fileUrl} from './api';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
function Page({pdf,page,zoom,onVisible,highlight}:{pdf:PDFDocumentProxy;page:number;zoom:number;onVisible:(page:number)=>void;highlight?:SourceAnchor}){
 const outer=useRef<HTMLDivElement>(null);const canvas=useRef<HTMLCanvasElement>(null);const text=useRef<HTMLDivElement>(null);const [visible,setVisible]=useState(false);const [size,setSize]=useState({width:660,height:930});
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{setVisible(entry.isIntersecting);if(entry.isIntersecting&&entry.intersectionRatio>0.2)onVisible(page);},{rootMargin:'250px',threshold:[0,.25,.6]});observer.observe(outer.current!);return()=>observer.disconnect();},[page,onVisible]);
 useEffect(()=>{let cancelled=false;let render:ReturnType<pdfjs.PDFPageProxy['render']>|undefined;let layer:pdfjs.TextLayer|undefined;
  if(visible)void(async()=>{const p=await pdf.getPage(page);if(cancelled)return;const viewport=p.getViewport({scale:zoom});setSize({width:viewport.width,height:viewport.height});const c=canvas.current!;const ratio=window.devicePixelRatio||1;c.width=Math.floor(viewport.width*ratio);c.height=Math.floor(viewport.height*ratio);
   render=p.render({canvas:c,canvasContext:c.getContext('2d')!,viewport,transform:[ratio,0,0,ratio,0,0]});await render.promise;if(cancelled)return;const content=await p.getTextContent();if(cancelled)return;text.current!.replaceChildren();text.current!.style.setProperty('--scale-factor',String(zoom));layer=new pdfjs.TextLayer({textContentSource:content,container:text.current!,viewport});await layer.render();
  })().catch(error=>{if(error?.name!=='RenderingCancelledException'&&!cancelled)console.error(error);});
  return()=>{cancelled=true;render?.cancel();layer?.cancel();};
 },[pdf,page,zoom,visible]);
 return <div ref={outer} id={'page-'+page} className="pdf-page" data-page={page} style={{width:size.width,height:size.height}}><canvas ref={canvas} style={{width:'100%',height:'100%'}}/><div ref={text} className="textLayer"/>{highlight?.page===page&&<div className="highlights">{highlight.rects.map((r,i)=><i key={i} style={{left:r[0]*100+'%',top:r[1]*100+'%',width:r[2]*100+'%',height:r[3]*100+'%'}}/>)}</div>}<span className="page-number">{page}</span></div>;
}
export function PdfReader({id,initialPage,zoom,onPage,onSelection,highlight}:{id:string;initialPage:number;zoom:number;onPage:(page:number)=>void;onSelection:(text:string,page:number)=>void;highlight?:SourceAnchor}){
 const [pdf,setPdf]=useState<PDFDocumentProxy>();const [error,setError]=useState('');
 useEffect(()=>{let active=true;const task=pdfjs.getDocument({url:fileUrl(id),withCredentials:true,isEvalSupported:false});task.promise.then(doc=>{if(active){setPdf(doc);setTimeout(()=>document.getElementById('page-'+initialPage)?.scrollIntoView(),200);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;void task.destroy();};},[id]);
 return <div className="pdf-scroll" onMouseUp={()=>{const selection=window.getSelection();const selected=selection?.toString().trim()??'';if(selected){const element=selection?.anchorNode?.parentElement?.closest('[data-page]');onSelection(selected.slice(0,12000),Number(element?.getAttribute('data-page')??1));}}}>{error?<p className="error">PDF 无法打开：{error}</p>:pdf?Array.from({length:pdf.numPages},(_,i)=><Page key={i+1} pdf={pdf} page={i+1} zoom={zoom} onVisible={onPage} highlight={highlight}/>):<p className="loading">正在打开 PDF…</p>}</div>;
}
