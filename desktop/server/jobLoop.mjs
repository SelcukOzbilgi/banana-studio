export const MAX_JOB_ATTEMPTS=5;

/** Runs saved image jobs. Capacity waits reschedule the job; any other error
 * is logged (message only, never the payload) and counted on the durable job.
 * After MAX_JOB_ATTEMPTS the job fails with a visible gallery message. A
 * dispatched job is only ever observed by the runner, never submitted again. */
export function createJobLoop({ workspace, runJob, isWait, concurrency=2, maxAttempts=MAX_JOB_ATTEMPTS, log=(...args)=>console.warn(...args) }) {
  const active=new Set();let closed=false;
  const onError=(id,error)=>{
    if(isWait(error)){const latest=workspace.job(id);if(latest){latest.retryAt=Date.now()+error.afterSeconds*1000;workspace.job(id,latest);}return;}
    const reason=error instanceof Error?error.message:String(error);
    let result;
    try{result=workspace.workerRpc('record_image_job_failure',{p_id:id,p_error:reason,p_max:maxAttempts});}
    catch{log('Image job failure could not be recorded',{id});return;}
    log('Image job attempt failed',{id,attempt:result?.attempts??null,failed:!!result?.failed,error:reason.slice(0,200)});
  };
  const wake=()=>{
    const runs=[];
    if(closed||active.size>=concurrency)return runs;
    for(const job of workspace.pendingJobs()){
      if(active.size>=concurrency)break;if(active.has(job.id)||job.retryAt>Date.now())continue;active.add(job.id);
      runs.push(Promise.resolve().then(()=>runJob(job)).catch(error=>onError(job.id,error)).finally(()=>active.delete(job.id)));
    }
    return runs;
  };
  return { wake, active, close(){closed=true;} };
}
