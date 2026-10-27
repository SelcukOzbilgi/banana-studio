import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { MODEL_ROUTES, PROVIDER_KEYS, PROVIDER_LABELS, resolveProvider } from '../src/lib/providers.ts';
import { mapWiroSchema, parseWiroPrices, wiroPriceFor, wiroPriceSummary, wiroEntryFromTool, refreshWiroEntry, validateWiroOptions, wiroCatalogFields, isWiroModelId, appModelForWiroSlug } from '../src/lib/wiro/catalog.ts';

// Bundle the API pipeline with the same local-workspace boundary as the desktop build.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const replacements={auth:'auth.mjs',openaiGuard:'guard.mjs',imageJobQueue:'queue.mjs',providerMedia:'providerMedia.mjs',rasterCodec:'rasterCodec.mjs'};
const outdir=path.join(root,'.build/test-bundles');fs.mkdirSync(outdir,{recursive:true});
const outfile=path.join(outdir,`wiro-${process.pid}.mjs`);
await build({stdin:{resolveDir:root,loader:'js',contents:`
export { runImageJob, ImageJobWait } from './api/_lib/imageJobRunner.ts';
export { requestWiroImage, wiroPolling, parseWiroTask, isWiroOutputUrl, downloadWiroOutput, wiroSignature, wiroHeaders, wiroRunBody, WiroTaskPending, loadWiroControls } from './api/_lib/wiro.ts';
export { wiroBuiltinRequest } from './api/_lib/imageProviders.ts';
export { providerAvailability } from './api/_lib/providerConfiguration.ts';
export { setWorkspace } from './desktop/server/context.mjs';
export { LocalWorkspace } from './desktop/server/store.mjs';
export { createWiroCatalog } from './desktop/server/wiroCatalog.mjs';`},
  outfile,platform:'node',target:'node22',format:'esm',bundle:true,packages:'bundle',external:['sharp'],logLevel:'silent',
  banner:{js:"import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);"},
  plugins:[{name:'local-workspace-boundary',setup(b){b.onResolve({filter:/(auth|openaiGuard|imageJobQueue|providerMedia|rasterCodec)\.(js|ts)$/},args=>{
    const resolved=path.resolve(args.resolveDir,args.path);if(path.dirname(resolved)!==path.join(root,'api/_lib'))return;
    return {path:path.join(root,'desktop/server',replacements[path.basename(args.path).replace(/\.(js|ts)$/,'')])};
  });}}]});
const api=await import(pathToFileURL(outfile).href);
test.after(()=>fs.rmSync(outfile,{force:true}));

const KEY='synthetic-wiro-key',SECRET='synthetic-wiro-secret-value';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const withKeys=async(fn)=>{const old={k:process.env.WIRO_API_KEY,s:process.env.WIRO_API_SECRET};process.env.WIRO_API_KEY=KEY;process.env.WIRO_API_SECRET=SECRET;
  try{return await fn();}finally{for(const [name,value] of [['WIRO_API_KEY',old.k],['WIRO_API_SECRET',old.s]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}};
// A Task/Detail answer in the verified shape (task 5131461): numerics are strings.
const detail=(status,pexit,extra={})=>({total:'1',errors:[],result:true,tasklist:[{id:'777',status,pexit,totalcost:'0.006000000000',chargedcost:'0.006000000000',elapsedseconds:'15.0000',
  dynamicprice:'[{"inputs":{"quality":"low"},"price":0.006,"priceMethod":"cpr"}]',
  outputs:status==='task_postprocess_end'&&pexit==='0'?[{id:'x',name:'777_Image.png',contenttype:'image/png',size:String(PNG.length),url:'https://cdn1.wiro.ai/abc/777_Image.png'}]:[],...extra}]});
const fakeWiro=(script)=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const target=new URL(String(url));
    const body=options.body instanceof FormData?Object.fromEntries([...options.body.keys()].map(key=>[key,options.body.getAll(key).map(v=>typeof v==='string'?v:`file:${v.type}:${v.size}`)])):options.body?JSON.parse(options.body):undefined;
    calls.push({host:target.hostname,path:target.pathname,headers:{...options.headers},redirect:options.redirect,body});
    return script(target,body,calls);
  };
  return {calls,fetchImpl};
};
const leaksSecret=calls=>JSON.stringify(calls).includes(SECRET);

test('Signature headers match HMAC-SHA256(key, secret + nonce) and never carry the secret',()=>{
  const headers=api.wiroHeaders(KEY,SECRET,'1793125181');
  assert.equal(headers['x-api-key'],KEY);assert.equal(headers['x-nonce'],'1793125181');
  assert.equal(headers['x-signature'],createHmac('sha256',KEY).update(SECRET+'1793125181').digest('hex'));
  assert.ok(!JSON.stringify(headers).includes(SECRET));
});

test('Wiro is first in Auto for the three image models, needs both key and secret, and keeps fallbacks',()=>{
  assert.equal(PROVIDER_LABELS.wiro,'Wiro');assert.equal(PROVIDER_KEYS.wiro,'WIRO_API_KEY');
  for(const model of ['gpt-image-2.5-sunburst','gemini-3-pro-image-preview','gemini-nano-banana-2.1']){
    assert.equal(MODEL_ROUTES[model][0],'wiro');
    assert.equal(resolveProvider(model,'auto',{wiro:true,openai:true,fal:true,gemini:true,openrouter:true}),'wiro');
    assert.notEqual(resolveProvider(model,'auto',{openai:true,fal:true,gemini:true,openrouter:true}),'wiro');
  }
  assert.equal(resolveProvider('wiro:black-forest-labs/flux-2-pro','auto',{wiro:true,openai:true}),'wiro');
  assert.throws(()=>resolveProvider('wiro:black-forest-labs/flux-2-pro','openai',{wiro:true,openai:true}));
  assert.throws(()=>resolveProvider('wiro:black-forest-labs/flux-2-pro','auto',{openai:true}),/Wiro/);
  assert.throws(()=>resolveProvider('wiro:../etc','auto',{wiro:true}),/Unsupported/);
  for(const model of ['seedance-2.5','minimax-h3','gpt-6.1-sol'])assert.ok(!MODEL_ROUTES[model].includes('wiro'),'video and text routes are unchanged');
  const saved={k:process.env.WIRO_API_KEY,s:process.env.WIRO_API_SECRET};
  try{
    process.env.WIRO_API_KEY=KEY;delete process.env.WIRO_API_SECRET;assert.equal(api.providerAvailability().wiro,false);
    process.env.WIRO_API_SECRET=SECRET;assert.equal(api.providerAvailability().wiro,true);
  }finally{for(const [name,value] of [['WIRO_API_KEY',saved.k],['WIRO_API_SECRET',saved.s]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

// Parameter lists in the shape of Tool/Detail (abridged from the real schemas).
const SUNBURST=[{items:[{id:'inputImage',type:'combinefileinput',required:false,maxinputlenght:16,defaultvalue:'https://cdn.wiro.ai/sample.jpeg'},{id:'prompt',type:'textarea',required:true,defaultvalue:'Sample'},
  {id:'inputImageMask',type:'combinefileinput',required:false,maxinputlenght:1},{id:'resolution',type:'select',required:true,defaultvalue:'1k',options:[{value:'1k'},{value:'2k'},{value:'4k'}]},
  {id:'ratio',type:'select',required:true,defaultvalue:'1:1',options:['1:1','3:2','2:3','16:9'].map(value=>({value}))},{id:'quality',type:'select',required:true,defaultvalue:'low',options:['low','medium','high'].map(value=>({value}))},
  {id:'background',type:'select',required:false,defaultvalue:'auto',options:[{value:'auto'}]},{id:'samples',type:'number',required:true,defaultvalue:'1',minvalue:'1',maxvalue:'10'},{id:'moderation',type:'select',required:false,defaultvalue:'low',options:[{value:'low'}]}]}];
const NANO=[{items:[{id:'inputImage',type:'combinefileinput',required:false,maxinputlenght:14},{id:'prompt',type:'textarea',required:true},
  {id:'resolution',type:'select',required:true,defaultvalue:'1K',options:['1K','2K','4K'].map(value=>({value}))},{id:'aspectRatio',type:'select',required:false,defaultvalue:'auto',options:['auto','1:1','21:9'].map(value=>({value}))},
  {id:'seed',type:'number',required:false},{id:'safetySetting',type:'select',required:false,defaultvalue:'OFF',options:[{value:'OFF'}]}]}];

test('schema mapping finds prompt, references, ratio, resolution, quality and count; extras stay hidden',()=>{
  const sunburst=mapWiroSchema(SUNBURST).controls;
  assert.deepEqual(sunburst.images,{id:'inputImage',type:'combinefileinput',max:16});
  assert.deepEqual(sunburst.ratio,{id:'ratio',options:['1:1','3:2','2:3','16:9'],default:'1:1'});
  assert.equal(sunburst.resolution.default,'1k');assert.deepEqual(sunburst.quality.options,['low','medium','high']);
  assert.deepEqual(sunburst.count,{id:'samples',min:1,max:10});assert.deepEqual(sunburst.fixed,{});
  const nano=mapWiroSchema(NANO).controls;
  assert.equal(nano.ratio.id,'aspectRatio');assert.equal(nano.quality,undefined);assert.equal(nano.images.max,14);
  assert.deepEqual(wiroCatalogFields(nano,'A lemon',{ratio:'21:9'}),{prompt:'A lemon',aspectRatio:'21:9',resolution:'1K'});
  assert.deepEqual(wiroCatalogFields(sunburst,'A lemon',{quality:'medium'}),{prompt:'A lemon',ratio:'1:1',resolution:'1k',quality:'medium',samples:'1'});
  assert.equal(validateWiroOptions(nano,{ratio:'9:16'}),'Unsupported ratio for this Wiro model.');
  assert.equal(validateWiroOptions(nano,{quality:'high'}),'Unsupported quality for this Wiro model.');
  assert.equal(validateWiroOptions(nano,{ratio:'1:1',resolution:'4K'}),null);
  // Required inputs the app cannot fill make the model unsupported instead of sending sample data.
  assert.equal(mapWiroSchema([{items:[{id:'prompt',type:'textarea',required:true},{id:'style',type:'text',required:true,defaultvalue:'x'}]}]).controls,null);
  assert.equal(mapWiroSchema([{items:[{id:'prompt',type:'textarea',required:true},{id:'steps',type:'number',required:true,defaultvalue:'28'}]}]).controls.fixed.steps,'28');
  assert.equal(mapWiroSchema([{items:[{id:'text',type:'textarea'}]}]).controls,null);
  // FLUX.2 Pro style: numeric width/height follow the app's ratio and resolution; untouched they stay unset.
  const flux=mapWiroSchema([{items:[{id:'inputImage',type:'combinefileinput',maxinputlenght:8},{id:'prompt',type:'textarea',required:true},{id:'width',type:'number'},{id:'height',type:'number'},{id:'seed',type:'number'}]}]).controls;
  assert.deepEqual(flux.size,{width:'width',height:'height',max:2048});
  assert.deepEqual(wiroCatalogFields(flux,'A lemon'),{prompt:'A lemon'});
  assert.deepEqual(wiroCatalogFields(flux,'A lemon',{ratio:'16:9',resolution:'1K'}),{prompt:'A lemon',width:'1024',height:'576'});
  assert.deepEqual(wiroCatalogFields(flux,'A lemon',{ratio:'3:4',resolution:'2K'}),{prompt:'A lemon',width:'1536',height:'2048'});
  assert.equal(validateWiroOptions(flux,{ratio:'21:9'}),'Unsupported ratio for this Wiro model.');
  assert.equal(validateWiroOptions(flux,{ratio:'16:9',resolution:'2K'}),null);
});

test('prices: string or array tables, exact match, deferred prices are never shown as $0',()=>{
  const prices=parseWiroPrices('[{"inputs":{"quality":"low","resolution":"1k","ratio":"1:1"},"price":0.006,"priceMethod":"cpr"},{"inputs":{"quality":"medium","resolution":"1k","ratio":"1:1"},"price":0.013,"priceMethod":"cpr"}]');
  assert.equal(wiroPriceFor(prices,{quality:'low',resolution:'1K',ratio:'1:1'}),0.006);
  assert.equal(wiroPriceFor(prices,{quality:'max',resolution:'1k',ratio:'1:1'}),null);
  assert.equal(wiroPriceSummary(prices),'$0.006–$0.013 per image');
  const deferred=parseWiroPrices([{inputs:{},price:0,priceMethod:'cp-readoutput',note:'Computed from tokens'}]);
  assert.equal(wiroPriceFor(deferred,{}),null);assert.equal(wiroPriceSummary(deferred),'Price computed when the task finishes');
  assert.deepEqual(parseWiroPrices('not json'),[]);
});

test('catalog entries use clean slugs, drop foreign image hosts, and refresh flags missing or changed models',()=>{
  const entry=wiroEntryFromTool({cleanslugowner:'google',cleanslugproject:'nano-banana-2-1',slugproject:'nano banana 2.1',title:'Nano Banana 2.1',categories:['image-editing'],
    image:'https://evil.example/cover.webp',parameters:NANO,dynamicprice:[{inputs:{resolution:'1K'},price:0.0336,priceMethod:'cpr'}]},1);
  assert.equal(entry.slug,'google/nano-banana-2-1');assert.equal(entry.image,undefined);assert.equal(appModelForWiroSlug(entry.slug),'gemini-nano-banana-2.1');
  assert.equal(appModelForWiroSlug('black-forest-labs/flux-2-pro'),'wiro:black-forest-labs/flux-2-pro');assert.ok(isWiroModelId('wiro:black-forest-labs/flux-2-pro'));
  assert.equal(refreshWiroEntry(entry,null,2).status,'missing');
  const pricier={...entry,prices:[{inputs:{resolution:'1K'},price:0.04,method:'cpr'}]};
  assert.match(refreshWiroEntry(entry,pricier,2).statusNote,/Price changed/);
  assert.equal(refreshWiroEntry(entry,{...entry},2).status,'ok');
  assert.equal(refreshWiroEntry({...entry,checkedAt:0,prices:[],controls:null},pricier,2).status,'ok','the first load is not reported as a change');
  assert.equal(wiroPriceSummary(parseWiroPrices([{inputs:{},price:0.0336},{inputs:{},price:0.113}])),'$0.0336–$0.113 per image');
  const pixel=parseWiroPrices([{inputs:{inputImage:'QUANTITY:0'},price:0.03,priceMethod:'cp-pixel'}]);
  assert.equal(wiroPriceFor(pixel,{}),null);assert.match(wiroPriceSummary(pixel),/^From \$0\.03 · varies with size/);
});

test('Task/Detail parsing treats string numerics and only pexit "0" at postprocess end as success',()=>{
  const done=api.parseWiroTask(detail('task_postprocess_end','0'));
  assert.equal(done.state,'succeeded');assert.equal(done.costUsd,0.006);assert.equal(done.elapsedSeconds,15);assert.equal(done.outputs[0].url,'https://cdn1.wiro.ai/abc/777_Image.png');
  assert.equal(api.parseWiroTask(detail('task_output','')).state,'running');
  assert.equal(api.parseWiroTask(detail('task_error','')).state,'running','task_error is an intermediate state');
  const failed=api.parseWiroTask(detail('task_postprocess_end','1',{debugerror:'Moderation\nblocked'}));
  assert.equal(failed.state,'failed');assert.equal(failed.error,'Moderation blocked');
  assert.equal(api.parseWiroTask(detail('task_cancel','')).state,'cancelled');
  assert.throws(()=>api.parseWiroTask({tasklist:[]}));
});

test('downloads accept only HTTPS on Wiro hosts, refuse redirects and enforce the size limit',async()=>{
  for(const url of ['https://cdn1.wiro.ai/a.png','https://wiro.ai/a.png'])assert.equal(api.isWiroOutputUrl(url),true);
  for(const url of ['http://cdn1.wiro.ai/a.png','https://cdn1.wiro.ai.evil.example/a.png','https://evilwiro.ai/a.png','https://user:pass@cdn1.wiro.ai/a.png','https://127.0.0.1/a.png','https://cdn1.wiro.ai:8443/a.png','file:///etc/passwd'])
    assert.equal(api.isWiroOutputUrl(url),false,url);
  await assert.rejects(api.downloadWiroOutput('https://example.invalid/a.png',{fetchImpl:()=>assert.fail('never fetched')}),/unsupported image location/);
  let options;
  const ok=await api.downloadWiroOutput('https://cdn1.wiro.ai/a.png',{fetchImpl:async(_url,o)=>{options=o;return new Response(PNG,{headers:{'content-type':'image/png'}});}});
  assert.equal(options.redirect,'error');assert.equal(ok.bytes.length,PNG.length);
  await assert.rejects(api.downloadWiroOutput('https://cdn1.wiro.ai/a.png',{fetchImpl:async()=>new Response('x',{headers:{'content-length':String(60*1024*1024)}})}),/download failed/);
  await assert.rejects(api.downloadWiroOutput('https://cdn1.wiro.ai/a.html',{fetchImpl:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})}),/not a supported image/);
});

test('one signed Run, task ID recorded before polling, image downloaded, actual cost returned',async()=>withKeys(async()=>{
  let polls=0;const tasks=[];
  const wiro=fakeWiro((url,body)=>{
    if(url.pathname.startsWith('/v1/Run/'))return Response.json({result:true,errors:[],taskid:'777',socketaccesstoken:'synthetic'});
    if(url.pathname==='/v1/Task/Detail'){polls++;return Response.json(polls<2?detail('task_output',''):detail('task_postprocess_end','0'));}
    if(url.hostname==='cdn1.wiro.ai')return new Response(PNG,{headers:{'content-type':'image/png'}});
    throw new Error('unexpected '+url);
  });
  const response=await api.requestWiroImage({slug:'openai/gpt-image-2-5-sunburst',fields:{prompt:'A banana',quality:'low',resolution:'1k',ratio:'1:1',samples:'1'},fetchImpl:wiro.fetchImpl,sleep:async()=>{},onTask:id=>tasks.push(id)});
  const data=await response.json();
  assert.deepEqual(tasks,['777']);assert.equal(response.headers.get('x-request-id'),'777');
  assert.equal(Buffer.from(data.data[0].b64_json,'base64').compare(PNG),0);assert.equal(data.usage.cost,0.006);assert.equal(data.output_format,'png');
  assert.equal(wiro.calls.filter(c=>c.path.startsWith('/v1/Run/')).length,1);
  assert.deepEqual(wiro.calls[0].body,{prompt:'A banana',quality:'low',resolution:'1k',ratio:'1:1',samples:'1'});
  assert.ok(wiro.calls.every(c=>c.redirect==='error'));assert.ok(!leaksSecret(wiro.calls));
  for(const call of wiro.calls.filter(c=>c.host==='api.wiro.ai'))assert.equal(call.headers['x-signature'],createHmac('sha256',KEY).update(SECRET+call.headers['x-nonce']).digest('hex'));
}));

test('resume never calls Run; a still-running task becomes a pending wait; failed tasks report Wiro\'s error',async()=>withKeys(async()=>{
  const running=fakeWiro(url=>url.pathname==='/v1/Task/Detail'?Response.json(detail('task_start','')):assert.fail('no Run during resume'));
  await assert.rejects(api.requestWiroImage({slug:'openai/gpt-image-2-5-sunburst',fields:{},resumeTaskId:'777',pollUntil:Date.now()-1,fetchImpl:running.fetchImpl,sleep:async()=>{}}),error=>error instanceof api.WiroTaskPending&&error.taskId==='777');
  assert.ok(running.calls.every(c=>c.path==='/v1/Task/Detail'));
  const failed=fakeWiro(()=>Response.json(detail('task_postprocess_end','1',{debugerror:'Prompt blocked'})));
  const response=await api.requestWiroImage({slug:'openai/gpt-image-2-5-sunburst',fields:{},resumeTaskId:'777',fetchImpl:failed.fetchImpl,sleep:async()=>{}});
  assert.equal(response.status,422);assert.equal((await response.json()).error.message,'Prompt blocked');
  const rejected=fakeWiro(()=>Response.json({result:false,errors:[{message:'Insufficient balance'}]},{status:200}));
  await assert.rejects(api.requestWiroImage({slug:'openai/gpt-image-2-5-sunburst',fields:{prompt:'x'},fetchImpl:rejected.fetchImpl}),/Insufficient balance/);
}));

test('references go as multipart files (never loopback URLs); built-in mapping uses Wiro field names',()=>{
  const form=api.wiroRunBody({prompt:'Edit'},['data:image/png;base64,'+PNG.toString('base64'),'https://cdn.example/ref.webp'],{id:'inputImage',type:'combinefileinput'});
  const parts=form.getAll('inputImage');
  assert.equal(parts.length,2);assert.equal(parts[0].type,'image/png');assert.equal(parts[1],'https://cdn.example/ref.webp');
  assert.throws(()=>api.wiroRunBody({},['http://127.0.0.1:5173/storage/v1/object/authenticated/media/a.png'],{id:'inputImage',type:'combinefileinput'}),/could not be prepared/);
  assert.deepEqual(api.wiroBuiltinRequest('gpt-image-2.5-sunburst',{prompt:'p',quality:'auto',resolution:'1K',aspect_ratio:'16:9',output_format:'png'}).fields,
    {prompt:'p',quality:'low',samples:'1',background:'auto',outputFormat:'png',moderation:'low',resolution:'1k',ratio:'16:9'});
  const exact=api.wiroBuiltinRequest('gpt-image-2.5-sunburst',{prompt:'p',quality:'high',size:'1536x1024',exact_size:true});
  assert.equal(exact.slug,'openai/gpt-image-2-5-sunburst-custom');assert.equal(exact.fields.width,'1536');assert.equal(exact.fields.ratio,undefined);
  assert.throws(()=>api.wiroBuiltinRequest('gpt-image-2.5-sunburst',{prompt:'p',size:'400x1024',exact_size:true}),/between 480 and 3840/);
  assert.deepEqual(api.wiroBuiltinRequest('gemini-nano-banana-2.1',{prompt:'p',resolution:'2K',aspect_ratio:'9:16'}),{slug:'google/nano-banana-2-1',fields:{prompt:'p',resolution:'2K',aspectRatio:'9:16',outputFormat:'png'},imageField:{id:'inputImage',type:'combinefileinput'}});
  assert.equal(api.wiroBuiltinRequest('gemini-3-pro-image-preview',{prompt:'p'}).slug,'google/nano-banana-pro');
});

test('a timed-out Wiro job is recovered from its saved task ID: one Run, then Task/Detail only, actual cost saved',async()=>withKeys(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'banana-wiro-'));const store=new api.LocalWorkspace(path.join(dir,'data'));api.setWorkspace(store);
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldRuntime=process.env.BANANA_RUNTIME,oldWindow=api.wiroPolling.windowMs,oldInterval=api.wiroPolling.intervalMs;
  process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.BANANA_RUNTIME='local';api.wiroPolling.windowMs=30;api.wiroPolling.intervalMs=5;
  let finished=false;
  const wiro=fakeWiro(url=>{
    if(url.pathname.startsWith('/v1/Run/'))return Response.json({result:true,errors:[],taskid:'777'});
    if(url.pathname==='/v1/Task/Detail')return Response.json(finished?detail('task_postprocess_end','0'):detail('task_output',''));
    if(url.hostname==='cdn1.wiro.ai')return new Response(PNG,{headers:{'content-type':'image/png'}});
    throw new Error('Unexpected network request blocked by test');
  });
  globalThis.fetch=wiro.fetchImpl;
  try{
    const payload={id:'wiro-job-1',model:'gpt-image-2.5-sunburst',provider:'wiro',prompt:'Synthetic banana',displayPrompt:'Synthetic banana',aspectRatio:'1:1',resolution:'1K',
      options:{quality:'low'},referenceImages:[],privateReferencePaths:[],folderId:null};
    assert.equal(store.workerRpc('enqueue_image_job',{p_id:payload.id,p_payload:payload,p_metadata:{generationProvider:'wiro'}}).state,'queued');
    const job={id:payload.id,userId:store.user.id};
    await assert.rejects(api.runImageJob(store.client(true),job),error=>error instanceof api.ImageJobWait);
    let saved=store.job(payload.id);
    assert.equal(saved.state,'dispatched');assert.deepEqual([saved.providerTask.provider,saved.providerTask.taskId],['wiro','777']);
    assert.equal(store.get('generations',payload.id).metadata.providerTaskId,'777');
    finished=true;
    await api.runImageJob(store.client(true),job);
    saved=store.job(payload.id);const row=store.get('generations',payload.id);
    assert.equal(saved.state,'completed');assert.equal(row.status,'completed');
    assert.equal(row.metadata.generationProvider,'wiro');assert.equal(row.metadata.providerModel,'openai/gpt-image-2-5-sunburst');
    assert.equal(row.metadata.providerTaskId,'777');assert.deepEqual(row.metadata.generationCost,{usd:0.006,source:'provider_actual'});
    assert.ok(fs.existsSync(store.mediaPath(row.storage_path)));
    assert.equal(wiro.calls.filter(c=>c.path.startsWith('/v1/Run/')).length,1,'the paid Run happened exactly once');
    assert.deepEqual(wiro.calls[0].body,{prompt:wiro.calls[0].body.prompt,quality:'low',samples:'1',background:'auto',outputFormat:'png',moderation:'low',resolution:'1k',ratio:'1:1'});
    assert.ok(!leaksSecret(wiro.calls));
    await api.runImageJob(store.client(true),job);
    assert.equal(wiro.calls.filter(c=>c.path.startsWith('/v1/Run/')).length,1,'a completed job is never submitted again');
  }finally{
    globalThis.fetch=oldFetch;api.wiroPolling.windowMs=oldWindow;api.wiroPolling.intervalMs=oldInterval;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldRuntime===undefined)delete process.env.BANANA_RUNTIME;else process.env.BANANA_RUNTIME=oldRuntime;
    store.close();fs.rmSync(dir,{recursive:true,force:true});
  }
}));

test('catalog route signs server-side, lists image models, stores server-built controls, refresh flags removals',async()=>withKeys(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'banana-wiro-catalog-'));const store=new api.LocalWorkspace(path.join(dir,'data'));
  const calls=[];let gone=false;
  const post=async(endpoint,body)=>{calls.push([endpoint,body]);
    if(endpoint==='/Tool/List')return {result:true,total:'2',tool:[{cleanslugowner:'black-forest-labs',cleanslugproject:'flux-2-pro',title:'FLUX.2 Pro',categories:['text-to-image'],parameters:null,dynamicprice:'[{"inputs":{},"price":0.03,"priceMethod":"cpr"}]'},
      {cleanslugowner:'openai',cleanslugproject:'whisper',title:'Whisper',categories:['speech-to-text'],dynamicprice:'[]'}]};
    if(endpoint==='/Tool/Detail'){if(gone&&body.slugproject==='flux-2-pro')throw new Error('Wiro rejected the request (200): tool-not-accessible.');
      return {result:true,tool:[{cleanslugowner:body.slugowner,cleanslugproject:body.slugproject,title:body.slugproject,categories:['text-to-image'],parameters:NANO,dynamicprice:[{inputs:{},price:0.03,priceMethod:'cpr'}]}]};}
    throw new Error('unexpected');
  };
  const route=api.createWiroCatalog({workspace:store,post});
  const call=async(method,body)=>{let status=0,result;const res={status(v){status=v;return this;},json(v){result=v;return this;}};await route({method,body},res);return {status,result};};
  try{
    let {result}=await call('GET');
    assert.deepEqual(result.models.map(m=>m.appModel),['gemini-3-pro-image-preview','gemini-nano-banana-2.1','gpt-image-2.5-sunburst'],'defaults keep the existing picker order');assert.equal(result.configured,true);
    ({result}=await call('POST',{action:'search',query:'flux'}));
    assert.deepEqual(result.results.map(r=>r.slug),['black-forest-labs/flux-2-pro']);assert.equal(result.results[0].priceSummary,'$0.03 per image');
    assert.deepEqual(calls[0][1].categories,['text-to-image','image-to-image','image-editing']);
    assert.equal((await call('POST',{action:'add',slug:'../../etc'})).status,400);
    assert.equal((await call('POST',{action:'add',slug:'black-forest-labs/flux-2-pro',controls:{prompt:'evil'}})).status,200);
    const stored=(await api.loadWiroControls(store.client(true),'wiro:black-forest-labs/flux-2-pro'));
    assert.equal(stored.prompt,'prompt');assert.equal(stored.ratio.id,'aspectRatio','controls come from Tool/Detail, not the request');
    gone=true;({result}=await call('POST',{action:'refresh'}));
    assert.equal(result.models.find(m=>m.slug==='black-forest-labs/flux-2-pro').status,'missing');
    ({result}=await call('POST',{action:'remove',slug:'black-forest-labs/flux-2-pro'}));assert.equal(result.models.length,3);
    await assert.rejects(api.loadWiroControls(store.client(true),'wiro:black-forest-labs/flux-2-pro'),/Add this model again/);
    delete process.env.WIRO_API_SECRET;assert.equal((await call('POST',{action:'search'})).status,400);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}));

test('picker shows the saved Wiro selection with existing labels; the price label uses Wiro list prices',async()=>{
  const out=path.join(outdir,`wiro-ui-${process.pid}.mjs`);
  await build({entryPoints:[path.join(root,'src/components/WiroModelSettings.tsx')],outfile:out,bundle:true,format:'esm',platform:'node',target:'node22',jsx:'automatic',logLevel:'silent',packages:'external'});
  try{
    const ui=await import(pathToFileURL(out).href);
    const sunburstPrices=[{inputs:{quality:'low',resolution:'1k',ratio:'1:1'},price:0.006,method:'cpr'}];
    const models=[{slug:'google/nano-banana-pro',appModel:'gemini-3-pro-image-preview',builtin:true,title:'Nano Banana Pro (Google)',prices:[],controls:null},
      {slug:'openai/gpt-image-2-5-sunburst',appModel:'gpt-image-2.5-sunburst',builtin:true,title:'GPT Image 2.5 Sunburst (OpenAI)',prices:sunburstPrices,controls:null},
      {slug:'black-forest-labs/flux-2-pro',appModel:'wiro:black-forest-labs/flux-2-pro',builtin:false,title:'FLUX.2 Pro',prices:[{inputs:{},price:0.03,method:'cpr'}],controls:mapWiroSchema(NANO).controls}];
    assert.deepEqual(ui.wiroImageModelOptions(undefined,'gpt-image-2.5-sunburst').map(o=>o.label),['Nano Banana Pro','Nano Banana 2.1','GPT Image 2.5'],'without the desktop selection the picker is unchanged');
    assert.deepEqual(ui.wiroImageModelOptions(models,'gpt-image-2.5-sunburst').map(o=>[o.value,o.label]),[['gemini-3-pro-image-preview','Nano Banana Pro'],['gpt-image-2.5-sunburst','GPT Image 2.5'],['wiro:black-forest-labs/flux-2-pro','FLUX.2 Pro']]);
    const config={imageModel:'gpt-image-2.5-sunburst',resolution:'1K',aspectRatio:'1:1',openaiImageOptions:{quality:'low'}};
    assert.equal(ui.wiroCostLabel(config,models[1],1).label,'~$0.006 · Wiro');
    assert.equal(ui.wiroCostLabel({...config,openaiImageOptions:{quality:'max'}},models[1],1).label,'Wiro · billed at finish');
    assert.equal(ui.wiroCostLabel({imageModel:'wiro:black-forest-labs/flux-2-pro',wiroOptions:{}},models[2],2).label,'~$0.060 · Wiro');
  }finally{fs.rmSync(out,{force:true});}
});
