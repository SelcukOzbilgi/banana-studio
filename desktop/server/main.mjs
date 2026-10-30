import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalWorkspace } from './store.mjs';
import { setWorkspace } from './context.mjs';
import { startLocalServer } from './http.mjs';
import { setQueueWake } from './queue.mjs';
import { createMediaUploader } from './uploads.mjs';
import { createClaudeCliLocator } from './claudeCli.mjs';
import { createClaudeStatusHandler, createClaudeTextHandler } from './claudeText.mjs';
import { createJobLoop } from './jobLoop.mjs';
import { createWiroCatalog } from './wiroCatalog.mjs';
import { wiroPost } from '../../api/_lib/wiro.ts';
import { runImageJob, ImageJobWait } from '../../api/_lib/imageJobRunner.ts';
import openaiText from '../../api/openai-text-generate.ts';
import openrouterText from '../../api/openrouter-text-generate.ts';
import geminiGenerate from '../../api/gemini-generate.ts';
import geminiStatus from '../../api/gemini-status.ts';
import openaiImage from '../../api/openai-image-generate.ts';
import openaiEnqueue from '../../api/openai-image-enqueue.ts';
import openaiRecover from '../../api/openai-image-recover.ts';
import falImage from '../../api/fal-image-generate.ts';
import falStatus from '../../api/fal-status.ts';
import falVideo from '../../api/fal-h3-video.ts';
import falScale from '../../api/fal-video-scale.ts';
import evolinkGenerate from '../../api/evolink-generate.ts';
import evolinkStatus from '../../api/evolink-status.ts';
import youtube from '../../api/youtube.ts';
import youtubeStatus from '../../api/youtube-status.ts';
import seedanceVideo from '../../api/seedance-video.ts';
import { chooseProvider } from '../../api/_lib/providerConfiguration.ts';
import { seedanceProviderError } from '../../src/lib/video/seedanceProviders.ts';

const KEY_NAMES=new Set(['WIRO_API_KEY','WIRO_API_SECRET','OPENAI_API_KEY','OPENROUTER_API_KEY','GEMINI_API_KEY','YOUTUBE_API_KEY','APIFY_TOKEN','FAL_KEY','EVOLINK_API_KEY']);
const io=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const first=await new Promise(resolve=>io.once('line',resolve));
let launch;try{launch=JSON.parse(first);}catch{process.exit(1);}
if(!launch||typeof launch.dataDirectory!=='string'||!path.isAbsolute(launch.dataDirectory))process.exit(1);
const updateKeys=keys=>{for(const name of KEY_NAMES){delete process.env[name];const value=keys?.[name];if(typeof value==='string'&&value.length<4096&&value.trim())process.env[name]=value.trim();}};
process.env.BANANA_RUNTIME='local';
updateKeys(launch.keys);
const workspace=new LocalWorkspace(launch.dataDirectory);setWorkspace(workspace);
let closing=false;
// The dispatch marker is durable. A subsequent run only reconciles a
// dispatched request and cannot submit the same paid generation twice.
const jobs=createJobLoop({workspace,runJob:job=>runImageJob(workspace.client(true),{id:job.id,userId:job.userId}),isWait:error=>error instanceof ImageJobWait});
const wake=()=>{if(!closing)jobs.wake();};
setQueueWake(wake);
const routes={'openai-text-generate':openaiText,'openrouter-text-generate':openrouterText,'gemini-generate':geminiGenerate,'gemini-status':geminiStatus,'openai-image-generate':openaiImage,'openai-image-enqueue':openaiEnqueue,'openai-image-recover':openaiRecover,'fal-image-generate':falImage,'fal-status':falStatus,'fal-h3-video':falVideo,'fal-video-scale':falScale,'evolink-generate':evolinkGenerate,'evolink-status':evolinkStatus,'youtube':youtube,'youtube-status':youtubeStatus};
const prepareMedia=createMediaUploader(workspace);
// Claude (abonelik): availability follows the CLI on disk, never a stored key.
const claudeLocator=createClaudeCliLocator({getConfigured:()=>workspace.setting('claudeCliPath')});
const claude={refresh:async()=>{const state=await claudeLocator.refresh();if(state.available)process.env.BANANA_CLAUDE_CLI=state.path;else delete process.env.BANANA_CLAUDE_CLI;return state;}};
routes['claude-cli-text-generate']=createClaudeTextHandler({locator:claude});
routes['claude-cli-status']=createClaudeStatusHandler({locator:claude,saveConfigured:value=>workspace.setting('claudeCliPath',value)});
routes['gemini-status']=async(req,res)=>{if(req.method==='GET')await claude.refresh();return geminiStatus(req,res);};
routes['wiro-models']=createWiroCatalog({workspace,post:(path,body)=>wiroPost(path,body)});
routes['seedance-video']=async(req,res)=>{
 if(req.method==='POST'){
  try{
   const provider=chooseProvider(req.body?.videoModel,req.body?.provider),error=seedanceProviderError(provider,req.body);
   if(error)return res.status(400).json({error});
   req.body=await prepareMedia(provider,{...req.body,provider});
  }catch(error){return res.status(400).json({error:error.message});}
 }
 return seedanceVideo(req,res);
};
for(const [name,provider] of [['fal-image-generate','fal'],['fal-h3-video','fal'],['fal-video-scale','fal'],['evolink-generate','evolink']]){
 const original=routes[name];routes[name]=async(req,res)=>{if(req.method==='POST'){try{req.body=await prepareMedia(provider,req.body);}catch(error){return res.status(400).json({error:error.message});}}return original(req,res);};
}
const root=launch.webRoot || path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
const http=await startLocalServer({workspace,root,bootstrap:launch.bootstrap,routes,onWake:wake});
process.env.SUPABASE_URL=http.origin;
process.stdout.write(JSON.stringify({event:'ready',origin:http.origin})+'\n');
const timer=setInterval(wake,5_000);wake();
io.on('line',line=>{try{const message=JSON.parse(line);if(message.action==='keys')updateKeys(message.keys);if(message.action==='shutdown')void shutdown();}catch{ /* Do not log configuration or credentials. */ }});
const shutdown=async()=>{if(closing)return;closing=true;jobs.close();clearInterval(timer);await http.close();workspace.close();process.exit(0);};
io.on('close',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
