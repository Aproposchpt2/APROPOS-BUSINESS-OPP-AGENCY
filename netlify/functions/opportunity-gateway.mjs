const MARKETPLACE='https://marketplace.aproposgroupllc.com';
const FCP='https://fcp.aproposgroupllc.com';

const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
}});

function upstream(type,action){
  if(type==='state-local') return MARKETPLACE+'/api/complimentary-opportunity';
  if(type==='federal'){
    if(action==='claim') return FCP+'/.netlify/functions/ngcc-federal-claim';
    if(action==='workspace') return FCP+'/.netlify/functions/ngcc-federal-workspace';
    if(action==='package') return FCP+'/.netlify/functions/ngcc-federal-package';
  }
  return '';
}

export default async req=>{
  try{
    const url=new URL(req.url);
    const type=String(url.searchParams.get('type')||'').trim();
    const action=String(url.searchParams.get('action')||'').trim();
    const base=upstream(type,action);
    if(!base) return json(400,{ok:false,error:'A valid opportunity type and action are required.'});

    const token=String(url.searchParams.get('t')||'').trim();
    const params=new URLSearchParams();
    if(type==='state-local') params.set('action',action);
    if(token) params.set('t',token);

    const timeout=action==='package'?120000:35000;
    const init={method:req.method,headers:{accept:req.headers.get('accept')||'*/*'},signal:AbortSignal.timeout(timeout)};
    if(req.method!=='GET'&&req.method!=='HEAD'){
      init.headers['content-type']='application/json';
      init.body=await req.text();
    }

    const target=params.toString()?base+'?'+params.toString():base;
    const r=await fetch(target,init);
    const headers={
      'content-type':r.headers.get('content-type')||'application/json; charset=utf-8',
      'cache-control':action==='package'?'private, no-store':'no-store',
      'x-content-type-options':'nosniff'
    };
    const cd=r.headers.get('content-disposition'); if(cd) headers['content-disposition']=cd;
    const pkg=r.headers.get('x-apropos-package-status'); if(pkg) headers['x-apropos-package-status']=pkg;
    const report=r.headers.get('x-apropos-report-status'); if(report) headers['x-apropos-report-status']=report;
    return new Response(await r.arrayBuffer(),{status:r.status,headers});
  }catch(error){
    console.error('[opportunity-gateway]',error);
    const timedOut=String(error?.name||'')==='TimeoutError';
    return json(502,{ok:false,error:timedOut?'The contract package request timed out before completion. Please try again.':'The Apropos opportunity service is temporarily unavailable.'});
  }
};

export const config={path:'/api/opportunity-gateway'};