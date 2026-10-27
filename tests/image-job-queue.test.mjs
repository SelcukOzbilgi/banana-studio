import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { createJobLoop, MAX_JOB_ATTEMPTS } from '../desktop/server/jobLoop.mjs';

const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'banana-queue-'));return {root,store:new LocalWorkspace(path.join(root,'data')),cleanup(){fs.rmSync(root,{recursive:true,force:true});}};};
const enqueue=(store,id)=>store.workerRpc('enqueue_image_job',{p_id:id,p_payload:{prompt:'Synthetic test',displayPrompt:'Synthetic test',referenceImages:[]},p_metadata:{}});
class Wait extends Error { constructor(afterSeconds){super('wait');this.afterSeconds=afterSeconds;} }
const ready=(store,id)=>{const job=store.job(id);job.retryAt=0;store.job(id,job);};

test('an always-failing job is retried with backoff, logged, then failed with a visible message',async()=>{
  const f=fixture();try {
    enqueue(f.store,'job-fail');
    const logs=[];let calls=0;
    const loop=createJobLoop({workspace:f.store,isWait:e=>e instanceof Wait,log:(...args)=>logs.push(args),runJob:async()=>{calls++;throw new Error('Synthetic storage outage');}});
    await Promise.all(loop.wake());
    let job=f.store.job('job-fail');
    assert.equal(job.attempts,1);assert.ok(job.retryAt>Date.now()+4_000,'first retry waits about five seconds');
    assert.equal((await Promise.all(loop.wake())).length,0,'a job is not retried before its backoff');
    for(let attempt=2;attempt<=MAX_JOB_ATTEMPTS;attempt++){ready(f.store,'job-fail');await Promise.all(loop.wake());}
    job=f.store.job('job-fail');
    assert.equal(calls,MAX_JOB_ATTEMPTS);assert.equal(job.state,'failed');
    const row=f.store.get('generations','job-fail');
    assert.equal(row.status,'failed');assert.match(row.metadata.error,/could not be prepared after 5 attempts: Synthetic storage outage\. No provider request was sent/);
    assert.equal(logs.length,MAX_JOB_ATTEMPTS);assert.equal(logs.at(-1)[1].failed,true);
    assert.ok(!JSON.stringify(logs).includes('Synthetic test'),'logs never include the prompt or payload');
    ready(f.store,'job-fail');assert.equal(loop.wake().length,0,'a failed job is never picked up again');
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'job-fail',p_claim:'late'}).action,'stop');
  } finally {f.store.close();f.cleanup();}
});

test('the attempt budget survives a restart; capacity waits are not counted as failures',async()=>{
  const f=fixture();try {
    enqueue(f.store,'job-wait');
    let loop=createJobLoop({workspace:f.store,isWait:e=>e instanceof Wait,log:()=>{},runJob:async()=>{throw new Wait(30);}});
    await Promise.all(loop.wake());
    assert.equal(f.store.job('job-wait').attempts,undefined);assert.ok(f.store.job('job-wait').retryAt>Date.now()+25_000);
    loop=createJobLoop({workspace:f.store,isWait:()=>false,log:()=>{},runJob:async()=>{throw new Error('Synthetic');}});
    for(let i=0;i<MAX_JOB_ATTEMPTS-1;i++){ready(f.store,'job-wait');await Promise.all(loop.wake());}
    f.store.close();f.store=new LocalWorkspace(path.join(f.root,'data'));
    loop=createJobLoop({workspace:f.store,isWait:()=>false,log:()=>{},runJob:async()=>{throw new Error('Synthetic');}});
    ready(f.store,'job-wait');await Promise.all(loop.wake());
    assert.equal(f.store.job('job-wait').state,'failed');
  } finally {f.store.close();f.cleanup();}
});

test('a dispatched job that keeps failing is never dispatched again and says it was not resubmitted',async()=>{
  const f=fixture();try {
    enqueue(f.store,'job-sent');
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'job-sent',p_claim:'claim-1'}).action,'prepare');
    assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:'job-sent',p_claim:'claim-1',p_metadata:{generationProvider:'wiro'}}),true);
    assert.equal(f.store.workerRpc('record_image_job_task',{p_id:'job-sent',p_claim:'claim-1',p_provider:'wiro',p_task_id:'5131461'}),true);
    const actions=[];
    const loop=createJobLoop({workspace:f.store,isWait:()=>false,log:()=>{},runJob:async job=>{
      const claim=f.store.workerRpc('claim_image_job',{p_id:job.id,p_claim:'claim-'+(actions.length+2)});actions.push(claim.action);
      assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:job.id,p_claim:'claim-'+(actions.length+1)}),false);
      throw new Error('Task/Detail unavailable');
    }});
    for(let i=0;i<MAX_JOB_ATTEMPTS;i++){ready(f.store,'job-sent');await Promise.all(loop.wake());}
    assert.deepEqual([...new Set(actions)],['observe']);
    const row=f.store.get('generations','job-sent');
    assert.equal(row.status,'failed');assert.equal(row.metadata.providerTaskId,'5131461');
    assert.match(row.metadata.error,/was sent \(wiro task 5131461\).*It was not resubmitted/);
  } finally {f.store.close();f.cleanup();}
});
