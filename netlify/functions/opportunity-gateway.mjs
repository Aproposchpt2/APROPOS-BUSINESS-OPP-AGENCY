const MARKETPLACE='https://marketplace.aproposgroupllc.com';

const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
}});

function upstream(type){
  if(type==='state-local') return MARKETPLACE+'/api/complimentary-opportunity';
  if(type==='federal') return MARKETPLACE+'/api/federal-opportunity';
  return '';
}

export default async req=>{
  try{
    const url=new URL(req.url);
    const type=String(url.searchParams.get('type')||'').trim();
    const action=String(url.searchParams.get('action')||'').trim();
    const base=upstream(type);
    if(!base) return json(400,{ok:false,error:'A valid opportunity type is required.'});

    const params=new URLSearchParams({action});
    const token=String(url.searchParams.get('t')||'').trim();
    if(token) params.set('t',token);

    const init={method:req.method,headers:{accept:req.headers.get('accept')||'*/*'},signal:AbortSignal.timeout(action==='package'?90000:35000)};
    if(req.method!=='GET'&&req.method!=='HEAD'){
      init.headers['content-type']='application/json';
      init.body=await req.text();
    }

    const r=await fetch(base+'?'+params.toString(),init);
    const headers={
      'content-type':r.headers.get('content-type')||'application/json; charset=utf-8',
      'cache-control':action==='package'?'private, no-store':'no-store',
      'x-content-type-options':'nosniff'
    };
    const cd=r.headers.get('content-disposition'); if(cd) headers['content-disposition']=cd;
    return new Response(await r.arrayBuffer(),{status:r.status,headers});
  }catch(error){
    console.error('[opportunity-gateway]',error);
    return json(502,{ok:false,error:'The Apropos opportunity service is temporarily unavailable.'});
  }
};

export const config={path:'/api/opportunity-gateway'};