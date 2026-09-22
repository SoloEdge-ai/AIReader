import {randomUUID} from 'node:crypto';
import type {ChatTurn,ReadingSnapshot} from '../../../packages/protocol/src';
import {Library} from './library';import {CodexAdapter} from './codex';import {buildContext,renderPrompt,validateCitations} from './context';
export class ChatService {
 private running=new Map<string,AbortController>();
 private closed=false;
 constructor(readonly library:Library,readonly codex:CodexAdapter){for(const turn of library.store.list<ChatTurn>('turn'))if(turn.status==='running'){turn.status='error';turn.error='应用重启，上一轮已中断。';this.save(turn);}}
 list(bookId:string,sessionId?:string){this.library.book(bookId);return this.library.store.list<ChatTurn>('turn',bookId).filter(t=>!sessionId||t.sessionId===sessionId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
 start(reading:ReadingSnapshot,question:string,sessionId:string,model?:string){
  if(this.list(reading.bookId,sessionId).some(t=>t.status==='running'))throw new Error('请先停止当前回答。');
  const context=buildContext(this.library,reading,question,sessionId);const turn:ChatTurn={id:randomUUID(),bookId:reading.bookId,sessionId,question,answer:'',status:'running',createdAt:new Date().toISOString(),context,citations:[],tools:[]};const control=new AbortController();this.running.set(turn.id,control);this.save(turn);
  void this.codex.answer(renderPrompt(context,question),{signal:control.signal,model,onText:text=>{if(turn.status==='running'){turn.answer=text;this.save(turn);}}}).then(result=>{if(control.signal.aborted)return;Object.assign(turn,validateCitations(result.text,context),{status:'complete',usage:result.usage});}).catch(error=>{turn.status=control.signal.aborted?'cancelled':'error';turn.error=error.message;}).finally(()=>{this.running.delete(turn.id);this.save(turn);});return turn;
 }
 private save(turn:ChatTurn){if(this.closed)return;this.library.store.put('turn',turn.id,turn.bookId,turn);this.library.emit({type:'turn',bookId:turn.bookId,taskId:turn.id,data:turn});}
 cancel(bookId:string,id:string){const turn=this.list(bookId).find(t=>t.id===id);if(turn)this.running.get(id)?.abort();}
 cancelAll(){for(const control of this.running.values())control.abort();}
 close(){this.cancelAll();this.closed=true;}
}
