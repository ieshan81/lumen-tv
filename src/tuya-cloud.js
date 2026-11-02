'use strict';
const crypto=require('crypto');
const ENDPOINTS=Object.freeze({EU:'https://openapi.tuyaeu.com',EU_W:'https://openapi-weaz.tuyaeu.com',US:'https://openapi.tuyaus.com',US_E:'https://openapi-ueaz.tuyaus.com',CN:'https://openapi.tuyacn.com',IN:'https://openapi.tuyain.com',SG:'https://openapi-sg.iotbing.com'});
class TuyaError extends Error{constructor(code,message){super(`Tuya ${code}: ${String(message||'Request failed').slice(0,240)}`);this.code=String(code);}}
function signedHeaders({clientId,clientSecret},method,url,body='',token='',timestamp=Date.now().toString(),nonce=crypto.randomUUID()){
  const hash=crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign=method+'\n'+hash+'\n\n'+url;
  const signature=crypto.createHmac('sha256',clientSecret).update(clientId+token+timestamp+nonce+stringToSign).digest('hex').toUpperCase();
  return{'client_id':clientId,'sign':signature,'sign_method':'HMAC-SHA256','t':timestamp,'nonce':nonce,...(token?{'access_token':token}:{}),'content-type':'application/json'};
}
class TuyaCloud{
  constructor(credentials,{fetchImpl=fetch}={}){if(!credentials?.clientId||!credentials?.clientSecret||!ENDPOINTS[credentials.region])throw new Error('Tuya project credentials or data center are missing.');this.credentials=credentials;this.fetch=fetchImpl;this.endpoint=ENDPOINTS[credentials.region];this.access=null;this.tokenTask=null;}
  async call(method,url,body,token=''){
    if(!/^\/v[12]\.0\//.test(url)||url.includes('://')||url.includes('#'))throw new Error('Unsupported Tuya API path.');
    const serialized=body===undefined?'':JSON.stringify(body);
    let response;try{response=await this.fetch(this.endpoint+url,{method,headers:signedHeaders(this.credentials,method,url,serialized,token),...(serialized?{body:serialized}:{}),signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Error('Tuya cloud could not be reached. Check the laptop internet connection.');}
    if(!response.ok)throw new TuyaError(response.status,'Cloud request was rejected.');
    const text=await response.text();if(text.length>2*1024*1024)throw new Error('Tuya returned an oversized response.');
    let result;try{result=JSON.parse(text);}catch{throw new Error('Tuya returned an invalid response.');}
    if(result.success!==true)throw new TuyaError(result.code,result.msg);
    return result.result;
  }
  async token(){
    if(this.access&&this.access.expires>Date.now()+60000)return this.access.value;
    if(this.tokenTask)return this.tokenTask;
    const task=(async()=>{const result=await this.call('GET','/v1.0/token?grant_type=1');if(!result?.access_token||!Number.isFinite(result.expire_time))throw new Error('Tuya did not return a valid access token.');this.access={value:result.access_token,expires:Date.now()+result.expire_time*1000};return this.access.value;})();
    this.tokenTask=task;try{return await task;}finally{if(this.tokenTask===task)this.tokenTask=null;}
  }
  async request(method,url,body){
    try{return await this.call(method,url,body,await this.token());}
    catch(error){if(method==='GET'&&['1010','1011'].includes(error.code)){this.access=null;return this.call(method,url,body,await this.token());}throw error;}
  }
  devices(){return this.request('GET',`/v1.0/users/${encodeURIComponent(this.credentials.uid)}/devices`);}
  remotes(hub){return this.request('GET',`/v2.0/infrareds/${encodeURIComponent(hub)}/remotes`);}
  keys(hub,remote){return this.request('GET',`/v2.0/infrareds/${encodeURIComponent(hub)}/remotes/${encodeURIComponent(remote)}/keys`);}
  learned(hub,remote){return this.request('GET',`/v2.0/infrareds/${encodeURIComponent(hub)}/remotes/${encodeURIComponent(remote)}/learning-codes`);}
  rawCommand(hub,remote,command){return this.request('POST',`/v2.0/infrareds/${encodeURIComponent(hub)}/remotes/${encodeURIComponent(remote)}/raw/command`,command);}
}
module.exports={TuyaCloud,TuyaError,signedHeaders,ENDPOINTS};
