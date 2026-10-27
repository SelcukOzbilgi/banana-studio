import { WIRO_BUILTIN_MODELS, WIRO_CATALOG_CATEGORIES, appModelForWiroSlug, isWiroImageModel, isWiroSlug, refreshWiroEntry, wiroEntryFromTool, wiroPriceSummary } from '../../src/lib/wiro/catalog.ts';

const BUILTIN_TITLES={'openai/gpt-image-2-5-sunburst':'GPT Image 2.5 Sunburst (OpenAI)','google/nano-banana-2-1':'Nano Banana 2.1 (Google)','google/nano-banana-pro':'Nano Banana Pro (Google)'};
export const defaultWiroModels=()=>Object.values(WIRO_BUILTIN_MODELS).map(slug=>({slug,title:BUILTIN_TITLES[slug]||slug,categories:[],controls:null,prices:[],checkedAt:0}));
const MAX_MODELS=40;
const isMissing=error=>/tool-not-accessible|not found/i.test(error?.message||'');
const publicEntry=entry=>({...entry,appModel:appModelForWiroSlug(entry.slug),builtin:Object.values(WIRO_BUILTIN_MODELS).includes(entry.slug),priceSummary:wiroPriceSummary(entry.prices||[])});
const credentialsReady=()=>Boolean(process.env.WIRO_API_KEY?.trim()&&process.env.WIRO_API_SECRET?.trim());

/** Wiro model catalog for the desktop app. All Wiro calls are signed here,
 * server-side; the WebView only sends a search term or a model slug. */
export function createWiroCatalog({ workspace, post }) {
  const read=()=>{const saved=workspace.setting('wiroModels');return Array.isArray(saved?.models)?saved.models:defaultWiroModels();};
  const write=models=>{workspace.setting('wiroModels',{version:1,models});return models;};
  const detail=async slug=>{
    const [slugowner,slugproject]=slug.split('/');
    try{const data=await post('/Tool/Detail',{slugowner,slugproject});return wiroEntryFromTool(data?.tool?.[0]);}
    catch(error){if(isMissing(error))return null;throw error;}
  };
  const handlers={
    async search({query,start}){
      const search=typeof query==='string'?query.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,80):'';
      const offset=Number.isSafeInteger(Number(start))&&Number(start)>=0&&Number(start)<=2000?Number(start):0;
      const data=await post('/Tool/List',{start:String(offset),limit:'24',search,categories:[...WIRO_CATALOG_CATEGORIES],hideworkflows:true,summary:true});
      const saved=new Set(read().map(entry=>entry.slug));
      const results=(Array.isArray(data?.tool)?data.tool:[]).map(tool=>wiroEntryFromTool({...tool,parameters:undefined})).filter(Boolean).filter(entry=>isWiroImageModel(entry.categories))
        .map(({controls,unsupportedReason,...entry})=>({...entry,added:saved.has(entry.slug),priceSummary:wiroPriceSummary(entry.prices)}));
      return {results,total:Number(data?.total)||results.length,start:offset};
    },
    async add({slug}){
      if(!isWiroSlug(slug))throw Object.assign(new Error('Choose a model from the Wiro catalog.'),{status:400});
      const models=read();if(models.some(entry=>entry.slug===slug))return {models};
      if(models.length>=MAX_MODELS)throw Object.assign(new Error(`Keep up to ${MAX_MODELS} Wiro models.`),{status:400});
      const entry=await detail(slug);
      if(!entry)throw Object.assign(new Error('Wiro no longer lists this model.'),{status:404});
      if(!isWiroImageModel(entry.categories))throw Object.assign(new Error('Only Wiro image generation and editing models can be added.'),{status:400});
      if(!entry.controls)throw Object.assign(new Error(entry.unsupportedReason||'This Wiro model is not supported yet.'),{status:400});
      return {models:write([...models,entry])};
    },
    async remove({slug}){
      const models=read().filter(entry=>entry.slug!==slug);
      if(!models.length)throw Object.assign(new Error('Keep at least one Wiro model.'),{status:400});
      return {models:write(models)};
    },
    async refresh(){
      const models=[];
      for(const entry of read()){
        try{const fresh=await detail(entry.slug);models.push(refreshWiroEntry(entry,fresh&&BUILTIN_TITLES[entry.slug]?{...fresh,title:BUILTIN_TITLES[entry.slug]}:fresh));}
        catch(error){models.push({...entry,statusNote:'Could not check this model. Try again later.'});}
      }
      return {models:write(models)};
    },
    async reset(){return {models:write(defaultWiroModels())};},
  };
  return async(req,res)=>{
    try{
      if(req.method==='GET')return res.status(200).json({configured:credentialsReady(),models:read().map(publicEntry)});
      if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
      const action=req.body?.action;
      if(!Object.hasOwn(handlers,action))return res.status(400).json({error:'Unsupported Wiro catalog action.'});
      if(!credentialsReady()&&action!=='remove'&&action!=='reset')return res.status(400).json({error:'Open Provider keys and add your Wiro API key and secret.'});
      const result=await handlers[action](req.body);
      return res.status(200).json({configured:credentialsReady(),...result,...(result.models?{models:result.models.map(publicEntry)}:{})});
    }catch(error){
      // Messages are produced by this module or the Wiro client; no credentials.
      return res.status(error?.status||502).json({error:error instanceof Error?error.message.slice(0,300):'Wiro catalog request failed.'});
    }
  };
}
