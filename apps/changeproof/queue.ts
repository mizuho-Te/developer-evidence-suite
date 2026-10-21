/** A bounded local execution queue. Cancellation of waiting jobs never starts them. */
export class RunQueue {
 private active=0; private pending:(()=>void)[]=[];
 readonly concurrency:number;readonly capacity:number;
 constructor(concurrency=2,capacity=100){this.concurrency=concurrency;this.capacity=capacity;}
 get state(){return {active:this.active,queued:this.pending.length};}
 async run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw Error('CANCELLED_BEFORE_START');
  if(this.pending.length>=this.capacity)throw Error('QUEUE_FULL');
  await new Promise<void>((resolve,reject)=>{
   const start=()=>{signal?.removeEventListener('abort',cancel);this.active++;resolve();};
   const cancel=()=>{const i=this.pending.indexOf(start);if(i>=0){this.pending.splice(i,1);reject(Error('CANCELLED_BEFORE_START'));}};
   if(this.active<this.concurrency)start();else {this.pending.push(start);signal?.addEventListener('abort',cancel,{once:true});}
  });
  try{return await work();}finally{this.active--;this.pending.shift()?.();}
 }
}
export const localRunQueue=new RunQueue();
