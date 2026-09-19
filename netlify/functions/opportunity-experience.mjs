const UPSTREAM='https://marketplace.aproposgroupllc.com/api/opportunity-experience';
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default async req=>{
  if(req.method!=='POST')return json(405,{ok:false,error:'POST only.'});
  try{
    const response=await fetch(UPSTREAM,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:await req.text(),signal:AbortSignal.timeout(25000)});
    return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch(error){
    console.error('[opportunity-experience-proxy]',error);
    return json(502,{ok:false,error:'Your survey could not be saved. Please try again.'});
  }
};
export const config={path:'/api/opportunity-experience'};