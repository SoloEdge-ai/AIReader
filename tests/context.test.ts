import {test,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Library} from '../apps/core/src/library';import {buildContext,renderPrompt,validateCitations} from '../apps/core/src/context';
import type {Book,ChatTurn} from '../packages/protocol/src';
test('50 turns remain bounded and unknown or cross-book citations are not clickable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aireader-context-'));const library=new Library(dir);
 try{const book:Book={id:'a',fingerprint:'f',title:'Test',pages:10,parsedPages:4,textPages:4,status:'parsing',progress:1,createdAt:'',chapters:[],labels:[],indexVersion:1};library.store.put('book','a','a',book);
 for(let i=0;i<50;i++)library.store.put('turn',String(i),'a',{id:String(i),bookId:'a',sessionId:'s',question:'历史问题'.repeat(300),answer:'历史回答'.repeat(1000),createdAt:String(i).padStart(2,'0'),status:'complete'} as ChatTurn);
 const reading={bookId:'a',page:3,selection:'',scope:'auto' as const};const context=buildContext(library,reading,'这里是什么？','s');reading.page=9;
 expect(context.reading.page).toBe(3);expect(context.estimatedTokens).toBeLessThanOrEqual(12000);expect(renderPrompt(context,'这里是什么？').length).toBeLessThan(36000);expect(context.coverage).toContain('4 / 10');
 expect(validateCitations('错误 [[other:2:0]]',context).citations).toEqual([]);
 }finally{library.close();await rm(dir,{recursive:true,force:true});}
});
