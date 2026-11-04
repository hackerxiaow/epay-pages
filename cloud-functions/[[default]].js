var xa=Object.create;var Yt=Object.defineProperty;var va=Object.getOwnPropertyDescriptor;var ka=Object.getOwnPropertyNames;var _a=Object.getPrototypeOf,Sa=Object.prototype.hasOwnProperty;var ne=(e,t,r)=>()=>{if(r)throw r[0];try{return e&&(t=e(e=0)),t}catch(n){throw r=[n],n}};var zr=(e,t)=>()=>{try{return t||e((t={exports:{}}).exports,t),t.exports}catch(r){throw t=0,r}},Qt=(e,t)=>{for(var r in t)Yt(e,r,{get:t[r],enumerable:!0})},Ca=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of ka(t))!Sa.call(e,o)&&o!==r&&Yt(e,o,{get:()=>t[o],enumerable:!(n=va(t,o))||n.enumerable});return e};var Hr=(e,t,r)=>(r=e!=null?xa(_a(e)):{},Ca(t||!e||!e.__esModule?Yt(r,"default",{value:e,enumerable:!0}):r,e));function v(){return Math.floor(Date.now()/1e3)}function dr(){let e=new Date,t=(n,o=2)=>String(n).padStart(o,"0");return`${e.getFullYear()}${t(e.getMonth()+1)}${t(e.getDate())}${t(e.getHours())}${t(e.getMinutes())}${t(e.getSeconds())}`+String(Math.floor(Math.random()*9e5)+1e5)}function $(e){return(e/100).toFixed(2)}function O(e){let t=Number(e);return!isFinite(t)||t<=0?0:Math.round(t*100)}function lr(e){let t=new Uint8Array(e/2);return crypto.getRandomValues(t),Array.from(t).map(r=>r.toString(16).padStart(2,"0")).join("")}function oe(e){let t="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",r="";for(let n=0;n<e;n++)r+=t[Math.floor(Math.random()*t.length)];return r}var N=ne(()=>{});var Mn=zr((Rc,jn)=>{"use strict";var yr=Object.defineProperty,Da=Object.getOwnPropertyDescriptor,Ua=Object.getOwnPropertyNames,La=Object.prototype.hasOwnProperty,za=(e,t)=>{for(var r in t)yr(e,r,{get:t[r],enumerable:!0})},Ha=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of Ua(t))!La.call(e,o)&&o!==r&&yr(e,o,{get:()=>t[o],enumerable:!(n=Da(t,o))||n.enumerable});return e},Ka=e=>Ha(yr({},"__esModule",{value:!0}),e),Pn={};za(Pn,{InvalidKeyError:()=>bt,InvalidStoreNameError:()=>et,MissingProjectIdError:()=>Rn,PagesBlobError:()=>ae,PreconditionFailedError:()=>mr,QuotaExceededError:()=>Ga,RateLimitedError:()=>Ja,Store:()=>Tn,getStore:()=>fs,listStores:()=>ms});jn.exports=Ka(Pn);var ae=class extends Error{code;constructor(e,t){super(`PagesBlob: ${t}`),this.name="PagesBlobError",this.code=e}},bt=class extends ae{constructor(e){super("INVALID_KEY",e)}},et=class extends ae{constructor(e){super("INVALID_STORE_NAME",e)}},ur=class extends ae{constructor(e){super("MISSING_ENVIRONMENT",`Environment not configured for Pages Blob. Missing: ${e.join(", ")}. Supply these properties when creating a store, or ensure the function is running in a Pages environment.`)}},Ga=class extends ae{constructor(){super("QUOTA_EXCEEDED","storage quota exceeded")}},Ja=class extends ae{constructor(){super("RATE_LIMITED","request rate limited, please retry later")}},Rn=class extends ae{constructor(){super("MISSING_PROJECT_ID","projectId is required when using API token mode. Please supply { name, projectId, token } to getStore() / listStores().")}},we=class extends ae{constructor(e){super("CREDENTIAL_ERROR",e)}},G=class extends ae{constructor(e,t){super("COS_ERROR",`COS returned ${e}: ${t}`)}},mr=class extends ae{constructor(){super("PRECONDITION_FAILED","conditional write failed (key already exists)")}};function ke(e){if(e==="")throw new bt("Blob key must not be empty.");if(e.startsWith("/")||e.startsWith("%2F"))throw new bt("Blob key must not start with forward slash (/).");if(new TextEncoder().encode(e).length>600)throw new bt("Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long.")}function Fa(e){if(e==="")throw new et("Store name must not be empty.");if(e.includes("/")||e.includes(":"))throw new et("Store name must not contain forward slashes (/) or colons (:).");if(!/^[a-zA-Z0-9_-]+$/.test(e))throw new et("Store name must only contain letters, digits, underscores, and hyphens.");if(new TextEncoder().encode(e).length>64)throw new et("Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long.")}var Tn=class{cosClient;storeName;defaultConsistency;constructor(e,t,r="eventual"){this.cosClient=e,this.storeName=t,this.defaultConsistency=r}resolveConsistency(e){return e??this.defaultConsistency}async set(e,t,r){ke(e);let n=await this.cosClient.putObject(this.storeName,e,t,{onlyIfNew:r?.onlyIfNew,cacheControl:r?.cacheControl});if(r?.onlyIfNew&&n.statusCode===412)throw new mr}async setJSON(e,t,r){ke(e);let n=JSON.stringify(t),o=await this.cosClient.putObject(this.storeName,e,n,{onlyIfNew:r?.onlyIfNew,contentType:"application/json",cacheControl:r?.cacheControl});if(r?.onlyIfNew&&o.statusCode===412)throw new mr}async createUploadUrl(e,t){ke(e);let{url:r,expiresAt:n}=await this.cosClient.createPresignedPutUrl(this.storeName,e,{expireSeconds:t?.expireSeconds,contentType:t?.contentType});return{url:r,key:e,expiresAt:n}}async get(e,t){ke(e);let r=this.resolveConsistency(t?.consistency),n=await this.cosClient.getObject(this.storeName,e,r);if(n===null)return null;let{body:o}=n,a=t?.type??"text",s=new TextDecoder("utf-8");switch(a){case"text":return s.decode(o);case"json":return JSON.parse(s.decode(o));case"arrayBuffer":return o.buffer.slice(o.byteOffset,o.byteOffset+o.byteLength);case"blob":return new Blob([o]);case"stream":return new ReadableStream({start(i){i.enqueue(o),i.close()}});default:return s.decode(o)}}async getMetadata(e,t){ke(e);let r=this.resolveConsistency(t?.consistency);return this.cosClient.headObject(this.storeName,e,r)}async getWithHeaders(e,t){ke(e);let r=this.resolveConsistency(t?.consistency),n=await this.cosClient.getObject(this.storeName,e,r);return n?{body:new TextDecoder("utf-8").decode(n.body),headers:n.headers||{}}:null}async delete(e){ke(e),await this.cosClient.deleteObject(this.storeName,e)}async list(e){let t=e?.paginate!==!1,r=e?.limit,n=[],o=[],a=this.resolveConsistency(e?.consistency),s=e?.cursor||"",i=!0,c;for(;i;){let d=r!==void 0?r-n.length:1e3,l=Math.min(d,1e3);if(l<=0)break;let u=await this.cosClient.listObjects(this.storeName,{prefix:e?.prefix,delimiter:e?.directories?"/":void 0,marker:s||void 0,maxKeys:l,consistency:a});for(let b of u.contents)n.push({key:b.key,etag:b.etag});o.push(...u.commonPrefixes),r!==void 0&&n.length>=r?(n.length=r,(u.isTruncated||u.contents.length===l)&&(c=u.nextMarker),i=!1):u.isTruncated?!t&&r===void 0?(c=u.nextMarker,i=!1):s=u.nextMarker:i=!1}return{blobs:n,directories:o,...c?{cursor:c}:{}}}},Ya=new TextEncoder;function gr(e){let t=Ya.encode(e),r=new ArrayBuffer(t.byteLength),n=new Uint8Array(r);return n.set(t),n}function En(e){let t=e instanceof Uint8Array?e:new Uint8Array(e),r="";for(let n=0;n<t.length;n++)r+=t[n].toString(16).padStart(2,"0");return r}async function wn(e,t){let r=await crypto.subtle.importKey("raw",gr(e),{name:"HMAC",hash:"SHA-1"},!1,["sign"]),n=await crypto.subtle.sign("HMAC",r,gr(t));return En(n)}async function Qa(e){let t=await crypto.subtle.digest("SHA-1",gr(e));return En(t)}function xt(e){return encodeURIComponent(e).replace(/[!'()*]/g,t=>"%"+t.charCodeAt(0).toString(16).toUpperCase())}function tt(e){try{return decodeURIComponent(e)}catch{return e}}function Wa(e){return e.split("/").map(t=>tt(t)).join("/")}function vt(e){return Wa(tt(e))}function An(e){return e.split("/").map(t=>xt(tt(t))).join("/")}var Va=new Set(["cache-control","content-disposition","content-encoding","content-length","content-md5","content-type","expect","expires","if-match","if-modified-since","if-none-match","if-unmodified-since","origin","range","transfer-encoding"]);function Xa(e){return e==="host"||e==="x-cos-security-token"?!1:!!(Va.has(e)||e.startsWith("x-cos-"))}function bn(e){if(!e)return[];let t=[];for(let[r,n]of Object.entries(e))n!=null&&t.push([r.toLowerCase(),String(n)]);return t.sort(([r],[n])=>r<n?-1:r>n?1:0),t}function xn(e){return e.map(([t,r])=>`${xt(t)}=${xt(r)}`).join("&")}function vn(e){return e.map(([t])=>xt(t)).join(";")}async function On(e){let t=e.method.toLowerCase(),r=e.pathname.startsWith("/")?e.pathname:`/${e.pathname}`,n=Math.floor(Date.now()/1e3),o=n+(e.expireSeconds??3600),a=`${n};${o}`,s=bn(e.headers).filter(([F])=>Xa(F)),i=vn(s),c=xn(s),d=bn(e.query),l=vn(d),u=xn(d),b=`${t}
${r}
${u}
${c}
`,g=`sha1
${a}
${await Qa(b)}
`,k=await wn(e.secretKey,a),C=await wn(k,g),P=["q-sign-algorithm=sha1",`q-ak=${e.secretId}`,`q-sign-time=${a}`,`q-key-time=${a}`,`q-header-list=${i}`,`q-url-param-list=${l}`,`q-signature=${C}`].join("&"),R={};for(let[F,E]of s)R[F]=E;return{authorization:P,signedHeaders:R}}async function Za(e){let t=new URL(e.domain),r=tt(e.key),n=`/${vt(e.key)}`,o=`/${An(r)}`;t.pathname=o;let{authorization:a}=await On({method:e.method,pathname:n,query:e.query,headers:e.headers,secretId:e.credential.secretId,secretKey:e.credential.secretKey,expireSeconds:e.expireSeconds});if(e.query)for(let[s,i]of Object.entries(e.query))i!=null&&t.searchParams.set(s,String(i));for(let s of a.split("&")){let i=s.indexOf("=");if(i===-1)continue;let c=s.slice(0,i),d=s.slice(i+1);t.searchParams.set(c,d)}return e.credential.sessionToken&&t.searchParams.set("x-cos-security-token",e.credential.sessionToken),t.toString()}async function Qe(e){let t=new URL(e.domain),r=e.key?tt(e.key):"",n=e.key?`/${vt(e.key)}`:"/",o=r?`/${An(r)}`:"/";if(t.pathname=o,e.query)for(let[u,b]of Object.entries(e.query))b!=null&&t.searchParams.set(u,String(b));let{authorization:a}=await On({method:e.method,pathname:n,query:e.query,headers:e.headers,secretId:e.credential.secretId,secretKey:e.credential.secretKey}),s=new Headers;if(e.headers)for(let[u,b]of Object.entries(e.headers))b!=null&&s.set(u,String(b));s.set("Authorization",a),e.credential.sessionToken&&s.set("x-cos-security-token",e.credential.sessionToken);let i=t.toString(),c={method:e.method,headers:s,body:e.body??void 0,signal:e.signal},d=2,l;for(let u=0;u<=d;u++)try{return await fetch(i,c)}catch(b){if(l=b,b instanceof DOMException&&b.name==="AbortError")throw b;u<d&&await new Promise(g=>setTimeout(g,1e3*(u+1)))}throw l}var es="blob.edgeone.site",ts="blob-nocache.edgeone.site",rs="max-age=0, stale-while-revalidate=60",$n=class Z{credentialManager;bucket="";region="";keyPrefix="";cachedDomain="";uncachedDomain="";initialized=!1;static buildErrorDetail(t,r,n,o,a){let s=n?`${r}/${n}`:r,i=a?` [request-id: ${a}]`:"";return`${t} ${s} - ${ns(o)}${i}`}constructor(t){this.credentialManager=t}computeSubdomain(t){let r=[];if(t.appId&&r.push(t.appId),t.zoneId&&r.push(t.zoneId),t.projectId&&r.push(t.projectId),r.length>=2)return r.join("-");if(t.resourcePrefix){let n=t.resourcePrefix.replace(/\/?\*$/,"").split("/").filter(Boolean);if(n.length>=2)return n.slice(0,Math.min(n.length,3)).join("-")}return""}async ensureInitialized(){if(this.initialized)return;let t=await this.credentialManager.getCredential();!this.keyPrefix&&t.resourcePrefix&&(this.keyPrefix=t.resourcePrefix.replace(/\/?\*$/,""));let r=t.edgeRegion==="CN",n=t.cosMainland,o=t.cosOverseas,a=r?n||o:o||n;!this.bucket&&a&&(this.bucket=a.bucket,this.region=a.region);let s=this.computeSubdomain(t);if(!s)throw new G(0,"unable to derive tenant subdomain from credential; missing appId/zoneId/projectId or resourcePrefix");this.cachedDomain=`https://${s}.${es}`,this.uncachedDomain=`https://${s}.${ts}`,this.initialized=!0}async resolveDomain(t){return await this.ensureInitialized(),t==="strong"?this.uncachedDomain:this.cachedDomain}async resolveCredential(){let t=await this.credentialManager.getCredential();return{secretId:t.tmpSecretId,secretKey:t.tmpSecretKey,sessionToken:t.sessionToken}}buildCosKey(t,r){return`${this.keyPrefix}/${t}/${r}`}async getDomains(){return await this.ensureInitialized(),{cached:this.cachedDomain,uncached:this.uncachedDomain}}async putObject(t,r,n,o){let a=await this.resolveDomain("strong"),s=await this.resolveCredential(),i=this.buildCosKey(t,r),{defaultCacheControl:c=rs}=await this.credentialManager.getCredential(),d=o?.cacheControl===null?void 0:o?.cacheControl??c,l={};o?.onlyIfNew&&(l["If-None-Match"]="*"),d&&(l["Cache-Control"]=d),o?.contentType&&(l["Content-Type"]=o.contentType);try{let u=await Qe({domain:a,method:"PUT",key:i,headers:l,body:n,credential:s});if(u.status===412)return await u.arrayBuffer().catch(()=>{}),{etag:"",statusCode:412};if(!u.ok){let g=await We(u);throw new G(u.status,Z.buildErrorDetail("PUT",a,i,g||`status ${u.status}`,Ve(u)))}let b=u.headers.get("etag")||"";return await u.arrayBuffer().catch(()=>{}),{etag:b,statusCode:u.status}}catch(u){throw u instanceof G?u:new G(0,Z.buildErrorDetail("PUT",a,i,Xe(u)))}}async createPresignedPutUrl(t,r,n){let o=await this.resolveDomain("strong"),a=await this.resolveCredential(),s=this.buildCosKey(t,r),i={};n?.contentType&&(i["Content-Type"]=n.contentType);let c=n?.expireSeconds??3600,d=await Za({domain:o,method:"PUT",key:s,headers:i,credential:a,expireSeconds:c}),l=Math.floor(Date.now()/1e3)+c;return{url:d,expiresAt:l}}async getObject(t,r,n){let o=await this.resolveDomain(n),a=await this.resolveCredential(),s=this.buildCosKey(t,r);try{let i=await Qe({domain:o,method:"GET",key:s,credential:a});if(i.status===404)return await i.arrayBuffer().catch(()=>{}),null;if(!i.ok){let l=await We(i);throw new G(i.status,Z.buildErrorDetail("GET",o,s,l||`status ${i.status}`,Ve(i)))}let c=new Uint8Array(await i.arrayBuffer()),d=kn(i.headers);return{body:c,contentType:d["content-type"],headers:d}}catch(i){throw i instanceof G?i:new G(0,Z.buildErrorDetail("GET",o,s,Xe(i)))}}async headObject(t,r,n){let o=await this.resolveDomain(n),a=await this.resolveCredential(),s=this.buildCosKey(t,r);try{let i=await Qe({domain:o,method:"HEAD",key:s,credential:a});if(i.status===404)return null;if(!i.ok){let d=await We(i);throw new G(i.status,Z.buildErrorDetail("HEAD",o,s,d||`status ${i.status}`,Ve(i)))}let c=kn(i.headers);return{cacheControl:c["cache-control"],contentType:c["content-type"],etag:c.etag,headers:c}}catch(i){throw i instanceof G?i:new G(0,Z.buildErrorDetail("HEAD",o,s,Xe(i)))}}async deleteObject(t,r){let n=await this.resolveDomain("strong"),o=await this.resolveCredential(),a=this.buildCosKey(t,r);try{let s=await Qe({domain:n,method:"DELETE",key:a,credential:o});if(s.status===204||s.status===404||s.ok){await s.arrayBuffer().catch(()=>{});return}let i=await We(s);throw new G(s.status,Z.buildErrorDetail("DELETE",n,a,i||`status ${s.status}`,Ve(s)))}catch(s){throw s instanceof G?s:new G(0,Z.buildErrorDetail("DELETE",n,a,Xe(s)))}}async listObjects(t,r){await this.ensureInitialized();let n=`${this.keyPrefix}/${t}/`,o=r?.prefix?n+r.prefix:n,a=await this.getBucketRaw({prefix:o,delimiter:r?.delimiter,marker:r?.marker,maxKeys:r?.maxKeys,consistency:r?.consistency}),s=a.contents.map(c=>{let d=c.key,l=d.startsWith(n)?d.slice(n.length):d;return l?{key:l,etag:c.etag}:null}).filter(c=>c!==null),i=a.commonPrefixes.map(c=>c.startsWith(n)?c.slice(n.length):c).filter(c=>!!c);return{contents:s,commonPrefixes:i,isTruncated:a.isTruncated,nextMarker:a.nextMarker}}async listStores(t){let r=[],n="",o=!0;for(;o;){await this.ensureInitialized();let a=`${this.keyPrefix}/`,s=await this.getBucketRaw({prefix:a,delimiter:"/",maxKeys:1e3,marker:n||void 0,consistency:t});for(let i of s.commonPrefixes){let c=i.startsWith(a)?i.slice(a.length,-1):i.slice(0,-1);c&&r.push(c)}if(o=s.isTruncated,n=s.nextMarker,!o||!n)break}return r}async getBucketRaw(t){let r=await this.resolveDomain(t.consistency),n=await this.resolveCredential(),o={prefix:vt(t.prefix)};t.delimiter&&(o.delimiter=t.delimiter),t.marker&&(o.marker=vt(t.marker)),t.maxKeys&&(o["max-keys"]=t.maxKeys);try{let a=await Qe({domain:r,method:"GET",query:o,credential:n});if(!a.ok){let i=await We(a);throw new G(a.status,Z.buildErrorDetail("LIST",r,t.prefix,i||`status ${a.status}`,Ve(a)))}let s=await a.text();return os(s)}catch(a){throw a instanceof G?a:new G(0,Z.buildErrorDetail("LIST",r,t.prefix,Xe(a)))}}};function ns(e){return e.replace(/[a-zA-Z0-9\-]+\.cos\.[a-zA-Z0-9\-.]+\.myqcloud\.com/gi,"[cos-origin]").replace(/[a-zA-Z0-9\-]+\.cos\.[a-zA-Z0-9\-.]+\.tencentcos\.cn/gi,"[cos-origin]")}async function We(e){try{return await e.text()}catch{return""}}function Ve(e){return e.headers.get("x-cos-request-id")||e.headers.get("x-eo-log-id")||void 0}function Xe(e){let t=e,r=t.message||String(e),n=t.cause;if(n){let o=n.message||n.code||"";return o?`${r} (${o})`:r}return r}function kn(e){let t={};return e.forEach((r,n)=>{t[n.toLowerCase()]=r}),t}function os(e){let t=[],r=/<Contents>([\s\S]*?)<\/Contents>/g,n;for(;(n=r.exec(e))!==null;){let c=n[1],d=Ze(c,"Key"),l=Ze(c,"ETag");d!==null&&t.push({key:pr(d),etag:l||""})}let o=[],a=/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g;for(;(n=a.exec(e))!==null;){let c=n[1],d=Ze(c,"Prefix");d!==null&&o.push(pr(d))}let s=Ze(e,"IsTruncated")==="true",i=Ze(e,"NextMarker")||"";return{contents:t,commonPrefixes:o,isTruncated:s,nextMarker:pr(i)}}function Ze(e,t){let r=new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`).exec(e);return r?r[1]:null}function pr(e){return e.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}var as="X-RateLimit-Reset";async function hr(e,t,r=2){t.signal?.throwIfAborted?.();try{let n=await fetch(e,t);if(r>0&&(n.status===429||n.status>=500)){let o=_n(n.headers.get(as));return await Sn(o,t.signal),hr(e,t,r-1)}return n}catch(n){if(r===0||n instanceof DOMException&&n.name==="AbortError")throw n;let o=_n();return await Sn(o,t.signal),hr(e,t,r-1)}}function _n(e){return e?Math.max(Number(e)*1e3-Date.now(),500):1500}function Sn(e,t){return new Promise((r,n)=>{if(t?.aborted)return n(t.reason);let o=setTimeout(()=>{t?.removeEventListener("abort",a),r()},e),a=()=>{clearTimeout(o),n(t.reason)};t?.addEventListener("abort",a,{once:!0})})}var ss="prod";function is(){let e=typeof process<"u"?process.env.PAGES_BLOB_STS_ENV:void 0;return e==="test"||e==="prod"?e:ss}var cs=300,ds="https://blob-sts.edgeone.site/",Nn=class{authToken;projectId;cached=null;constructor(e,t){this.authToken=e,this.projectId=t}async getCredential(){if(this.cached&&!this.isExpired(this.cached))return this.cached;let e=await this.fetchCredential();return this.cached=e,e}clearCache(){this.cached=null}isExpired(e){let t=Math.floor(Date.now()/1e3);return e.expiredTime-t<cs}async fetchCredential(){for(let e=1;e<=3;e++){let t=new AbortController,r=setTimeout(()=>t.abort(),1e4),n;try{n=await hr(ds,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.authToken}`,"X-Env":is()},body:JSON.stringify(this.projectId?{ProjectId:this.projectId}:{}),signal:t.signal})}catch(s){if(e<3){await fr(500*e);continue}throw new we(`failed to obtain STS credential: ${s.message||"timeout"}`)}finally{clearTimeout(r)}if(n.status===413)throw new we("storage quota exceeded");if(n.status===429)throw new we("rate limited, please retry later");if(!n.ok){if(n.status>=500&&e<3){await fr(500*e);continue}let s=await n.text().catch(()=>"unknown error");throw new we(`failed to obtain STS credential: ${n.status} ${s}`)}let o=await n.json(),a=o.data&&typeof o.data=="object"?o.data:o;if(a.tmpSecretId&&a.tmpSecretKey&&a.sessionToken&&a.expiredTime){let s=a.cosMainland,i=a.cosOverseas,c=n.headers.get("X-Edge-Region")||void 0;return{tmpSecretId:a.tmpSecretId,tmpSecretKey:a.tmpSecretKey,sessionToken:a.sessionToken,expiredTime:a.expiredTime,appId:a.appId||void 0,zoneId:a.zoneId||void 0,projectId:a.projectId||void 0,resourcePrefix:a.resourcePrefix||void 0,cosMainland:s||void 0,cosOverseas:i||void 0,edgeRegion:c,defaultCacheControl:typeof a.defaultCacheControl=="string"&&a.defaultCacheControl?a.defaultCacheControl:void 0}}if(a.code!==void 0&&a.code!==0){let s=a.msg||a.message||"unknown error";throw new we(`credential exchange failed (code=${a.code}): ${s}`)}if(o.code!==void 0&&o.code!==0){let s=o.msg||o.message||"unknown error";throw new we(`credential exchange failed (code=${o.code}): ${s}`)}if(e<3){await fr(500*e);continue}throw new we("invalid STS credential response")}throw new we("invalid STS credential response")}};function fr(e){return new Promise(t=>setTimeout(t,e))}var ls="{{PAGES_BLOB_DEPLOY_CREDENTIAL}}";function us(){let e={},t=ps();if(t)e.deployCredential=t;else{let n=Cn("PAGES_BLOB_DEPLOY_CREDENTIAL");n&&(e.deployCredential=n)}let r=Cn("PAGES_PROJECT_ID");return r&&(e.projectId=r),e}function ps(){let e=ls;if(!(e.startsWith("{{")&&e.endsWith("}}")))return e||void 0}function Cn(e){if(typeof process<"u"&&process.env)return process.env[e]}function fs(e){let t=typeof e=="string"?e:e.name;Fa(t);let r=In(typeof e=="string"?void 0:e),n=new Nn(r.authToken,r.projectId),o=new $n(n);return new Tn(o,t,r.consistency??"eventual")}async function ms(e){let t=In(e?{name:"__list__",projectId:e.projectId,token:e.token,consistency:e.consistency}:void 0),r=new Nn(t.authToken,t.projectId);return{stores:(await new $n(r).listStores(t.consistency)).map(n=>({name:n}))}}function In(e){let t=us(),r=e?.token||t.deployCredential,n=e?.projectId||t.projectId;if(e?.token||t.projectId){if(!n)throw new Rn;if(!r)throw new ur(["token"]);return{authToken:r,projectId:n,consistency:e?.consistency}}if(e?.projectId&&!r)throw new ur(["token"]);if(!t.deployCredential)throw new ur(["deployCredential"]);return{authToken:t.deployCredential,consistency:e?.consistency}}});function Bn(e){let t=e;return t?.code==="MISSING_ENVIRONMENT"||/missing:.*deploycredential/i.test(String(t?.message||""))}function gs(){let e=process.env.EPAY_BLOB_PROJECT_ID||process.env.PAGES_PROJECT_ID||"",t=process.env.EPAY_BLOB_TOKEN||"";return e&&t?{projectId:e,token:t}:null}function wr(e){let t=String(e?.message||e);return new xr(t,hs)}function ys(e){let t=e,r=`${t?.name??""} ${t?.code??""} ${t?.message??""}`.toLowerCase();return t?.status===412||t?.code==="PRECONDITION_FAILED"||r.includes("precondition")||r.includes("already exists")||r.includes("if-none-match")}function ws(){let e=null,t=null,r=()=>e?Promise.resolve(e):t||(t=(async()=>{let n=(0,br.getStore)(qn);try{return await n.get("__probe__",{consistency:"strong"}),e=n,n}catch(o){if(!Bn(o))throw o;let a=gs();if(!a)throw wr(o);let s=(0,br.getStore)({name:qn,...a});try{await s.get("__probe__",{consistency:"strong"})}catch(i){throw wr(i)}return e=s,s}})(),t);return{kind:"edgeone",async getText(n){return await(await r()).get(n,{consistency:"strong"})??null},async getJson(n){try{return await(await r()).get(n,{type:"json",consistency:"strong"})}catch(o){if(Bn(o))throw wr(o);return null}},async put(n,o,a){let s=await r();try{return await s.set(n,o,a?.onlyIfNew?{onlyIfNew:!0}:void 0),!0}catch(i){if(a?.onlyIfNew&&ys(i))return!1;throw i}},async del(n){await(await r()).delete(n)},async keys(n){return(await(await r()).list({prefix:n,consistency:"strong"})).blobs.map(a=>a.key)}}}function Dn(){let e=new Map;return{kind:"memory",async getText(t){return e.get(t)??null},async getJson(t){let r=e.get(t);if(r===void 0)return null;try{return JSON.parse(r)}catch{return null}},async put(t,r,n){return n?.onlyIfNew&&e.has(t)?!1:(e.set(t,r),!0)},async del(t){e.delete(t)},async keys(t){return[...e.keys()].filter(r=>r.startsWith(t)).sort()}}}function Un(){if(be)return be;let e=(process.env.EPAY_STORE??"edgeone").toLowerCase();if(e==="memory")return be=Dn(),be;try{return be=ws(),be}catch(t){if(e!=="auto")throw t;return console.warn("[blob] EdgeOne Blob \u4E0D\u53EF\u7528\uFF0C\u964D\u7EA7\u4E3A\u5185\u5B58\u5B58\u50A8\uFF08\u91CD\u542F\u5373\u4E22\uFF09\uFF1A",String(t).slice(0,160)),be=Dn(),be}}var br,qn,xr,hs,be,Ln=ne(()=>{br=Hr(Mn(),1),qn="epay",xr=class extends Error{code="STORE_CONFIG_MISSING";hint;constructor(t,r){super(t),this.name="StoreConfigError",this.hint=r}};hs="EdgeOne Blob \u672A\u5C31\u7EEA\u3002\u6392\u67E5\u987A\u5E8F\uFF1A\u2460 \u63A7\u5236\u53F0\u786E\u8BA4\u8BE5\u9879\u76EE\u5DF2\u542F\u7528 Blob/\u5B58\u50A8\uFF1B\u2461 \u51FD\u6570\u662F\u5426\u88AB\u8BC6\u522B\u4E3A Node \u4E91\u51FD\u6570\uFF08cloud-functions/ \u76EE\u5F55\u3001\u6784\u5EFA\u4EA7\u7269\u91CC\u6709 [[default]].js\uFF09\uFF1B\u2462 \u5B9E\u5728\u4E0D\u884C\uFF0C\u5728\u9879\u76EE\u73AF\u5883\u53D8\u91CF\u91CC\u914D EPAY_BLOB_PROJECT_ID\uFF08makers-xxxx\uFF09\u4E0E EPAY_BLOB_TOKEN\uFF08API Token\uFF09\u8D70\u663E\u5F0F\u51ED\u636E\u3002";be=null});function _(){return Un()}async function T(e){return await _().getJson(e)}async function Y(e,t){await _().put(e,JSON.stringify(t))}function _e(e){let t=new Date((e+28800)*1e3),r=n=>String(n).padStart(2,"0");return`${t.getUTCFullYear()}-${r(t.getUTCMonth()+1)}-${r(t.getUTCDate())}`}async function se(e,t,r=15e3){let n=`lk/${e}`,o=`${Date.now()}-${Math.random().toString(36).slice(2)}`,a=Date.now()+1e4;for(;!await _().put(n,o,{onlyIfNew:!0});){let s=await _().getText(n),i=Number((s??"").split("-")[0]);if(s&&Number.isFinite(i)&&Date.now()-i>r){await _().del(n);continue}if(Date.now()>a)throw new Error(`lock timeout: ${e}`);await bs(20+Math.floor(Math.random()*40))}try{return await t()}finally{await _().getText(n)===o&&await _().del(n)}}async function Be(e,t,r){let n=0;for(let o=0;o<8;o++){let a=Number(await _().getText(t)||"0"),s=Math.max(a,n)+1;if(n=s,await r(s))return await _().put(t,String(s)),s}throw new Error(`allocId failed: ${e}`)}async function _t(){if(Me&&Date.now()-Me.at<xs)return Me.map;let e=await T("cfg")??{};return Me={at:Date.now(),map:e},e}async function ie(e){let t=await _t();return Object.prototype.hasOwnProperty.call(t,e)?t[e]:null}async function Se(e,t){await se("cfg",async()=>{let r=await T("cfg")??{};r[e]=t,await Y("cfg",r),Me={at:Date.now(),map:r}})}async function St(e){await se("cfg",async()=>{let t=await T("cfg")??{};Object.assign(t,e),await Y("cfg",t),Me={at:Date.now(),map:t}})}async function Gn(){let e=await _t();return await _().keys("u/"),{store:_().kind,initialized:!!e.admin_user}}async function ue(e){return e?await T(`u/${e}`):null}async function De(e){let t=Number(await _().getText(`un/${encodeURIComponent(e)}`)||"0");return t?await ue(t):null}async function Jn(e,t){let r=await De(e);if(r)return{uid:r.uid};let n=t?await ue(t):null;return n?{uid:n.uid}:null}async function Ct(e){let t=`un/${encodeURIComponent(e.username)}`;if(await _().getText(t))throw new Error("USERNAME_EXISTS");let r=await Be("user","uctr",async o=>await _().put(`u/${o}`,"{}",{onlyIfNew:!0})),n={uid:r,gid:1,username:e.username,email:e.email??"",password:e.password,key:e.key,money:0,mode:1,status:1,regtime:v(),keytype:0,publickey:"",domain:"",invite_uid:e.invite_uid??0,cert:0,cert_name:"",cert_no:""};return await Y(`u/${r}`,n),await _().put(t,String(r)),qe=null,r}async function Ce(e,t){await se(`u/${e}`,async()=>{let r=await T(`u/${e}`);r&&await Y(`u/${e}`,{...r,...t,uid:e})})}async function xe(e,t){return await se(`u/${e}`,async()=>{let r=await T(`u/${e}`);if(!r)return!1;let n=(r.money||0)+t;return n<0?!1:(r.money=n,await Y(`u/${e}`,r),!0)})}async function Pt(){if(qe&&Date.now()-qe.at<Cs)return qe.ids;let t=(await _().keys("u/")).map(r=>Number(r.slice(2))).filter(r=>Number.isFinite(r)&&r>0).sort((r,n)=>r-n);return qe={at:Date.now(),ids:t},t}async function Rt(e){return(await Promise.all(e.map(r=>T(`u/${r}`)))).filter(r=>!!r)}async function Pe(){return(await Pt()).length}async function Fn(e,t){let r=(await Pt()).slice(e,e+t);return await Rt(r)}async function Yn(e){return(await Rt(await Pt())).filter(r=>(r.cert||0)===e).sort((r,n)=>r.uid-n.uid)}async function Qn(e){return(await Rt(await Pt())).filter(r=>r.gid===e).map(r=>r.uid)}async function Ps(e){let t=[...new Set(e)],r=await Rt(t);return new Map(r.map(n=>[n.uid,n]))}async function Wn(e){let t=await T(`u/${e}`);t&&(await _().del(`un/${encodeURIComponent(t.username)}`),await _().del(`u/${e}`),qe=null)}async function Tt(){let e=await _().keys("ch/");return(await Promise.all(e.map(r=>T(r)))).filter(r=>!!r).sort((r,n)=>r.id-n.id)}async function Re(e){return e?await T(`ch/${e}`):null}async function Vn(e,t=!1){return(await Promise.all(e.map(n=>Re(n)))).filter(n=>!!n&&(!t||n.status===1))}async function ee(e,t=!1){return(await Tt()).filter(r=>r.plugin===e&&(!t||r.status===1))}async function Xn(e,t=!1){return(await Tt()).filter(r=>e.includes(r.plugin)&&(!t||r.status===1))}async function Zn(e){let t={plugin:e.plugin,name:e.name,status:e.status===0?0:1,config:e.config,types:e.types,weight:Math.max(1,e.weight||1)};if(e.id)return await Y(`ch/${e.id}`,{id:e.id,...t}),e.id;let r=0;return await Be("channel","chctr",async n=>(r=n,await _().put(`ch/${n}`,JSON.stringify({id:n,...t}),{onlyIfNew:!0}))),r}async function eo(e){await _().del(`ch/${e}`)}async function to(){await T("g/1")||await Y("g/1",{id:1,name:"\u9ED8\u8BA4\u5206\u7EC4",rate:0})}async function ro(){let e=await _().keys("g/");return(await Promise.all(e.map(r=>T(r)))).filter(r=>!!r).sort((r,n)=>r.id-n.id)}async function Et(e){return await T(`g/${e}`)}async function no(e){if(e.id)return await Y(`g/${e.id}`,{id:e.id,name:e.name,rate:e.rate}),e.id;let t=0;return await Be("group","gctr",async r=>(t=r,await _().put(`g/${r}`,JSON.stringify({id:r,name:e.name,rate:e.rate}),{onlyIfNew:!0}))),t}async function oo(e){await _().del(`g/${e}`)}async function Ue(){if(Date.now()-je.at<Ss&&je.keys.length)return je.keys;let e=(await _().keys("oidx/")).sort().reverse();return je.at=Date.now(),je.keys=e,e}async function Le(e){let t=vr.get(e);if(t&&Date.now()-t.at<vs)return t.rows;let r=await T(`oidx/${e}`)??[];return vr.set(e,{at:Date.now(),rows:r}),r}async function ao(e,t){await Y(`oidx/${e}`,t),vr.set(e,{at:Date.now(),rows:t})}function so(e){let{ext:t,...r}=e;return r}function Rs(e){try{let t=JSON.parse(e||"{}"),r={};return t.pay_amount&&(r.pay_amount=String(t.pay_amount)),typeof t.pay_sun=="number"&&(r.pay_sun=t.pay_sun),r}catch{return{}}}async function _r(){if(Date.now()-Ie.at<_s&&Ie.keys.length)return Ie.keys;let e=(await _().keys("mstat/")).map(t=>t.slice(6)).sort();return Ie.at=Date.now(),Ie.keys=e,e}function io(){return{n:0,sum:0,st:[0,0,0,0],days:{},users:{}}}async function At(e){let t=kr.get(e);if(t&&Date.now()-t.at<ks)return t.stat;let r=await T(`mstat/${e}`)??io();return kr.set(e,{at:Date.now(),stat:r}),r}async function co(e,t){await se(`ms/${e}`,async()=>{let r=await T(`mstat/${e}`)??io();if(t.created){let n=t.created,o=_e(n.addtime||v()).slice(8,10);r.n+=1,r.st[0]+=1,r.days[o]=r.days[o]||{n:0,sum:0},r.days[o].n+=1,r.users[String(n.uid)]=(r.users[String(n.uid)]||0)+1}if(t.to){let n=t.to,o=Math.min(3,Math.max(0,t.from??0)),a=Math.min(3,Math.max(0,n.status));if(o!==a&&(r.st[o]=Math.max(0,(r.st[o]||0)-1),r.st[a]=(r.st[a]||0)+1,o<1&&a>=1)){let s=_e(n.addtime||v()).slice(8,10);r.sum+=n.money,r.days[s]=r.days[s]||{n:0,sum:0},r.days[s].sum+=n.money}}await Y(`mstat/${e}`,r),kr.set(e,{at:Date.now(),stat:r}),Ie.at=0,rt=null})}async function lo(e){return await _().put(`paid/${e}`,String(v()),{onlyIfNew:!0})}async function Sr(e){await _().del(`paid/${e}`)}async function Cr(e){let r={id:await Be("order","octr",async s=>await _().put(`oi/${s}`,e.trade_no,{onlyIfNew:!0})),trade_no:e.trade_no,out_trade_no:e.out_trade_no,uid:e.uid,type:e.type,channel:e.channel,name:e.name,money:e.money,realmoney:0,status:0,addtime:e.addtime,endtime:null,notify_url:e.notify_url,return_url:e.return_url,domain:e.domain,ip:e.ip,api_trade_no:"",notify_count:0,notify_status:0,ext:"{}"},n=!1;for(let s=0;s<3&&!n;s++)n=await _().put(`o/${r.trade_no}`,JSON.stringify(r),{onlyIfNew:!0}),n||(r.trade_no=`${r.trade_no.slice(0,14)}${Math.floor(Math.random()*9e5)+1e5}`);if(!n)throw new Error("trade_no \u51B2\u7A81");let o=so(r),a=Hn(r.addtime||v());return await se(`d/${a}`,async()=>{let s=await T(`oidx/${a}`)??[];s.push(o),await ao(a,s),je.at=0}),await po(s=>[...s.filter(i=>i.id!==r.id),o]),await co(Kn(r.addtime||v()),{created:o}),r}async function M(e){return e?await T(`o/${e}`):null}async function uo(e){if(!e)return null;let t=await _().getText(`oapi/${encodeURIComponent(e)}`);return t?await M(t):null}async function Ts(){return(await T("pend")??[]).sort((t,r)=>(t.id||0)-(r.id||0))}async function po(e){await se("pend",async()=>{let t=await T("pend")??[],r=e(t);await Y("pend",r)})}async function V(e={}){let t=await Ts();if(e.type&&(t=t.filter(r=>r.type===e.type)),e.channelIds){let r=new Set(e.channelIds);t=t.filter(n=>n.channel!==null&&r.has(n.channel))}return e.from!==void 0&&(t=t.filter(r=>(r.addtime||0)>=e.from)),e.to!==void 0&&(t=t.filter(r=>(r.addtime||0)<=e.to)),e.order==="desc"&&t.reverse(),e.limit!==void 0&&(t=t.slice(0,e.limit)),t}async function Es(e,t,r){return await se(`o/${e}`,async()=>{let n=await T(`o/${e}`);if(!n)return{ok:!1,before:null,after:null};if(r&&!r(n))return{ok:!1,before:n,after:null};let o={...n,...t,id:n.id,trade_no:n.trade_no};return await Y(`o/${e}`,o),{ok:!0,before:n,after:o}})}async function fo(e,t){let r=so({...t,...Rs(t.ext)}),n=Hn(t.addtime||v());await se(`d/${n}`,async()=>{let o=await T(`oidx/${n}`)??[],a=o.findIndex(s=>s.id===t.id);a>=0?o[a]=r:o.push(r),await ao(n,o)}),await po(o=>{let a=o.filter(s=>s.id!==t.id);return t.status===0?[...a,r]:a}),t.api_trade_no&&await _().put(`oapi/${encodeURIComponent(t.api_trade_no)}`,t.trade_no),e?.status!==t.status&&await co(Kn(t.addtime||v()),{from:e?.status??t.status,to:{status:t.status,money:t.money,addtime:t.addtime}})}async function ze(e,t,r){let n=await Es(e,t,r);return!n.ok||!n.after?!1:(await fo(n.before,n.after),!0)}async function nt(e,t){await ze(e,{ext:t})}async function Pr(e,t){let r=await se(`o/${e}`,async()=>{let n=await T(`o/${e}`);if(!n)return null;let o={...n,notify_status:t.notify_status??n.notify_status,notify_count:(n.notify_count||0)+(t.notify_count_delta||0)};return await Y(`o/${e}`,o),{before:n,after:o}});r&&await fo(r.before,r.after)}async function mo(e){let{page:t,size:r}=e,n=(t-1)*r,o=(e.q||"").trim(),a=parseInt(o,10)||0,s=u=>e.status!==void 0&&e.status!==null&&u.status!==e.status?!1:o?(u.trade_no||"").includes(o)||(u.out_trade_no||"").includes(o)||a>0&&u.uid===a:!0,i=[],c=0,d=!!o;for(let u of await Ue()){let g=(await Le(u.replace("oidx/",""))).filter(s).sort((k,C)=>(C.id||0)-(k.id||0));for(let k of g)c++,c>n&&i.length<r&&i.push(k);if(!d&&i.length>=r)break}let l;if(o)l=c;else if(e.status!==void 0&&e.status!==null){l=0;for(let u of await _r())l+=(await At(u)).st[e.status]||0}else l=(await Te()).orders;return{list:i,total:l}}async function go(e,t,r=20){let n=(t-1)*r,o=[];if(n<0)return{list:[],total:await zn(e)};let a=0;for(let s of await Ue()){let c=(await Le(s.replace("oidx/",""))).filter(d=>d.uid===e).sort((d,l)=>(l.id||0)-(d.id||0));for(let d of c)a++,a>n&&o.length<r&&o.push(d);if(o.length>=r)break}return{list:o,total:await zn(e)}}async function zn(e){let t=0;for(let r of await _r())t+=(await At(r)).users[String(e)]||0;return t}async function ho(e){let t=[];for(let r of await Ue()){let o=(await Le(r.replace("oidx/",""))).filter(a=>a.status>=1&&a.notify_status===0&&!!a.notify_url&&(a.notify_count||0)<5).sort((a,s)=>(s.id||0)-(a.id||0));for(let a of o)if(t.push(a),t.length>=e)return t}return t}async function yo(e,t=5e3){let r=[],n=(await Ue()).reverse();for(let o of n){let a=await Le(o.replace("oidx/",""));for(let s of a)(s.addtime||0)<e||r.push(s)}return r.sort((o,a)=>(a.id||0)-(o.id||0)).slice(0,t)}async function wo(e=0){let t=[];for(let r of await Ue()){let n=await Le(r.replace("oidx/",""));for(let o of n)o.status>=1&&(o.addtime||0)>=e&&t.push(o)}return t}async function Te(){if(rt&&Date.now()-rt.at<5e3)return rt.value;let e={orders:0,pending:0,paidSum:0,paidCount:0};for(let t of await _r()){let r=await At(t);e.orders+=r.n,e.pending+=r.st[0]||0,e.paidSum+=r.sum,e.paidCount+=(r.st[1]||0)+(r.st[3]||0)}return rt={at:Date.now(),value:e},e}function bo(e=v()){let t=new Date((e+28800)*1e3);return t.setUTCHours(0,0,0,0),Math.floor(t.getTime()/1e3)-8*3600}async function Rr(e){return(await At(e.slice(0,7))).days[e.slice(8,10)]||{n:0,sum:0}}async function xo(e){let t=[],r=v();for(let n=e-1;n>=0;n--){let o=_e(r-n*86400),a=await Rr(o);t.push({d:o,n:a.n,s:a.sum})}return t}async function Ot(e){let t=0,r=0;for(let n of await Ue()){let o=n.slice(5);if(Date.UTC(Number(o.slice(0,4)),Number(o.slice(4,6))-1,Number(o.slice(6,8)))/1e3-8*3600+86400<=e)break;let s=await Le(o);for(let i of s)(i.addtime||0)<e||(t++,i.status>=1&&(r+=i.money))}return{n:t,sum:r}}async function ve(e,t,r,n){let o=v(),a=0;return await Be("record","rctr",async s=>{a=s;let i={id:s,uid:e,type:t,money:r,addtime:o,note:n};return await _().put(`rc/${e}/${kt(s)}`,JSON.stringify(i),{onlyIfNew:!0})}),a}async function vo(e,t=50){let r=(await _().keys(`rc/${e}/`)).sort().reverse().slice(0,t);return(await Promise.all(r.map(o=>T(o)))).filter(o=>!!o)}async function ko(e,t){let r=v(),n=0;return await Be("settle","stctr",async o=>{n=o;let a={id:o,uid:e,amount:t,addtime:r,status:0,note:""};return await _().put(`st/${kt(o)}`,JSON.stringify(a),{onlyIfNew:!0})}),n}async function ot(e){return await T(`st/${kt(e)}`)}async function $t(e,t){let r=await ot(e);r&&await Y(`st/${kt(e)}`,{...r,...t,id:e})}async function _o(e=100){let t=(await _().keys("st/")).sort().reverse().slice(0,e),r=(await Promise.all(t.map(o=>T(o)))).filter(o=>!!o),n=await Ps(r.map(o=>o.uid));return r.map(o=>({...o,username:n.get(o.uid)?.username||""}))}async function So(){let e=await _().keys("st/");return(await Promise.all(e.map(r=>T(r)))).filter(r=>r&&r.status===0).length}async function Nt(e){return await T(`rg/${encodeURIComponent(e)}`)}async function It(e,t,r){await Y(`rg/${encodeURIComponent(e)}`,{v:t,time:r})}async function jt(e){await _().del(`rg/${encodeURIComponent(e)}`)}async function Co(e){let t=await _().keys("rg/"),r=await Promise.all(t.map(async n=>[n,await T(n)]));for(let[n,o]of r)(!o||(o.time||0)<e)&&await _().del(n)}var kt,bs,Hn,Kn,rt,Me,xs,vr,vs,kr,ks,Ie,_s,je,Ss,qe,Cs,K=ne(()=>{Ln();N();kt=(e,t=12)=>String(e).padStart(t,"0"),bs=e=>new Promise(t=>setTimeout(t,e));Hn=e=>_e(e).replace(/-/g,""),Kn=e=>_e(e).slice(0,7);rt=null,Me=null,xs=3e3,vr=new Map,vs=3e3,kr=new Map,ks=5e3,Ie={at:0,keys:[]},_s=1e4,je={at:0,keys:[]},Ss=5e3;qe=null,Cs=5e3});var Po={};Qt(Po,{getConfig:()=>q,getConfigAll:()=>J,getUserByUid:()=>te,markOrderPaid:()=>Q,markOrderRefunded:()=>Tr,setConfig:()=>Ee});async function Q(e,t,r,n){let o=await M(t);if(!o||o.status!==0||!await lo(t))return!1;if(!await ze(t,{status:1,realmoney:r,endtime:v(),api_trade_no:n},g=>g.status===0))return await Sr(t),!1;let s=await ue(o.uid),c=(s?await Et(s.gid):null)?.rate||0,d=Math.round(o.money*c/100),l=o.money-d;if(!await xe(o.uid,l))return await ze(t,{status:0,realmoney:0},g=>g.status===1),await Sr(t),!1;await ve(o.uid,1,l,`\u8BA2\u5355 ${t} \u6536\u6B3E`+(d>0?`\uFF08\u624B\u7EED\u8D39 ${(d/100).toFixed(2)}\uFF09`:""));let b=parseFloat(await ie("invite_rate")||"0");if(b>0){let g=s?.invite_uid||0;if(g){let k=Math.round(o.money*b/100);k>0&&(await xe(g,k),await ve(g,4,k,`\u9080\u8BF7\u5546\u6237 ${o.uid} \u8BA2\u5355 ${t} \u8FD4\u5229`))}}return!0}async function Tr(e,t){let r=await M(t);if(!r)return{ok:!1,msg:"\u8BA2\u5355\u4E0D\u5B58\u5728"};if(r.status!==1&&r.status!==3)return{ok:!1,msg:"\u8BA2\u5355\u72B6\u6001\u4E0D\u652F\u6301\u9000\u6B3E"};let n=r.status;return await ze(t,{status:2},s=>s.status===1||s.status===3)?await xe(r.uid,-r.money)?(await ve(r.uid,2,r.money,`\u8BA2\u5355 ${t} \u9000\u6B3E`),{ok:!0,msg:"ok"}):(await ze(t,{status:n},s=>s.status===2),{ok:!1,msg:"\u5546\u6237\u4F59\u989D\u4E0D\u8DB3, \u65E0\u6CD5\u9000\u6B3E"}):{ok:!1,msg:"\u8BA2\u5355\u72B6\u6001\u5DF2\u53D8\u66F4"}}var J,q,Ee,te,ce=ne(()=>{N();K();J=()=>_t(),q=e=>ie(e),Ee=(e,t)=>Se(e,t),te=e=>ue(e)});var To=zr((Ro,Mt)=>{(function(e){"use strict";function t(p,x){var f=(p&65535)+(x&65535),S=(p>>16)+(x>>16)+(f>>16);return S<<16|f&65535}function r(p,x){return p<<x|p>>>32-x}function n(p,x,f,S,A,j){return t(r(t(t(x,p),t(S,j)),A),f)}function o(p,x,f,S,A,j,z){return n(x&f|~x&S,p,x,A,j,z)}function a(p,x,f,S,A,j,z){return n(x&S|f&~S,p,x,A,j,z)}function s(p,x,f,S,A,j,z){return n(x^f^S,p,x,A,j,z)}function i(p,x,f,S,A,j,z){return n(f^(x|~S),p,x,A,j,z)}function c(p,x){p[x>>5]|=128<<x%32,p[(x+64>>>9<<4)+14]=x;var f,S,A,j,z,m=1732584193,h=-271733879,y=-1732584194,w=271733878;for(f=0;f<p.length;f+=16)S=m,A=h,j=y,z=w,m=o(m,h,y,w,p[f],7,-680876936),w=o(w,m,h,y,p[f+1],12,-389564586),y=o(y,w,m,h,p[f+2],17,606105819),h=o(h,y,w,m,p[f+3],22,-1044525330),m=o(m,h,y,w,p[f+4],7,-176418897),w=o(w,m,h,y,p[f+5],12,1200080426),y=o(y,w,m,h,p[f+6],17,-1473231341),h=o(h,y,w,m,p[f+7],22,-45705983),m=o(m,h,y,w,p[f+8],7,1770035416),w=o(w,m,h,y,p[f+9],12,-1958414417),y=o(y,w,m,h,p[f+10],17,-42063),h=o(h,y,w,m,p[f+11],22,-1990404162),m=o(m,h,y,w,p[f+12],7,1804603682),w=o(w,m,h,y,p[f+13],12,-40341101),y=o(y,w,m,h,p[f+14],17,-1502002290),h=o(h,y,w,m,p[f+15],22,1236535329),m=a(m,h,y,w,p[f+1],5,-165796510),w=a(w,m,h,y,p[f+6],9,-1069501632),y=a(y,w,m,h,p[f+11],14,643717713),h=a(h,y,w,m,p[f],20,-373897302),m=a(m,h,y,w,p[f+5],5,-701558691),w=a(w,m,h,y,p[f+10],9,38016083),y=a(y,w,m,h,p[f+15],14,-660478335),h=a(h,y,w,m,p[f+4],20,-405537848),m=a(m,h,y,w,p[f+9],5,568446438),w=a(w,m,h,y,p[f+14],9,-1019803690),y=a(y,w,m,h,p[f+3],14,-187363961),h=a(h,y,w,m,p[f+8],20,1163531501),m=a(m,h,y,w,p[f+13],5,-1444681467),w=a(w,m,h,y,p[f+2],9,-51403784),y=a(y,w,m,h,p[f+7],14,1735328473),h=a(h,y,w,m,p[f+12],20,-1926607734),m=s(m,h,y,w,p[f+5],4,-378558),w=s(w,m,h,y,p[f+8],11,-2022574463),y=s(y,w,m,h,p[f+11],16,1839030562),h=s(h,y,w,m,p[f+14],23,-35309556),m=s(m,h,y,w,p[f+1],4,-1530992060),w=s(w,m,h,y,p[f+4],11,1272893353),y=s(y,w,m,h,p[f+7],16,-155497632),h=s(h,y,w,m,p[f+10],23,-1094730640),m=s(m,h,y,w,p[f+13],4,681279174),w=s(w,m,h,y,p[f],11,-358537222),y=s(y,w,m,h,p[f+3],16,-722521979),h=s(h,y,w,m,p[f+6],23,76029189),m=s(m,h,y,w,p[f+9],4,-640364487),w=s(w,m,h,y,p[f+12],11,-421815835),y=s(y,w,m,h,p[f+15],16,530742520),h=s(h,y,w,m,p[f+2],23,-995338651),m=i(m,h,y,w,p[f],6,-198630844),w=i(w,m,h,y,p[f+7],10,1126891415),y=i(y,w,m,h,p[f+14],15,-1416354905),h=i(h,y,w,m,p[f+5],21,-57434055),m=i(m,h,y,w,p[f+12],6,1700485571),w=i(w,m,h,y,p[f+3],10,-1894986606),y=i(y,w,m,h,p[f+10],15,-1051523),h=i(h,y,w,m,p[f+1],21,-2054922799),m=i(m,h,y,w,p[f+8],6,1873313359),w=i(w,m,h,y,p[f+15],10,-30611744),y=i(y,w,m,h,p[f+6],15,-1560198380),h=i(h,y,w,m,p[f+13],21,1309151649),m=i(m,h,y,w,p[f+4],6,-145523070),w=i(w,m,h,y,p[f+11],10,-1120210379),y=i(y,w,m,h,p[f+2],15,718787259),h=i(h,y,w,m,p[f+9],21,-343485551),m=t(m,S),h=t(h,A),y=t(y,j),w=t(w,z);return[m,h,y,w]}function d(p){var x,f="",S=p.length*32;for(x=0;x<S;x+=8)f+=String.fromCharCode(p[x>>5]>>>x%32&255);return f}function l(p){var x,f=[];for(f[(p.length>>2)-1]=void 0,x=0;x<f.length;x+=1)f[x]=0;var S=p.length*8;for(x=0;x<S;x+=8)f[x>>5]|=(p.charCodeAt(x/8)&255)<<x%32;return f}function u(p){return d(c(l(p),p.length*8))}function b(p,x){var f,S=l(p),A=[],j=[],z;for(A[15]=j[15]=void 0,S.length>16&&(S=c(S,p.length*8)),f=0;f<16;f+=1)A[f]=S[f]^909522486,j[f]=S[f]^1549556828;return z=c(A.concat(l(x)),512+x.length*8),d(c(j.concat(z),640))}function g(p){var x="0123456789abcdef",f="",S,A;for(A=0;A<p.length;A+=1)S=p.charCodeAt(A),f+=x.charAt(S>>>4&15)+x.charAt(S&15);return f}function k(p){return unescape(encodeURIComponent(p))}function C(p){return u(k(p))}function P(p){return g(C(p))}function R(p,x){return b(k(p),k(x))}function F(p,x){return g(R(p,x))}function E(p,x,f){return x?f?R(x,p):F(x,p):f?C(p):P(p)}typeof define=="function"&&define.amd?define(function(){return E}):typeof Mt=="object"&&Mt.exports?Mt.exports=E:e.md5=E})(Ro)});function Ae(e){return Object.keys(e).filter(t=>t!=="sign"&&t!=="sign_type"&&e[t]!==void 0&&e[t]!=="").sort().map(t=>`${t}=${e[t]}`).join("&")}function qt(e,t){return(0,D.default)(Ae(e)+t)}function Eo(e,t,r){return r?qt(e,t)===r:!1}var D,pe=ne(()=>{D=Hr(To(),1)});function Os(e){let t=e.replace(/-----BEGIN [A-Z ]+-----/g,"").replace(/-----END [A-Z ]+-----/g,"").replace(/\s+/g,""),r=atob(t),n=new Uint8Array(r.length);for(let o=0;o<r.length;o++)n[o]=r.charCodeAt(o);return n.buffer}function $o(e,t){let r=new Uint8Array(e),n=btoa(String.fromCharCode(...r));return n=n.replace(/(.{64})/g,`$1
`),`-----BEGIN ${t}-----
${n}
-----END ${t}-----`}async function No(e,t){return await crypto.subtle.importKey(t?"pkcs8":"spki",Os(e),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},!1,[t?"sign":"verify"])}async function Dt(e,t){let r=await No(e,!0),n=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",r,new TextEncoder().encode(t));return btoa(String.fromCharCode(...new Uint8Array(n)))}async function st(e,t,r){try{let n=await No(e,!1),o=Uint8Array.from(atob(r),a=>a.charCodeAt(0));return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",n,o,new TextEncoder().encode(t))}catch{return!1}}async function Io(){let e=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},!0,["sign","verify"]),t=await crypto.subtle.exportKey("spki",e.publicKey),r=await crypto.subtle.exportKey("pkcs8",e.privateKey);return{publicPem:$o(t,"PUBLIC KEY"),privatePem:$o(r,"PRIVATE KEY")}}var Ut=ne(()=>{});async function jo(e,t,r){let n=Ae(r);if(t.keytype===1&&t.publickey){let o=await q("rsa_private")||"";if(!o)throw new Error("\u5E73\u53F0RSA\u79C1\u94A5\u672A\u914D\u7F6E");return await Dt(o,n)}return(0,D.default)(n+t.key)}async function Mo(e,t,r){if(!r)return!1;let n=Ae(t);return e.keytype===1&&e.publickey?await st(e.publickey,n,r):(0,D.default)(n+e.key)===r}async function $s(e,t){if(!t.notify_url)return!0;let r=await te(t.uid);if(!r)return!1;let n={pid:String(t.uid),trade_no:t.trade_no,out_trade_no:t.out_trade_no||"",type:t.type,name:t.name||"",money:$(t.money),trade_status:"TRADE_SUCCESS"},o=await jo(e,r,n),a=r.keytype===1&&r.publickey?"RSA":"MD5",s=new URLSearchParams({...n,sign:o,sign_type:a}).toString(),i=t.notify_url.includes("?")?"&":"?";try{if((await(await fetch(t.notify_url+i+s,{signal:AbortSignal.timeout(8e3)})).text()).trim()==="success")return await Pr(t.trade_no,{notify_status:1}),!0}catch{}return await Pr(t.trade_no,{notify_count_delta:1}),!1}async function W(e,t){try{await $s(e,t)}catch{}}async function Ar(e,t){if(!t.return_url)return"";let r=await te(t.uid);if(!r)return"";let n={pid:String(t.uid),trade_no:t.trade_no,out_trade_no:t.out_trade_no||"",type:t.type,name:t.name||"",money:$(t.money),trade_status:t.status===1||t.status===3?"TRADE_SUCCESS":"TRADE_CLOSED"},o=await jo(e,r,n),a=new URLSearchParams({...n,sign:o,sign_type:"MD5"}).toString(),s=t.return_url.includes("?")?"&":"?";return t.return_url+s+a}var fe=ne(()=>{ce();K();pe();N();Ut()});async function Lt(e,t,r,n){let o={app_id:e.appid,method:t,format:"JSON",charset:"utf-8",sign_type:"RSA2",timestamp:Ns(),version:"1.0",biz_content:JSON.stringify(r)};n&&(o.notify_url=n);let a=await Dt(e.private_key,Ae(o)),s=new URLSearchParams({...o,sign:a}).toString(),c=await(await fetch(e.gateway||"https://openapi.alipay.com/gateway.do",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:s})).json().catch(()=>({})),d=Object.keys(c).find(C=>C===t.replace(/\./g,"_")+"_response")||"",l=d?c[d]:{},u=String(l.code||""),b=String(l.sub_msg||l.msg||"\u652F\u4ED8\u5B9D\u8BF7\u6C42\u5931\u8D25");if(u!=="10000")return{code:u,msg:b};let g=String(c.sign||""),k=JSON.stringify(l);return g&&!await st(e.alipay_public_key,k,g)?{code:"-1",msg:"\u652F\u4ED8\u5B9D\u54CD\u5E94\u9A8C\u7B7E\u5931\u8D25"}:{code:"10000",msg:"ok",data:l}}function Ns(){let e=new Date(Date.now()+288e5),t=(r,n=2)=>String(r).padStart(n,"0");return`${e.getUTCFullYear()}-${t(e.getUTCMonth()+1)}-${t(e.getUTCDate())} ${t(e.getUTCHours())}:${t(e.getUTCMinutes())}:${t(e.getUTCSeconds())}`}function Ir(e){return JSON.parse(e||"{}")}async function Do(e,t,r,n,o,a){let s=Ir(e),i=await Lt(s,"alipay.fund.trans.uni.transfer",{out_biz_no:t,trans_amount:r,product_code:"TRANS_ACCOUNT_NO_PWD",biz_scene:"DIRECT_TRANSFER",remark:a||"\u7ED3\u7B97\u6253\u6B3E",payee_info:{identity:n,identity_type:"ALIPAY_LOGON_ID",name:o||void 0}});return i.code!=="10000"?{ok:!1,msg:i.msg}:{ok:!0,msg:"ok",orderNo:String(i.data?.order_id||"")}}var Bo,zt=ne(()=>{pe();N();Ut();Bo={id:"alipayf2f",name:"\u652F\u4ED8\u5B9D\u5F53\u9762\u4ED8(\u5B98\u65B9)",types:["alipay"],inputs:[{name:"appid",label:"\u652F\u4ED8\u5B9D\u5E94\u7528APPID",required:!0},{name:"private_key",label:"\u5E94\u7528\u79C1\u94A5(PKCS8 PEM)",required:!0,multiline:!0},{name:"alipay_public_key",label:"\u652F\u4ED8\u5B9D\u516C\u94A5(PEM)",required:!0,multiline:!0},{name:"gateway",label:"\u7F51\u5173(\u7559\u7A7A\u7528\u5B98\u65B9, \u6D4B\u8BD5\u53EF\u8986\u76D6)"},{name:"enable_transfer",label:"\u542F\u7528\u81EA\u52A8\u6253\u6B3E(1\u5F00)"},{name:"paymin",label:"\u5355\u7B14\u6700\u4F4E(\u5143)"},{name:"paymax",label:"\u5355\u7B14\u6700\u9AD8(\u5143)"}],async createOrder(e){let t=Ir(JSON.stringify(e.channel.config)),r=await Lt(t,"alipay.trade.pre.create",{out_trade_no:e.order.trade_no,total_amount:$(e.order.money),subject:e.order.name||"\u8BA2\u5355"},`${e.siteUrl}/channel/notify/alipayf2f/${e.channel.id}`);if(r.code!=="10000")return{ok:!1,msg:r.msg};let n=String(r.data?.qr_code||"");return n?{ok:!0,qrContent:n}:{ok:!1,msg:"\u652F\u4ED8\u5B9D\u672A\u8FD4\u56DE\u4E8C\u7EF4\u7801"}},async onNotify(e){let t=Ir(JSON.stringify(e.channel.config)),r={};try{(await e.req.formData()).forEach((s,i)=>r[i]=String(s))}catch{e.url.searchParams.forEach((a,s)=>r[s]=a)}let n=r.sign,o=Ae(r);return await st(t.alipay_public_key,o,n)?r.trade_status!=="TRADE_SUCCESS"&&r.trade_status!=="TRADE_FINISHED"?{ok:!1,respond:"ignore"}:{ok:!0,respond:"success",tradeNo:r.out_trade_no,money:Math.round(Number(r.total_amount||0)*100),apiTradeNo:r.trade_no||""}:{ok:!1,respond:"sign error"}}}});var jr={};Qt(jr,{billTime:()=>Ht,ensurePayAmount:()=>Oe,parseAccountLog:()=>Lo,parseBillConfig:()=>Uo,parseBills:()=>zo,pollAllBills:()=>Ms,pollBillChannel:()=>Ho});function Uo(e){return JSON.parse(e||"{}")}function Lo(e){let t=[],r=new Set,n=o=>{if(Array.isArray(o)){o.forEach(n);return}if(o&&typeof o=="object"){let a=o,s=String(a.trans_dt||a.trans_date||a.trade_date||""),i=Number(a.trans_amount??a.amount??0);if(s&&i>0){let c=Ht(s)||Math.floor(Date.parse(s.replace(" ","T")+"+08:00")/1e3)||Math.floor(new Date(s).getTime()/1e3),d=String(a.trans_direction??a.direction??a.in_out??"in"),l=d==="in"||d==="\u6536\u5165"||d==="",u=String(a.trade_no||a.trans_no||a.order_no||`${c}_${Math.round(i*100)}`);c>0&&l&&!r.has(u)&&(r.add(u),t.push({id:u,time:c,amount:Math.round(i*100)}))}Object.values(a).forEach(n)}};try{n(JSON.parse(e))}catch{}return t}function Ht(e){let t=e.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);return t?Math.floor(Date.parse(`${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:${t[6]||"00"}+08:00`)/1e3):0}function zo(e){let t=[];if(e.trim().startsWith("[")||e.trim().startsWith("{"))try{let o=JSON.parse(e);for(let a of Array.isArray(o)?o:[]){let s=Ht(String(a.time||"")),i=O(String(a.amount||""));s&&i>0&&t.push({id:String(a.id||`${s}_${i}`),time:s,amount:i})}return t}catch{}let r=/<tr class="bill">[\s\S]*?class="time">([^<]+)<[\s\S]*?class="amount">[¥￥]\s*([\d.]+)<[\s\S]*?class="type">([^<]*)<[\s\S]*?<\/tr>/g,n;for(;n=r.exec(e);){let o=Ht(n[1].trim()),a=O(n[2]);o&&a>0&&!n[3].includes("\u652F\u51FA")&&t.push({id:`${o}_${a}`,time:o,amount:a})}return t}async function Oe(e,t,r){let n={};try{n=JSON.parse(t.ext||"{}")}catch{}if(n.pay_amount)return String(n.pay_amount);if(!r)return(t.money/100).toFixed(2);for(let o=0;o<60;o++){let a=Math.floor(Math.random()*99)+1,s=(t.money/100+a/100).toFixed(2);if(!(await V({channelIds:[t.channel]})).some(d=>d.id!==t.id&&d.pay_amount===s))return n.pay_amount=s,await nt(t.trade_no,JSON.stringify(n)),s}return(t.money/100).toFixed(2)}async function Is(e){let t=new Date(v()*1e3+288e5),r=o=>String(o).padStart(2,"0"),n=`${t.getUTCFullYear()}-${r(t.getUTCMonth()+1)}-${r(t.getUTCDate())}`;try{let o=await Lt(e,"alipay.data.bill.accountlog.query",{bill_date:n});return o.code!=="10000"?[]:Lo(JSON.stringify(o.data||{}))}catch{return[]}}function js(e){let t=e.bill_url||"";return fetch(t,{headers:{Cookie:e.cookie||"","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"},signal:AbortSignal.timeout(1e4)}).then(r=>r.text())}async function Ho(e,t){let r=Uo(t.config),n=[];if(r.appid&&r.private_key)n=await Is(r);else if(r.cookie&&r.bill_url)try{n=zo(await js(r))}catch{return 0}else return 0;if(!n.length)return 0;let o=[];try{o=JSON.parse(await ie(`bill_seen_${t.id}`)||"[]")}catch{}let a=new Set(o),s=0;for(let i of n){if(a.has(i.id))continue;if(i.time<v()-86400){a.add(i.id);continue}let c=await V({channelIds:[t.id],to:i.time,from:i.time-86400,order:"asc",limit:20});for(let d of c){if((d.pay_amount?O(String(d.pay_amount)):d.money)!==i.amount)continue;if(await Q(e,d.trade_no,i.amount,"BILL"+i.id)){s++;let b=await M(d.trade_no);b&&await W(e,b)}a.add(i.id);break}}return a.size!==o.length&&await Se(`bill_seen_${t.id}`,JSON.stringify(Array.from(a).slice(-300))),s}async function Ms(e){let t=await ie("bill_last_poll");if(t&&parseInt(t,10)>v()-10)return-1;await Se("bill_last_poll",String(v()));let r=await Xn(["alipaybill","qqbill"],!0),n=0;for(let o of r)n+=await Ho(e,o);return n}var He=ne(()=>{N();fe();zt();K()});var Br={};Qt(Br,{DEFAULT_USDT_RATE:()=>Ko,USDT_TRC20_CONTRACT:()=>Mr,ensureTronUsdtAmount:()=>qr,fetchTronTransfers:()=>Jo,getUsdtRate:()=>Go,pollAllTronOrders:()=>qs,pollTronOrder:()=>Fo});async function Go(e){let t=parseFloat(e||"");if(!isNaN(t)&&t>0)return t;try{let r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny",{signal:AbortSignal.timeout(2500)});if(r.ok){let n=await r.json();if(n?.tether?.cny&&n.tether.cny>0)return Math.round(n.tether.cny*100)/100}}catch{}return Ko}async function qr(e,t,r){let n={};try{n=JSON.parse(t.ext||"{}")}catch{}let o=(r.address||"").trim();if(!o)throw new Error("TRC20 \u94B1\u5305\u5730\u5740\u672A\u914D\u7F6E");if(n.pay_usdt&&n.pay_sun&&n.wallet)return n;let a=await Go(r.rate),s=Math.max(5,parseInt(r.timeout||"15",10)||15),i=t.money/100/a,c="",d=0;for(let u=0;u<50;u++){let b=(Math.floor(Math.random()*99)+1)/1e4,g=(i+b).toFixed(4),k=Math.round(Number(g)*1e6);if(!(await V({channelIds:[t.channel]})).some(R=>R.id!==t.id&&R.pay_sun===k)){c=g,d=k;break}}if(!c){let u=(Date.now()%99+1)/1e4;c=(i+u).toFixed(4),d=Math.round(Number(c)*1e6)}let l={wallet:o,pay_usdt:c,pay_sun:d,rate:a.toFixed(2),expire_at:v()+s*60};return await nt(t.trade_no,JSON.stringify({...n,...l})),l}async function Jo(e,t,r){let o=`${(t||"").trim().replace(/\/+$/,"")||"https://api.trongrid.io"}/v1/accounts/${e}/transactions/trc20?limit=25&contract_address=${Mr}`,a={Accept:"application/json"};r&&(a["TRON-PRO-API-KEY"]=r.trim());try{let s=await fetch(o,{headers:a,signal:AbortSignal.timeout(4500)});if(s.ok){let i=await s.json();if(Array.isArray(i?.data))return i.data.map(c=>({txid:c.transaction_id,to:c.to,value:c.value,timeMs:c.block_timestamp}))}}catch{}if(!t)try{let s=`https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=25&start=0&contract_address=${Mr}&relatedAddress=${e}`,i=await fetch(s,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(4500)});if(i.ok){let c=await i.json();if(Array.isArray(c?.token_transfers))return c.token_transfers.map(d=>({txid:d.transaction_id,to:d.to_address,value:d.quant,timeMs:d.block_ts}))}}catch{}return[]}async function Fo(e,t){if(t.status!==0)return!1;let r={};try{r=JSON.parse(t.ext||"{}")}catch{}let n=typeof r.wallet=="string"?r.wallet:"",o=typeof r.pay_sun=="number"?r.pay_sun:0;if(!n||!o)return!1;let a=v(),s=typeof r.expire_at=="number"?r.expire_at:0;if(s&&a>s)return!1;let i=typeof r.last_poll=="number"?r.last_poll:0;if(i&&a-i<5)return!1;r.last_poll=a,await nt(t.trade_no,JSON.stringify(r));let c=await Re(t.channel||0),d={address:n};try{d=JSON.parse(c?.config||"{}")}catch{}let l=await Jo(n,d.api_base,d.trongrid_key);if(!l.length)return!1;let u=String(o),g=((t.addtime||a)-120)*1e3;for(let k of l){if(k.to.toLowerCase()!==n.toLowerCase()||String(k.value)!==u||k.timeMs<g||await uo(k.txid))continue;if(await Q(e,t.trade_no,t.money,k.txid)){let R=await M(t.trade_no);return R&&await W(e,R),!0}}return!1}async function qs(e){let t=await ee("tronusdt",!0);if(!t.length)return 0;let r=await V({channelIds:t.map(o=>o.id),order:"desc",limit:15}),n=0;for(let o of r)await Fo(e,o)&&n++;return n}var Mr,Ko,Kt=ne(()=>{ce();K();fe();N();K();Mr="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",Ko=7.3});var Wt=(e,t,r)=>(n,o)=>{let a=-1;return s(0);async function s(i){if(i<=a)throw new Error("next() called multiple times");a=i;let c,d=!1,l;if(e[i]?(l=e[i][0][0],n.req.routeIndex=i):l=i===e.length&&o||void 0,l)try{c=await l(n,()=>s(i+1))}catch(u){if(u instanceof Error&&t)n.error=u,c=await t(u,n),d=!0;else throw u}else n.finalized===!1&&r&&(c=await r(n));return c&&(n.finalized===!1||d)&&(n.res=c),n}};var Kr=Symbol();var Gr=(e,t)=>new Response(e,{headers:{"Content-Type":t.replace(/^[^;]+/,n=>n.toLowerCase())}}).formData();var Jr=32,Pa=1e4,lt=e=>"headers"in e,Qr=async(e,t=Object.create(null))=>{let{all:r=!1,dot:n=!1}=t,s=(lt(e)?e.headers:e.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();return s==="multipart/form-data"||s==="application/x-www-form-urlencoded"?Ra(e,{all:r,dot:n}):{}};async function Ra(e,t){if(!lt(e)&&e.bodyCache.formData)return Fr(await e.bodyCache.formData,t);let r=lt(e)?e.headers:e.raw.headers,n=await e.arrayBuffer(),o=Gr(n,r.get("Content-Type")||"");lt(e)||(e.bodyCache.formData=o);let a=await o;return a?Fr(a,t):{}}function Fr(e,t){let r=Object.create(null),n={count:0};return e.forEach((o,a)=>{t.all||a.endsWith("[]")?Ta(r,a,o):r[a]=o}),t.dot&&Object.entries(r).forEach(([o,a])=>{o.includes(".")&&(Ea(r,o,a,n),delete r[o])}),r}var Ta=(e,t,r)=>{e[t]!==void 0?Array.isArray(e[t])?e[t].push(r):e[t]=[e[t],r]:t.endsWith("[]")?e[t]=[r]:e[t]=r},Ea=(e,t,r,n)=>{if(/(?:^|\.)__proto__\./.test(t))return;let o=e,a=t.split(".",Jr+2);a.length>Jr+1&&Yr(),a.forEach((s,i)=>{i===a.length-1?o[s]=r:((!o[s]||typeof o[s]!="object"||Array.isArray(o[s])||o[s]instanceof File)&&(n.count++>=Pa&&Yr(),o[s]=Object.create(null)),o=o[s])})},Yr=()=>{throw new Error("Nesting limit exceeded")};var Xt=e=>{let t=e.split("/");return t[0]===""&&t.shift(),t},Wr=e=>{let{groups:t,path:r}=Aa(e),n=Xt(r);return Oa(n,t)},Aa=e=>{let t=[];return e=e.replace(/\{[^}]+\}/g,(r,n)=>{let o=`@${n}`;return t.push([o,r]),o}),{groups:t,path:e}},Oa=(e,t)=>{for(let r=t.length-1;r>=0;r--){let[n]=t[r];for(let o=e.length-1;o>=0;o--)if(e[o].includes(n)){e[o]=e[o].replace(n,t[r][1]);break}}return e},ut={},Vr=(e,t)=>{if(e==="*")return"*";let r=e.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);if(r){let n=`${e}#${t}`;return ut[n]||(r[2]?ut[n]=t&&t[0]!==":"&&t[0]!=="*"?[n,r[1],new RegExp(`^${r[2]}(?=/${t})`)]:[e,r[1],new RegExp(`^${r[2]}$`)]:ut[n]=[e,r[1],!0]),ut[n]}return null},Xr=(e,t)=>{try{return t(e)}catch{return e.replace(/(?:%[0-9A-Fa-f]{2})+/g,r=>{try{return t(r)}catch{return r}})}},$a=e=>Xr(e,decodeURI),Zt=e=>{let t=e.url,r=t.indexOf("/",t.indexOf(":")+4),n=r;for(;n<t.length;n++){let o=t.charCodeAt(n);if(o===37){let a=t.indexOf("?",n),s=t.indexOf("#",n),i=a===-1?s===-1?void 0:s:s===-1?a:Math.min(a,s),c=t.slice(r,i);return $a(c.includes("%25")?c.replace(/%25/g,"%2525"):c)}else if(o===63||o===35)break}return t.slice(r,n)};var Zr=e=>{let t=Zt(e);return t.length>1&&t.at(-1)==="/"?t.slice(0,-1):t},ge=(e,t,...r)=>(r.length&&(t=ge(t,...r)),`${e?.[0]==="/"?"":"/"}${e}${t==="/"?"":`${e?.at(-1)==="/"?"":"/"}${t?.[0]==="/"?t.slice(1):t}`}`),pt=e=>{if(e.charCodeAt(e.length-1)!==63||!e.includes(":"))return null;let t=e.split("/"),r=[],n="";return t.forEach(o=>{if(o!==""&&!/\:/.test(o))n+="/"+o;else if(/\:/.test(o))if(o.charCodeAt(o.length-1)===63){r.length===0&&n===""?r.push("/"):r.push(n);let a=o.slice(0,-1);n+="/"+a,r.push(n)}else n+="/"+o}),r.filter((o,a,s)=>s.indexOf(o)===a)},ft=e=>e.indexOf("%")!==-1?Xr(e,Na):e,Vt=e=>(e.indexOf("+")!==-1&&(e=e.replace(/\+/g," ")),ft(e)),en=(e,t,r)=>{let n=e.indexOf("#",8);n!==-1&&(e=e.slice(0,n));let o;if(!r&&t&&t.indexOf("%")===-1&&t.indexOf("+")===-1){let i=e.indexOf("?",8);if(i===-1)return;for(e.startsWith(t,i+1)||(i=e.indexOf(`&${t}`,i+1));i!==-1;){let c=e.charCodeAt(i+t.length+1);if(c===61){let d=i+t.length+2,l=e.indexOf("&",d);return Vt(e.slice(d,l===-1?void 0:l))}else if(c==38||isNaN(c))return"";i=e.indexOf(`&${t}`,i+1)}if(o=/[%+]/.test(e),!o)return}let a=Object.create(null);o??=/[%+]/.test(e);let s=e.indexOf("?",8);for(;s!==-1;){let i=e.indexOf("&",s+1),c=e.indexOf("=",s);c>i&&i!==-1&&(c=-1);let d=e.slice(s+1,c===-1?i===-1?void 0:i:c);if(o&&(d=Vt(d)),s=i,d==="")continue;let l;c===-1?l="":(l=e.slice(c+1,i===-1?void 0:i),o&&(l=Vt(l))),r?(a[d]&&Array.isArray(a[d])||(a[d]=[]),a[d].push(l)):a[d]??=l}return t?a[t]:a},tn=en,rn=(e,t)=>en(e,t,!0),Na=decodeURIComponent;var nn=class{raw;#t;#e;routeIndex=0;path;bodyCache={};constructor(e,t="/",r=[[]]){this.raw=e,this.path=t,this.#e=r}param(e){return e?this.#r(e):this.#a()}#r(e){let t=this.#e[0][this.routeIndex]?.[1][e],r=this.#n(t);return r&&ft(r)}#a(){let e={},t=Object.keys(this.#e[0][this.routeIndex]?.[1]??{});for(let r of t){let n=this.#n(this.#e[0][this.routeIndex][1][r]);n!==void 0&&(e[r]=ft(n))}return e}#n(e){return this.#e[1]?this.#e[1][e]:e}query(e){return tn(this.url,e)}queries(e){return rn(this.url,e)}header(e){if(e)return this.raw.headers.get(e)??void 0;let t=Object.create(null);return this.raw.headers.forEach((r,n)=>{t[n]=r}),t}async parseBody(e){return Qr(this,e)}#o=e=>{let{bodyCache:t,raw:r}=this,n=t[e];if(n)return n;for(let o in t)return t[o].then(a=>{o==="json"&&(a=JSON.stringify(a));let s=o==="formData"?void 0:r.headers.get("content-type");return new Response(a,{headers:s?{"Content-Type":s}:void 0})[e]()});return t[e]=r[e]()};json(){return this.#o("text").then(e=>JSON.parse(e))}text(){return this.#o("text")}arrayBuffer(){return this.#o("arrayBuffer")}bytes(){return this.#o("arrayBuffer").then(e=>new Uint8Array(e))}blob(){return this.#o("blob")}formData(){return this.#o("formData")}addValidatedData(e,t){(this.#t??={})[e]=t}valid(e){return this.#t?.[e]}get url(){return this.raw.url}get method(){return this.raw.method}get[Kr](){return this.#e}get matchedRoutes(){return this.#e[0].map(([[,e]])=>e)}get routePath(){return this.#e[0].map(([[,e]])=>e)[this.routeIndex].path}};var on={Stringify:1,BeforeStream:2,Stream:3},Ia=(e,t)=>{let r=new String(e);return r.isEscaped=!0,r.callbacks=t,r};var er=async(e,t,r,n,o)=>{typeof e=="object"&&!(e instanceof String)&&(e instanceof Promise||(e=e.toString()),e instanceof Promise&&(e=await e));let a=e.callbacks;if(!a?.length)return Promise.resolve(e);o?o[0]+=e:o=[e];let s=Promise.all(a.map(i=>i({phase:t,buffer:o,context:n}))).then(i=>Promise.all(i.filter(Boolean).map(c=>er(c,t,!1,n,o))).then(()=>o[0]));return r?Ia(await s,a):s};var ja="text/plain; charset=UTF-8",tr=(e,t)=>({"Content-Type":e,...t}),Ye=(e,t)=>new Response(e,t),rr=class{#t;#e;env={};#r;finalized=!1;error;#a;#n;#o;#l;#c;#d;#i;#u;#p;constructor(e,t){this.#t=e,t&&(this.#n=t.executionCtx,this.env=t.env,this.#d=t.notFoundHandler,this.#p=t.path,this.#u=t.matchResult)}get req(){return this.#e??=new nn(this.#t,this.#p,this.#u),this.#e}get event(){if(this.#n&&"respondWith"in this.#n)return this.#n;throw Error("This context has no FetchEvent")}get executionCtx(){if(this.#n)return this.#n;throw Error("This context has no ExecutionContext")}get res(){return this.#o||=Ye(null,{headers:this.#i??=new Headers})}set res(e){if(this.#o&&e){e=Ye(e.body,e);for(let[t,r]of this.#o.headers.entries())if(t!=="content-type")if(t==="set-cookie"){let n=this.#o.headers.getSetCookie();e.headers.delete("set-cookie");for(let o of n)e.headers.append("set-cookie",o)}else e.headers.set(t,r)}this.#o=e,this.finalized=!0}render=(...e)=>(this.#c??=t=>this.html(t),this.#c(...e));setLayout=e=>this.#l=e;getLayout=()=>this.#l;setRenderer=e=>{this.#c=e};header=(e,t,r)=>{this.finalized&&(this.#o=Ye(this.#o.body,this.#o));let n=this.#o?this.#o.headers:this.#i??=new Headers;t===void 0?n.delete(e):r?.append?n.append(e,t):n.set(e,t)};status=e=>{this.#a=e};set=(e,t)=>{this.#r??=new Map,this.#r.set(e,t)};get=e=>this.#r?this.#r.get(e):void 0;get var(){return this.#r?Object.fromEntries(this.#r):{}}#s(e,t,r){let n=this.#o?new Headers(this.#o.headers):this.#i;if(typeof t=="object"&&t.headers){n??=new Headers;for(let[a,s]of new Headers(t.headers))a==="set-cookie"?n.append(a,s):n.set(a,s)}if(r){if(!n){let a=0;for(let s in r)if(++a>1||typeof r[s]!="string"){n=new Headers;break}}if(n)for(let a in r){let s=r[a];if(typeof s=="string")n.set(a,s);else{n.delete(a);for(let i of s)n.append(a,i)}}}let o=typeof t=="number"?t:t?.status??this.#a;return Ye(e,{status:o,headers:n??r})}newResponse=(...e)=>this.#s(...e);body=(e,t,r)=>this.#s(e,t,r);text=(e,t,r)=>!this.#i&&!this.#a&&!t&&!r&&!this.finalized?new Response(e):this.#s(e,t,tr(ja,r));json=(e,t,r)=>this.#s(JSON.stringify(e),t,tr("application/json",r));html=(e,t,r)=>{let n=o=>this.#s(o,t,tr("text/html; charset=UTF-8",r));return typeof e=="object"?er(e,on.Stringify,!1,{}).then(n):n(e)};redirect=(e,t)=>{let r=String(e);return this.header("Location",/[^\x00-\xFF]/.test(r)?encodeURI(r):r),this.newResponse(null,t??302)};notFound=()=>(this.#d??=()=>Ye(),this.#d(this))};var H="ALL",an="all",sn=["get","post","put","delete","options","patch","query"],mt="Can not add a route since the matcher is already built.",gt=class extends Error{};var cn="__COMPOSED_HANDLER";var Ma=e=>e.text("404 Not Found",404),dn=(e,t)=>{if("getResponse"in e){let r=e.getResponse();return t.newResponse(r.body,r)}return console.error(e),t.text("Internal Server Error",500)},ln=class un{get;post;put;delete;options;patch;query;all;on;use;router;getPath;_basePath="/";#t="/";routes=[];constructor(t={}){[...sn,an].forEach(a=>{this[a]=(s,...i)=>{let c=a.toUpperCase();return typeof s=="string"?this.#t=s:this.#a(c,this.#t,s),i.forEach(d=>{this.#a(c,this.#t,d)}),this}}),this.on=(a,s,...i)=>{for(let c of[s].flat()){this.#t=c;for(let d of[a].flat()){let l=d.toUpperCase();for(let u of i)this.#a(l,this.#t,u)}}return this},this.use=(a,...s)=>(typeof a=="string"?this.#t=a:(this.#t="*",s.unshift(a)),s.forEach(i=>{this.#a(H,this.#t,i)}),this);let{strict:n,...o}=t;Object.assign(this,o),this.getPath=n??!0?t.getPath??Zt:Zr}#e(){let t=new un({router:this.router,getPath:this.getPath});return t.errorHandler=this.errorHandler,t.#r=this.#r,t.routes=this.routes,t}#r=Ma;errorHandler=dn;route(t,r){let n=this.basePath(t);return r.routes.map(o=>{let a;r.errorHandler===dn?a=o.handler:(a=async(s,i)=>(await Wt([],r.errorHandler)(s,()=>o.handler(s,i))).res,a[cn]=o.handler),n.#a(o.method,o.path,a,o.basePath)}),this}basePath(t){let r=this.#e();return r._basePath=ge(this._basePath,t),r}onError=t=>(this.errorHandler=t,this);notFound=t=>(this.#r=t,this);mount(t,r,n){let o,a;n&&(typeof n=="function"?a=n:(a=n.optionHandler,n.replaceRequest===!1?o=c=>c:o=n.replaceRequest));let s=a?c=>{let d=a(c);return Array.isArray(d)?d:[d]}:c=>{let d;try{d=c.executionCtx}catch{}return[c.env,d]};o||=(()=>{let c=ge(this._basePath,t),d=c==="/"?0:c.length;return l=>{let u=new URL(l.url);return u.pathname=this.getPath(l).slice(d)||"/",new Request(u,l)}})();let i=async(c,d)=>{let l=await r(o(c.req.raw),...s(c));if(l)return l;await d()};return this.#a(H,ge(t,"*"),i),this}#a(t,r,n,o){r=ge(this._basePath,r);let a={basePath:o!==void 0?ge(this._basePath,o):this._basePath,path:r,method:t,handler:n};this.router.add(t,r,[n,a]),this.routes.push(a)}#n(t,r){if(t instanceof Error)return this.errorHandler(t,r);throw t}#o(t,r,n,o){if(o==="HEAD")return(async()=>new Response(null,await this.#o(t,r,n,"GET")))();let a=this.getPath(t,{env:n}),s=this.router.match(o,a),i=new rr(t,{path:a,matchResult:s,env:n,executionCtx:r,notFoundHandler:this.#r});if(s[0].length===1){let d;try{d=s[0][0][0][0](i,async()=>{i.res=await this.#r(i)})}catch(l){return this.#n(l,i)}return d instanceof Promise?d.then(l=>l||(i.finalized?i.res:this.#r(i))).catch(l=>this.#n(l,i)):d??this.#r(i)}let c=Wt(s[0],this.errorHandler,this.#r);return(async()=>{try{let d=await c(i);if(!d.finalized)throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");return d.res}catch(d){return this.#n(d,i)}})()}fetch=(t,...r)=>this.#o(t,r[1],r[0],t.method);request=(t,r,n,o)=>t instanceof Request?this.fetch(r?new Request(t,r):t,n,o):(t=t.toString(),this.fetch(new Request(/^https?:\/\//.test(t)?t:`http://localhost${ge("/",t)}`,r),n,o));fire=()=>{addEventListener("fetch",t=>{t.respondWith(this.#o(t.request,t,void 0,t.request.method))})}};var L=()=>Object.create(null);var ht=[];function nr(e,t){let r=this.buildAllMatchers(),n=((o,a)=>{let s=r[o]||r[H],i=s[2][a];if(i)return i;let c=a.match(s[0]);if(!c)return[[],ht];let d=c.indexOf("",1);return[s[1][d],c]});return this.match=n,n(e,t)}var Ne="[^/]+",ye=".*",le="(?:|/.*)",he=Symbol(),pn=new Set(".\\+*[^]$()");function qa(e,t){return e.length===1?t.length===1?e<t?-1:1:-1:t.length===1?1:e===ye||e===le?t===le?-1:1:t===ye||t===le?-1:e===Ne?1:t===Ne?-1:e.length===t.length?e<t?-1:1:t.length-e.length}var fn=class or{#t;#e;#r=L();insert(t,r,n,o,a){let s=this;for(let i=0,c=t.length;i<c;i++){let d=t[i],l=d.length===1?d==="*"?i===c-1?["","",ye]:["","",Ne]:null:d==="/*"?["","",le]:d.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/),u;if(l){let b=l[1],g=l[2]||Ne;if(b&&l[2]&&(g===".*"||(g=g.replace(/^\((?!\?:)(?=[^)]+\)$)/,"(?:"),/\((?!\?:)/.test(g))||g.length===1&&pn.has(g)))throw he;if(u=s.#r[g],!u){if(g!==ye&&g!==le){for(let k in s.#r)if((g.length>1||k.length>1)&&k!==ye&&k!==le)throw he}u=s.#r[g]=new or}b!==""&&(u.#e??=o.varIndex++,n.push([b,u.#e]))}else if(u=s.#r[d],!u){for(let b in s.#r)if(b.length>1&&b!==ye&&b!==le)throw he;u=s.#r[d]=new or}s=u}if(s.#t!==void 0)throw he;s.#t=a?-1:r}buildRegExpStr(){let r=Object.keys(this.#r).sort(qa).map(n=>{let o=this.#r[n],a=o.buildRegExpStr();return a===""?"":(typeof o.#e=="number"?`(${n})@${o.#e}`:pn.has(n)?`\\${n}`:n)+a}).filter(Boolean);return typeof this.#t=="number"&&this.#t!==-1&&r.unshift(`#${this.#t}`),r.length===0?"":r.length===1?r[0]:"(?:"+r.join("|")+")"}};var ar=class{#t={varIndex:0};#e=new fn;#r=0;paths=L();insert(e,t){if(t){this.#e.insert(e.split(""),0,[],this.#t,!0);return}let r=[],n=[],o=e;for(let s=0;;){let i=!1;if(o=o.replace(/\{[^}]+\}/g,c=>{let d=`@\\${s}`;return n[s]=[d,c],s++,i=!0,d}),!i)break}let a=o.match(/(?::[^\/]+)|(?:\/\*$)|./g)||[];for(let s=n.length-1;s>=0;s--){let[i]=n[s];for(let c=a.length-1;c>=0;c--)if(a[c].indexOf(i)!==-1){a[c]=a[c].replace(i,n[s][1]);break}}this.#e.insert(a,this.#r,r,this.#t,!1),this.paths[e]=[this.#r++,r]}buildRegExp(){let e=this.#e.buildRegExpStr();if(e==="")return[/^$/,[],[]];let t=0,r=[],n=[];return e=e.replace(/#(\d+)|@(\d+)|\.\*\$/g,(o,a,s)=>a!==void 0?(r[++t]=Number(a),"$()"):(s!==void 0&&(n[Number(s)]=++t),"")),[new RegExp(`^${e}`),r,n]}};var mn=L();function gn(e){return mn[e]??=new RegExp(`^${e.replace(/\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g,(t,r)=>r?`\\${r}`:t==="/*"?le:t==="*"?ye:`/:${Ne}`)}$`)}function yt(e,t){for(let r of Object.keys(e).sort((n,o)=>o.length-n.length))if(gn(r).test(t))return[...e[r]]}var wt=class{name="RegExpRouter";#t;#e;#r;constructor(){this.#t={[H]:L()},this.#e={[H]:L()},this.#r={[H]:new ar}}#a(e,t){try{this.#r[e].insert(t,!/\*|\/:/.test(t))}catch(r){throw r===he?new gt(t):r}}add(e,t,r){let n=this.#t,o=this.#e;if(!n)throw new Error(mt);if(!n[e]){this.#r[e]=new ar;for(let i of[n,o]){i[e]=L();for(let c in i[H])i[e][c]=[...i[H][c]],this.#a(e,c)}}t==="/*"&&(t="*");let a=e===H?Object.keys(n):[e];if(/\*$/.test(t)){let i=gn(t);for(let c of a)n[c][t]||(this.#a(c,t),n[c][t]=yt(n[c],t)||yt(n[H],t)||[]);for(let c of[n,o])for(let d of a)for(let l in c[d])i.test(l)&&c[d][l].push([r,t]);return}let s=pt(t)||[t];for(let i of s)for(let c of a)o[c][i]||(this.#a(c,i),o[c][i]=yt(n[c],i)||yt(n[H],i)||[]),o[c][i].push([r,i])}match=nr;buildAllMatchers(){let e=L();for(let t of Object.keys(this.#e))e[t]=this.#n(t);return this.#t=this.#e=this.#r=void 0,mn=L(),e}#n(e){let t=this.#t[e],r=this.#e[e],n=this.#r[e],o=L(),a=[],[s,i,c]=n.buildRegExp();for(let d of[t,r])for(let l in d){let u=d[l],b=n.paths[l];if(!b){o[l]=[u.map(([g])=>[g,L()]),ht];continue}a[b[0]]=u.map(([g,k])=>[g,n.paths[k][1].reduceRight((C,[P],R)=>(C[P]=c[b[1][R][1]],C),L())])}return[s,i.map(d=>a[d]),o]}};var sr=class{name="SmartRouter";#t=[];#e=[];constructor(e){this.#t=e.routers}add(e,t,r){if(!this.#e)throw new Error(mt);this.#e.push([e,t,r])}match(e,t){if(!this.#e)throw new Error("Fatal error");let r=this.#t,n=this.#e,o=r.length,a=0,s;for(;a<o;a++){let i=r[a];try{for(let c=0,d=n.length;c<d;c++)i.add(...n[c]);s=i.match(e,t)}catch(c){if(c instanceof gt)continue;throw c}this.match=i.match.bind(i),this.#t=[i],this.#e=void 0;break}if(a===o)throw new Error("Fatal error");return this.name=`SmartRouter + ${this.activeRouter.name}`,s}get activeRouter(){if(this.#e||this.#t.length!==1)throw new Error("No active router has been determined yet.");return this.#t[0]}};var ir=L(),Ba=0,hn=class yn{#t=[];#e=L();#r=[];#a;#n=ir;insert(t,r,n){let o=this,a=Wr(r),s=new Set,i=0;for(let c of a){let d=a[++i],l=Vr(c,d)||(d===void 0&&c&&c.indexOf("*")===c.length-1?c:null),u=Array.isArray(l),b=u?l[0]:l||c,g=o.#e[b]||=new yn;l&&!g.#a&&(g.#a=l,o.#r.push(g)),o=g,u&&s.add(l[1])}o.#t.push({[t]:{handler:n,possibleKeys:[...s],score:++Ba}})}#o(t,r,n,o,a){for(let s=0,i=r.#t.length;s<i;s++){let c=r.#t[s],d=c[n]||c[H];if(d){d.params=L(),t.push(d);for(let l=0,u=d.possibleKeys.length;l<u;l++){let b=d.possibleKeys[l];d.params[b]=a?.[b]&&!l?a[b]:o[b]??a?.[b]}}}}search(t,r){let n=[];this.#n=ir;let a=[this],s=Xt(r),i=[],c=s.length,d=null;for(let l=0;l<c;l++){let u=s[l],b=l===c-1,g=[];for(let C=0,P=a.length;C<P;C++){let R=a[C],F=R.#e[u];F&&(F.#n=R.#n,b?(F.#e["*"]&&this.#o(n,F.#e["*"],t,R.#n),this.#o(n,F,t,R.#n)):g.push(F));for(let E of R.#r){let p=E.#a,x=R.#n===ir?{}:{...R.#n};if(typeof p=="string"){(p==="*"||u.startsWith(p.slice(0,-1)))&&(this.#o(n,E,t,R.#n),p==="*"&&(E.#n=x,g.push(E)));continue}let[,f,S]=p;if(!(!u&&S===!0)){if(S!==!0){if(!d){d=[];let z=r[0]==="/"?1:0;for(let m=0;m<c;m++)d[m]=z,z+=s[m].length+1}let A=r.slice(d[l]),j=S.exec(A);if(j){x[f]=j[0],this.#o(n,E,t,R.#n,x),j[0].length===A.length&&E.#e["*"]&&this.#o(n,E.#e["*"],t,R.#n,x);for(let z in E.#e){E.#n=x;let m=j[0].match(/\//g)?.length??0;(i[m]||=[]).push(E);break}continue}}(S===!0||S.test(u))&&(x[f]=u,b?(this.#o(n,E,t,x,R.#n),E.#e["*"]&&this.#o(n,E.#e["*"],t,x,R.#n)):(E.#n=x,g.push(E)))}}}let k=i.shift();a=k?g.concat(k):g}return n[1]&&n.sort((l,u)=>l.score-u.score),[n.map(({handler:l,params:u})=>[l,u])]}};var cr=class{name="TrieRouter";#t=new hn;add(e,t,r){for(let n of pt(t)||[t])this.#t.insert(e,n,r)}match(e,t){return this.#t.search(e,t)}};var B=class extends ln{constructor(e={}){super(e),this.router=e.router??new sr({routers:[new wt,new cr]})}};ce();pe();N();var Er=new Map;function de(e){Er.set(e.id,e)}function Bt(e){return Er.get(e)}function at(){return Array.from(Er.values())}function Ao(e){let t={},r=[];try{t=JSON.parse(e.config||"{}")}catch{}try{r=JSON.parse(e.types||"[]")}catch{}return{id:e.id,plugin:e.plugin,name:e.name,status:e.status,config:t,types:r}}function Oo(e){let t=e.headers.get("x-forwarded-proto")||new URL(e.url).protocol.replace(":",""),r=e.headers.get("x-forwarded-host")||e.headers.get("host")||new URL(e.url).host;return`${t}://${r}`}fe();K();async function Or(e,t){let r=await ie("channel_map"),n={};try{n=JSON.parse(r||"{}")}catch{}let o=n[e],a=[];if(typeof o=="number"?a=[o]:Array.isArray(o)?a=o.map(u=>Number(u)).filter(Boolean):typeof o=="string"&&o.trim()&&(a=o.split(",").map(u=>parseInt(u.trim(),10)).filter(Boolean)),!a.length)return{ok:!1,msg:`\u652F\u4ED8\u65B9\u5F0F ${e} \u672A\u914D\u7F6E\u901A\u9053`};let i=(await Vn(a,!0)||[]).filter(u=>{let b={};try{b=JSON.parse(u.config||"{}")}catch{}if(u.plugin==="tronusdt"||u.plugin==="bepusdt"||e==="usdt"){let P=parseFloat(b.rate||"")||7.3,R=t/100/P,F=parseFloat(b.paymin||"0"),E=parseFloat(b.paymax||"0");return!(F>0&&R<F-1e-4||E>0&&R>E+1e-4)}let k=Math.round(Number(b.paymin||0)*100),C=Math.round(Number(b.paymax||0)*100);return!(k&&t<k||C&&t>C)});if(!i.length)return{ok:!1,msg:"\u652F\u4ED8\u901A\u9053\u4E0D\u53EF\u7528\u6216\u91D1\u989D\u4E0D\u5728\u652F\u6301\u8303\u56F4"};let c=i.map(u=>Math.max(1,u.weight||1)),d=c.reduce((u,b)=>u+b,0),l=Math.random()*d;for(let u=0;u<i.length;u++)if(l-=c[u],l<=0)return{ok:!0,channelId:i[u].id};return{ok:!0,channelId:i[i.length-1].id}}function $r(e,t){return!e||!t?!1:e.split(/[,\n]/).map(r=>r.trim()).filter(Boolean).some(r=>r.endsWith(".")?t.startsWith(r):t===r)}K();function Nr(e){let t=e.headers,r=t.get("cf-connecting-ip")||t.get("x-epay-ip");if(r)return r.trim();let n=t.get("x-forwarded-for");return n?n.split(",")[0].trim():(t.get("x-real-ip")||"").trim()}function qo(e){let t=e.headers,r=t.get("cf-ipcountry")||t.get("x-epay-country")||t.get("x-country-code")||e.cf?.country||"";return String(r).toUpperCase()}var me=new B;function Yo(e){return{pid:e.pid||"",type:(e.type||"").toLowerCase(),out_trade_no:e.out_trade_no||"",notify_url:e.notify_url||"",return_url:e.return_url||"",name:e.name||"",money:e.money||"",sitename:e.sitename||"",sign:e.sign||"",sign_type:e.sign_type||"MD5"}}async function Qo(e,t,r){let n=await te(r.uid);if(!n||n.status!==1)return{ok:!1,msg:"\u5546\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u7981\u7528"};let o=await J();if(o.cert_force==="1"&&n.cert!==2)return{ok:!1,msg:"\u5546\u6237\u672A\u5B8C\u6210\u5B9E\u540D\u8BA4\u8BC1"};let a=Nr(t);if(!r.skipRisk&&$r(o.blacklist||"",a))return{ok:!1,msg:"\u8BF7\u6C42\u88AB\u62D2\u7EDD"};let s=await Or(r.type,r.money);if(!s.ok)return{ok:!1,msg:s.msg||"\u65E0\u53EF\u7528\u901A\u9053"};let i=dr();return await Cr({trade_no:i,out_trade_no:r.out_trade_no,uid:r.uid,type:r.type,channel:s.channelId,name:r.name,money:r.money,addtime:v(),notify_url:r.notify_url,return_url:r.return_url,domain:"",ip:a}),{ok:!0,msg:"ok",tradeNo:i}}async function Wo(e,t,r){if(!r.pid||!r.type||!r.out_trade_no||!r.notify_url||!r.money)return{ok:!1,msg:"\u53C2\u6570\u4E0D\u5B8C\u6574"};if(r.sign_type!=="MD5"&&r.sign_type!=="RSA"&&r.sign_type!=="RSA2")return{ok:!1,msg:"\u4E0D\u652F\u6301\u7684\u7B7E\u540D\u7C7B\u578B"};let n=parseInt(r.pid,10),o=await te(n);if(!o||o.status!==1)return{ok:!1,msg:"\u5546\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u7981\u7528"};if(!await Mo(o,r,r.sign))return{ok:!1,msg:"\u7B7E\u540D\u9519\u8BEF"};let a=O(r.money);if(a<=0)return{ok:!1,msg:"\u91D1\u989D\u9519\u8BEF"};let s=await J();if(s.cert_force==="1"&&o.cert!==2)return{ok:!1,msg:"\u5546\u6237\u672A\u5B8C\u6210\u5B9E\u540D\u8BA4\u8BC1"};let i=Nr(t);if($r(s.blacklist||"",i))return{ok:!1,msg:"\u8BF7\u6C42\u88AB\u62D2\u7EDD"};let c=(s.block_countries||"").split(",").map(g=>g.trim().toUpperCase()).filter(Boolean),d=qo(t);if(c.length&&d&&c.includes(d))return{ok:!1,msg:"\u8BF7\u6C42\u88AB\u62D2\u7EDD"};if(s.auth_domain==="1"&&o.domain){let g=t.headers.get("referer")||"",k=g?new URL(g).hostname:"",C=o.domain.split(",").map(P=>P.trim()).filter(Boolean);if(!k||!C.includes(k))return{ok:!1,msg:"\u6765\u6E90\u57DF\u540D\u672A\u6388\u6743"}}let l=await Or(r.type,a);if(!l.ok)return{ok:!1,msg:l.msg||"\u65E0\u53EF\u7528\u901A\u9053"};let u=l.channelId,b=dr();return await Cr({trade_no:b,out_trade_no:r.out_trade_no,uid:n,type:r.type,channel:u,name:r.name,money:a,addtime:v(),notify_url:r.notify_url,return_url:r.return_url,domain:t.headers.get("referer")?new URL(t.headers.get("referer")).hostname:"",ip:i}),{ok:!0,msg:"ok",tradeNo:b}}async function Vo(e,t,r){let n=await Re(r.channel);if(!n)return{ok:!1,msg:"\u6E20\u9053\u4E0D\u5B58\u5728"};let o=Ao(n),a=Bt(o.plugin);return a?await a.createOrder({env:e,channel:{id:o.id,plugin:o.plugin,config:o.config},order:r,payType:r.type,siteUrl:Oo(t)}):{ok:!1,msg:"\u63D2\u4EF6\u672A\u5B9E\u73B0"}}async function Ke(e,t){return await M(t)}for(let e of["/submit.php","/submit"])me.all(e,async t=>{let r=t.req.method==="GET"?t.req.query():await Xo(t.req.raw),n=Yo(r),o=await Wo(t.env,t.req.raw,n);return o.ok?t.redirect(`/cashier/${o.tradeNo}`,302):t.html(Dr(n.sitename,o.msg))});for(let e of["/mapi.php","/mapi"])me.all(e,async t=>{let r=t.req.method==="GET"?t.req.query():await Xo(t.req.raw),n=Yo(r),o=await Wo(t.env,t.req.raw,n);if(!o.ok)return t.json({code:-1,msg:o.msg});let a=await Ke(t.env,o.tradeNo),s=await Vo(t.env,t.req.raw,a);return s.ok?t.json({code:1,trade_no:o.tradeNo,payurl:s.payUrl||"",qrcode:s.qrContent||"",img:s.qrContent||"",coin_amount:s.coinAmount||"",wallet_address:s.walletAddress||""}):t.json({code:-1,msg:s.msg})});me.get("/cashier/:tradeNo",async e=>{let t=await Ke(e.env,e.req.param("tradeNo"));if(!t)return e.html(Dr("","\u8BA2\u5355\u4E0D\u5B58\u5728"));if(t.status>=1)return e.redirect(`/payok/${t.trade_no}`);let r=await Vo(e.env,e.req.raw,t);if(r.ok&&r.payUrl)return e.redirect(r.payUrl);let n=await te(t.uid),o=r.ok&&r.qrContent||"",a=r.ok?"":r.msg||"\u521B\u5EFA\u652F\u4ED8\u5931\u8D25";return e.html(Bs({siteName:await q("sitename")||"Epay",tradeNo:t.trade_no,orderName:t.name||"\u5546\u54C1\u8BA2\u5355",money:r.payAmount||$(t.money),type:t.type,qr:o,merchant:n?.username||String(t.uid),err:a,transferUrl:r.transferUrl||"",coinAmount:r.coinAmount,coinRate:r.coinRate,walletAddress:r.walletAddress,expireSeconds:r.expireSeconds}))});me.get("/api/cashier/status",async e=>{let t=e.req.query("trade_no")||"",r=await Ke(e.env,t);if(!r)return e.json({code:-1,msg:"\u8BA2\u5355\u4E0D\u5B58\u5728"});if(r.status===0){let{pollAllBills:n}=await Promise.resolve().then(()=>(He(),jr));e.executionCtx.waitUntil(n(e.env));let{pollTronOrder:o}=await Promise.resolve().then(()=>(Kt(),Br));if(await o(e.env,r))return e.json({code:0,status:1})}return e.json({code:0,status:r.status})});me.all("/getshop.php",async e=>{let t=e.req.query("trade_no")||"",r=await Ke(e.env,t);if(!r)return e.json({code:-2,msg:"No trade_no!"});if(r.status>=1){let n=r.return_url?await Ar(e.env,r):"/payok.html";return e.json({code:1,msg:"\u4ED8\u6B3E\u6210\u529F",backurl:n})}return e.json({code:-1,msg:"\u672A\u4ED8\u6B3E"})});me.get("/payok/:tradeNo",async e=>{let t=await Ke(e.env,e.req.param("tradeNo"));if(!t)return e.html(Dr("","\u8BA2\u5355\u4E0D\u5B58\u5728"));if(t.status===0)return e.redirect(`/cashier/${t.trade_no}`);let r=await Ar(e.env,t);return r?e.redirect(r):e.html(`<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:60px"><h2 style="color:#1aad19">\u2714 \u652F\u4ED8\u6210\u529F</h2><p>\u8BA2\u5355\u53F7 ${t.trade_no}</p></body>`)});me.all("/api.php",async e=>{let t={};if(e.req.method==="POST")try{(await e.req.raw.formData()).forEach((s,i)=>t[i]=String(s))}catch{}let r=e.req.query("act")||t.act||"order",o=(await J()).syskey||"";if(r==="order"){let a=e.req.query("trade_no")||"";if(!a)return e.json({code:-3,msg:"trade_no \u4E0D\u80FD\u4E3A\u7A7A"});let s=await Ke(e.env,a);if(!s)return e.json({code:-3,msg:"\u8BA2\u5355\u4E0D\u5B58\u5728"});let i=parseInt(e.req.query("pid")||"0",10),c=e.req.query("key")||"",d=await te(s.uid);return d&&i===s.uid&&c===d.key||o!==""&&e.req.query("sign")===(0,D.default)(o+a+o)?e.json({code:1,trade_no:s.trade_no,out_trade_no:s.out_trade_no,uid:s.uid,type:s.type,name:s.name,money:$(s.money),status:s.status,addtime:s.addtime,endtime:s.endtime}):e.json({code:-3,msg:"\u5546\u6237\u5BC6\u94A5\u9519\u8BEF"})}if(r==="refundapi"){let a=t,s=String(a.trade_no||""),i=String(a.money||"");if(!/^[\d.]+$/.test(i))return e.json({code:-1,msg:"\u91D1\u989D\u8F93\u5165\u9519\u8BEF"});if(String(a.key||"")!==(o?(0,D.default)(s+o+s):""))return e.json({code:-1,msg:"\u5BC6\u94A5\u9519\u8BEF"});let{markOrderRefunded:c}=await Promise.resolve().then(()=>(ce(),Po)),d=await c(e.env,s);return e.json({code:d.ok?0:-1,msg:d.ok?"\u9000\u6B3E\u6210\u529F\uFF01\u9000\u6B3E\u91D1\u989D\uFFE5"+i:d.msg})}return e.json({code:-5,msg:"No Act!"})});async function Xo(e){let t={};new URL(e.url).searchParams.forEach((r,n)=>t[n]=r);try{(await e.formData()).forEach((n,o)=>t[o]=String(n))}catch{}return t}function Dr(e,t){return`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#f2f2f2"><div style="max-width:420px;margin:60px auto;background:#fff;border-radius:8px;padding:40px 30px;text-align:center"><h3 style="color:#e64340;margin:0 0 16px">\u652F\u4ED8\u5931\u8D25</h3><p style="color:#666">${t}</p><p style="color:#999;font-size:12px">${e}</p></div></body>`}function Bs(e){let t=/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(e.qr),r=e.type==="usdt"&&!!e.walletAddress,n={wxpay:["\u5FAE\u4FE1\u652F\u4ED8","#10b981"],alipay:["\u652F\u4ED8\u5B9D","#2563eb"],qqpay:["QQ \u94B1\u5305","#0284c7"],usdt:["USDT \u6CF0\u8FBE\u5E01 (TRC20)","#059669"],bank:["\u94F6\u8054 / \u4E91\u95EA\u4ED8","#d97706"],paypal:["PayPal \u8D1D\u5B9D","#0070ba"],jdpay:["\u4EAC\u4E1C\u652F\u4ED8","#e1251b"]},[o,a]=n[e.type]||[e.type.toUpperCase(),"#334155"];return`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${e.orderName} - \u6536\u94F6\u53F0</title>
<style>
:root{
  --bg:#f1f5f9;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --color:${a};
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px}
.checkout-card{background:var(--surface);width:100%;max-width:420px;border-radius:24px;border:1px solid rgba(226,232,240,0.8);box-shadow:0 20px 40px -15px rgba(15,23,42,0.08);overflow:hidden;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.card-top{padding:24px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.site-badge{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text)}
.secure-pill{font-size:11px;font-weight:600;color:#059669;background:#ecfdf5;padding:4px 10px;border-radius:100px;display:flex;align-items:center;gap:4px}

.card-body{padding:28px 24px 32px;text-align:center}
.channel-pill{display:inline-flex;align-items:center;gap:6px;background:#f8fafc;border:1px solid var(--border);color:var(--text);font-size:13px;font-weight:600;padding:6px 14px;border-radius:100px;margin-bottom:16px}
.amount-box{margin-bottom:12px}
.amount-box .sym{font-size:24px;font-weight:700;margin-right:2px}
.amount-box .val{font-size:40px;font-weight:800;letter-spacing:-1px;color:var(--text)}

.order-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px}
.order-num{font-size:12px;color:var(--text-muted);font-family:monospace}

.qr-box{margin:20px auto 16px;width:196px;height:196px;background:#fff;border:1px solid var(--border);border-radius:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.04);padding:8px}
.qr-box img{width:180px;height:180px;border-radius:12px;display:block}
#qrcode{width:180px;height:180px;display:flex;align-items:center;justify-content:center}

.btn-copy{border:1px solid var(--border);background:#fff;color:var(--text);font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:all .15s}
.btn-copy:hover{border-color:var(--color);color:var(--color)}
.btn-copy:active{transform:scale(0.95)}

.pay-tip{font-size:13px;color:var(--text-muted);margin:16px 0 20px;line-height:1.6}
.pay-tip b{color:var(--color)}

.btn-transfer{display:block;width:100%;background:var(--color);color:#fff;font-size:15px;font-weight:700;padding:14px;border-radius:14px;text-decoration:none;margin-top:16px;box-shadow:0 4px 14px -2px rgba(37,99,235,0.4);transition:all .2s}
.btn-transfer:active{transform:scale(0.98);opacity:0.9}

.status-pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--text-muted);background:#f8fafc;border:1px solid var(--border);padding:6px 16px;border-radius:100px;margin-top:16px}
.pulse-dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.85)}}

.status-pill.success{background:#ecfdf5;border-color:#a7f3d0;color:#059669;font-weight:700}
.status-pill.success .pulse-dot{background:#10b981;animation:none}

.card-foot{margin-top:24px;font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;border-top:1px dashed var(--border);padding-top:16px}
</style></head><body>

<div class="checkout-card">
  <div class="card-top">
    <div class="site-badge">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>${e.siteName}</span>
    </div>
    <div class="secure-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>\u5B89\u5168\u6536\u94F6\u53F0</span>
    </div>
  </div>

  <div class="card-body">
    ${e.err?`<div style="color:#ef4444;padding:30px 0;font-weight:600">${e.err}</div>`:`
    <div class="channel-pill">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${a}"></span>
      <span>${o}</span>
    </div>

    ${r?`
      <div class="amount-box">
        <span class="sym" style="color:#059669;font-size:24px">\u20AE</span>
        <span class="val" data-pay="${(e.coinAmount||"").replace(/[^0-9.]/g,"")}" style="color:#059669">${e.coinAmount||e.money}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:-6px;margin-bottom:14px">
        \u539F\u8BA2\u5355 \xA5${e.money} ${e.coinRate?` \xB7 ${e.coinRate}`:""}
      </div>
    `:`
      <div class="amount-box">
        <span class="sym">\xA5</span><span class="val" data-pay="${e.money}">${e.money}</span>
      </div>
    `}

    <div class="order-title">${e.orderName}</div>
    <div class="order-num">\u5355\u53F7\uFF1A${e.tradeNo}</div>

    ${e.qr?t?`<div class="qr-box"><img src="${e.qr}" alt="\u6536\u6B3E\u7801"></div>`:'<div class="qr-box"><div id="qrcode"></div></div>':""}

    ${r?`
      <div style="background:#f8fafc;border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin:16px 0;text-align:left;font-size:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:700;color:var(--text)">\u6536\u6B3E\u5730\u5740 <span style="font-size:11px;font-weight:400;color:#059669">(TRC20\u7F51\u7EDC)</span></span>
          <button type="button" class="btn-copy" onclick="copyVal('${e.walletAddress}', this)">\u590D\u5236\u5730\u5740</button>
        </div>
        <div style="font-family:monospace;word-break:break-all;color:#334155;background:#fff;padding:8px;border-radius:8px;border:1px solid #e2e8f0;font-size:12px;letter-spacing:0.2px">${e.walletAddress}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;margin-bottom:6px">
          <span style="font-weight:700;color:var(--text)">\u7CBE\u786E\u8F6C\u8D26\u91D1\u989D</span>
          <button type="button" class="btn-copy" onclick="copyVal('${(e.coinAmount||"").replace(/[^0-9.]/g,"")}', this)">\u590D\u5236\u91D1\u989D</button>
        </div>
        <div style="font-family:monospace;word-break:break-all;color:#059669;background:#ecfdf5;padding:8px 10px;border-radius:8px;border:1px solid #a7f3d0;font-size:14px;font-weight:700">${e.coinAmount}</div>
      </div>

      <div class="pay-tip" style="margin-top:12px">
        <b style="color:#059669">\u26A0\uFE0F \u8BF7\u52A1\u5FC5\u8F6C\u5165\u7CBE\u786E\u91D1\u989D ${e.coinAmount}\uFF08TRC20 \u7F51\u7EDC\uFF09</b><br>
        <span style="font-size:11.5px">\u542B\u4E13\u5C5E\u6821\u9A8C\u5FAE\u5C3E\u6570\uFF0C\u6CE2\u573A\u51FA\u5757\u540E\u81EA\u52A8\u79D2\u7EA7\u5230\u8D26\uFF1B\u7F51\u7EDC\u624B\u7EED\u8D39\u7531\u4E70\u5BB6\u94B1\u5305\u627F\u62C5\uFF08\u4EA4\u6613\u6240\u63D0\u5E01\u8BF7\u5C06\u624B\u7EED\u8D39\u53E6\u52A0\uFF0C\u786E\u4FDD\u5168\u989D\u5230\u8D26\uFF09\u3002</span>
      </div>
      ${e.expireSeconds?'<div id="countdown" style="font-size:12px;color:#ef4444;font-weight:600;margin:-8px 0 14px"></div>':""}
    `:`
      <div class="pay-tip">
        ${e.qr?"\u8BF7\u4F7F\u7528\u624B\u673A"+o+"\u626B\u7801\u652F\u4ED8":"\u8BF7\u5411\u4E0A\u65B9\u8D26\u6237\u5B8C\u6210\u8F6C\u8D26"} <b>\xA5${e.money}</b><br>
        <span style="font-size:11px">\u91D1\u989D\u542B\u4E13\u5C5E\u6821\u9A8C\u5C3E\u6570\uFF0C\u8BF7\u52FF\u4FEE\u6539\u91D1\u989D\uFF0C\u652F\u4ED8\u540E\u81EA\u52A8\u8DF3\u8F6C</span>
      </div>
    `}

    ${e.transferUrl?`<a class="btn-transfer" href="${e.transferUrl}">\u6253\u5F00${o}\uFF08\u91D1\u989D\u5DF2\u586B\u597D\uFF09 \u2192</a>`:""}

    <div>
      <div class="status-pill" id="state">
        <span class="pulse-dot"></span>
        <span>${r?"\u7B49\u5F85\u6CE2\u573A\u94FE\u4E0A\u8F6C\u8D26\u786E\u8BA4\u2026":"\u7B49\u5F85\u626B\u7801\u652F\u4ED8\u4E2D\u2026"}</span>
      </div>
    </div>

    <div class="card-foot">
      <span>\u5546\u6237\uFF1A${e.merchant}</span>
      <span>\u652F\u4ED8\u4E2D\u8BF7\u52FF\u5173\u95ED</span>
    </div>`}
  </div>
</div>

<script src="/assets/vendor/jquery/3.4.1/jquery.min.js?v=1"></script>
<script src="/assets/vendor/jquery.qrcode/1.0/jquery.qrcode.min.js?v=1"></script>
<script>
function copyVal(txt, btn){
  navigator.clipboard.writeText(txt).then(function(){
    var old = btn.innerText;
    btn.innerText = '\u5DF2\u590D\u5236!';
    btn.style.borderColor = '#059669';
    btn.style.color = '#059669';
    setTimeout(function(){ btn.innerText = old; btn.style.borderColor = ''; btn.style.color = ''; }, 1600);
  }).catch(function(){ prompt('\u8BF7\u624B\u52A8\u590D\u5236:', txt); });
}
if(document.getElementById('qrcode')){jQuery('#qrcode').qrcode({width:176,height:176,text:${JSON.stringify(e.qr)}});}

${e.expireSeconds?`
var remainSec = ${Math.max(0,e.expireSeconds)};
function updateCountdown(){
  if(remainSec <= 0){
    document.getElementById('countdown').innerText = '\u8BA2\u5355\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u4E0B\u5355';
    return;
  }
  var m = Math.floor(remainSec / 60);
  var s = remainSec % 60;
  document.getElementById('countdown').innerText = '\u5269\u4F59\u652F\u4ED8\u65F6\u95F4: ' + (m<10?'0':'') + m + ':' + (s<10?'0':'') + s;
  remainSec--;
}
updateCountdown();
setInterval(updateCountdown, 1000);
`:""}

var timer=setInterval(function(){
  jQuery.get('/api/cashier/status?trade_no=${e.tradeNo}',function(r){
    if(r.code===0&&r.status>=1){
      clearInterval(timer);
      var st=jQuery('#state');
      st.addClass('success').html('<span class="pulse-dot"></span><span>\u652F\u4ED8\u6210\u529F\uFF0C\u6B63\u5728\u8DF3\u8F6C\u2026</span>');
      setTimeout(function(){location.href='/payok/${e.tradeNo}';},800);
    }
  });
},2000);
</script></body></html>`}fe();N();fe();He();K();var Zo={id:"vmq",name:"V\u514D\u7B7E\u6302\u673A(\u591A\u7AEF\u76D1\u542C:\u5B89\u5353/\u684C\u9762/\u4E8C\u5F00\u7248)",types:["alipay","wxpay","qqpay","usdt"],inputs:[{name:"key",label:"\u901A\u4FE1\u5BC6\u94A5(\u6302\u673A\u7AEF\u914D\u7F6E)",required:!0},{name:"qrcode_alipay",label:"\u652F\u4ED8\u5B9D\u6536\u6B3E\u7801\u56FE\u7247\u94FE\u63A5"},{name:"qrcode_wxpay",label:"\u5FAE\u4FE1\u6536\u6B3E\u7801\u56FE\u7247\u94FE\u63A5"},{name:"qrcode_qqpay",label:"QQ\u6536\u6B3E\u7801\u56FE\u7247\u94FE\u63A5"},{name:"qrcode_usdt",label:"USDT\u94B1\u5305\u4E8C\u7EF4\u7801\u5185\u5BB9/\u56FE\u7247\u94FE\u63A5"},{name:"pay_suffix",label:"\u5C3E\u6570\u9632\u649E\u5355(1\u5F00, \u9ED8\u8BA4\u5F00, \u540C\u539F\u7248\u91D1\u989D\u9012\u589E)"}],async createOrder(e){let t=e.channel.config,n={alipay:t.qrcode_alipay,wxpay:t.qrcode_wxpay,qqpay:t.qrcode_qqpay,usdt:t.qrcode_usdt}[e.payType]||"",o=await Oe(e.env,e.order,t.pay_suffix!=="0");return{ok:!0,qrContent:n||"",payAmount:o}}};async function ea(e,t,r){let n=await ee("vmq",!0),o=!1;for(let c of n)try{JSON.parse(c.config).key===t&&(o=!0)}catch{}if(!o)return Response.json({code:-1,msg:"key\u9519\u8BEF"});let a=["alipay","wxpay","qqpay","usdt"].includes(r)?r:"alipay",[s]=await V({type:a,channelIds:n.map(c=>c.id),order:"asc",limit:1});if(!s)return Response.json({code:0,msg:"\u6682\u65E0\u8BA2\u5355"});let i=s.pay_amount?String(s.pay_amount):$(s.money);return Response.json({code:1,trade_no:s.trade_no,price:i})}async function ta(e,t,r,n){let o=await ee("vmq",!0),a=!1;for(let d of o)try{JSON.parse(d.config).key===t&&(a=!0)}catch{}if(!a)return{ok:!1,respond:"key\u9519\u8BEF"};let s=await M(r);if(!s)return{ok:!1,respond:"\u8BA2\u5355\u4E0D\u5B58\u5728"};if(s.status!==0)return{ok:!0,respond:"success"};let i=s.money;try{let d=JSON.parse(s.ext||"{}");d.pay_amount&&(i=O(String(d.pay_amount)))}catch{}if(O(n)!==i)return{ok:!1,respond:"\u91D1\u989D\u4E0D\u5339\u914D"};let c=await Q(e,r,s.money,"VMQ"+v());if(c){let d=await M(r);d&&await W(e,d)}return{ok:c,respond:c?"success":"\u5904\u7406\u5931\u8D25"}}K();var it=new B;it.all("/channel/notify/:plugin/:channelId",async e=>{let t=e.req.param("plugin"),r=parseInt(e.req.param("channelId"),10),n=await Re(r);if(!n||n.status!==1||n.plugin!==t)return e.text("fail");let o=Bt(t);if(!o?.onNotify)return e.text("fail");let a={};try{a=JSON.parse(n.config||"{}")}catch{}let s={env:e.env,channel:{id:n.id,plugin:n.plugin,config:a},req:e.req.raw,url:new URL(e.req.url)},i=await o.onNotify(s);if(!i.ok||!i.tradeNo)return e.text(i.respond||"fail");if(await Q(e.env,i.tradeNo,i.money||0,i.apiTradeNo||"")){let d=await M(i.tradeNo);d&&e.executionCtx.waitUntil(W(e.env,d))}return e.text(i.respond)});it.all("/app/vmq/task",async e=>{let t=e.req.query("key")||"",r=e.req.query("type")||"alipay";return ea(e.env,t,r)});it.all("/app/vmq/push",async e=>{let t={};if(new URL(e.req.url).searchParams.forEach((n,o)=>t[o]=n),e.req.method==="POST")try{let n=await e.req.parseBody();for(let o of Object.keys(n))t[o]=String(n[o])}catch{}let r=await ta(e.env,t.key||"",t.trade_no||"",t.price||"");return e.text(r.respond)});N();async function $e(e){let t=crypto.getRandomValues(new Uint8Array(16)),r=await ra(e,t,1e5),n=Array.from(t).map(a=>a.toString(16).padStart(2,"0")).join(""),o=Array.from(r).map(a=>a.toString(16).padStart(2,"0")).join("");return`pbkdf2$100000$${n}$${o}`}async function Gt(e,t){let r=t.split("$");if(r.length!==4||r[0]!=="pbkdf2")return!1;let n=parseInt(r[1],10),o=new Uint8Array(r[2].match(/.{2}/g).map(c=>parseInt(c,16))),a=r[3],s=await ra(e,o,n);return Array.from(s).map(c=>c.toString(16).padStart(2,"0")).join("")===a}async function ra(e,t,r){let n=await crypto.subtle.importKey("raw",new TextEncoder().encode(e),"PBKDF2",!1,["deriveBits"]),o=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:t,iterations:r},n,256);return new Uint8Array(o)}async function na(e,t){let r=await crypto.subtle.importKey("raw",new TextEncoder().encode(e),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),n=await crypto.subtle.sign("HMAC",r,new TextEncoder().encode(t));return Array.from(new Uint8Array(n)).map(o=>o.toString(16).padStart(2,"0")).join("")}async function ct(e,t,r,n=7){let o=e.ADMIN_SECRET||t,a=v()+n*86400,s=`${r.role}.${r.id}.${a}`,i=await na(o,s);return`${s}.${i}`}async function Ge(e,t,r){if(!r)return null;let n=e.ADMIN_SECRET||t,o=r.split(".");if(o.length!==4)return null;let[a,s,i,c]=o;if(await na(n,`${a}.${s}.${i}`)!==c||parseInt(i,10)<v())return null;if(a==="admin")return{role:"admin",id:0};if(a==="user"){let d=parseInt(s,10);return d?{role:"user",id:d,uid:d}:null}return null}function Je(e,t){let r=e.headers.get("Cookie");if(r)for(let n of r.split(";")){let[o,...a]=n.trim().split("=");if(o===t)return a.join("=")}}ce();N();K();var U=new B;async function oa(e,t){let r=await q("syskey")||"";return(await Ge(e,r,Je(t,"epay_session")))?.role==="admin"}var Ds=["/admin/api/login","/admin/api/logout","/admin/api/islogin"];U.use("/api/*",async(e,t)=>{if(Ds.includes(e.req.path))return t();if(!await oa(e.env,e.req.raw))return e.json({code:403,msg:"\u672A\u767B\u5F55"},403);await t()});U.post("/api/login",async e=>{let{username:t,password:r}=await e.req.json(),n=await J(),o=n.login_fail||'{"n":0,"t":0}',a={n:0,t:0};try{a=JSON.parse(o)}catch{}if(a.n>=10&&v()-a.t<600)return e.json({code:-1,msg:"\u5931\u8D25\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF710\u5206\u949F\u540E\u518D\u8BD5"});let s=n.admin_user||"",i=n.admin_pwd||"";if(!s||!i)return e.json({code:-1,msg:"\u7CFB\u7EDF\u672A\u521D\u59CB\u5316"});if(t!==s||!await Gt(r,i)){let l=v()-a.t<600?a.n+1:1;return await Ee("login_fail",JSON.stringify({n:l,t:v()})),e.json({code:-1,msg:"\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF"})}await Ee("login_fail",'{"n":0,"t":0}');let c=n.syskey||"",d=await ct(e.env,c,{role:"admin",id:0});return e.header("Set-Cookie",`epay_session=${d}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`),e.json({code:0})});U.post("/api/logout",e=>(e.header("Set-Cookie","epay_session=; Path=/; HttpOnly; Max-Age=0"),e.json({code:0})));U.get("/api/islogin",async e=>e.json({code:0,login:await oa(e.env,e.req.raw)}));U.get("/api/info",async e=>{let t=_e(bo()),r=await Rr(t),n=await Te();return e.json({code:0,data:{orders_today:r.n,money_today:r.sum,pending:n.pending,users:await Pe(),orders_all:n.orders,settles_pending:await So(),sitename:await q("sitename")||""}})});U.get("/api/orders",async e=>{let t=Math.max(1,parseInt(e.req.query("page")||"1",10)),r=Math.min(100,parseInt(e.req.query("size")||"20",10)),n=e.req.query("status"),o=(e.req.query("q")||"").trim(),a=n===void 0||n===""?null:parseInt(n,10),{list:s,total:i}=await mo({page:t,size:r,status:a,q:o});return e.json({code:0,data:{list:s,total:i}})});U.post("/api/orders/refund",async e=>{let{trade_no:t}=await e.req.json(),r=await Tr(e.env,t);return e.json({code:r.ok?0:-1,msg:r.msg})});U.get("/api/channels",async e=>{let t=await Tt();return e.json({code:0,data:{list:t,plugins:at().map(r=>({id:r.id,name:r.name,types:r.types,inputs:r.inputs,help:r.help}))}})});U.post("/api/channels",async e=>{let t=await e.req.json(),r=at().find(o=>o.id===t.plugin);if(!r)return e.json({code:-1,msg:"\u63D2\u4EF6\u4E0D\u5B58\u5728"});let n={};try{n=typeof t.config=="string"?JSON.parse(t.config):t.config}catch{}for(let o of r.inputs)if(o.required&&!n[o.name])return e.json({code:-1,msg:`${o.label} \u4E0D\u80FD\u4E3A\u7A7A`});return t.paymin!==void 0&&(n.paymin=t.paymin),t.paymax!==void 0&&(n.paymax=t.paymax),await Zn({id:t.id,plugin:t.plugin,name:t.name,status:t.status,config:JSON.stringify(n),types:JSON.stringify(t.types||r.types),weight:t.weight}),e.json({code:0})});U.post("/api/channels/delete",async e=>{let{id:t}=await e.req.json();return await eo(t),e.json({code:0})});U.get("/api/users",async e=>{let t=Math.max(1,parseInt(e.req.query("page")||"1",10)),n=(await Fn((t-1)*20,20)).map(o=>({uid:o.uid,gid:o.gid,username:o.username,email:o.email,key:o.key,money:o.money,status:o.status,regtime:o.regtime,keytype:o.keytype||0,domain:o.domain||"",cert:o.cert||0}));return e.json({code:0,data:{list:n,total:await Pe()}})});U.post("/api/users",async e=>{let t=await e.req.json();if(t.uid){let n={};return t.password&&(n.password=await $e(t.password)),t.status!==void 0&&(n.status=t.status),t.money!==void 0&&(n.money=Math.round(t.money*100)),t.reset_key&&(n.key=oe(32)),t.keytype!==void 0&&(n.keytype=t.keytype),t.publickey!==void 0&&(n.publickey=t.publickey),t.domain!==void 0&&(n.domain=t.domain),t.gid!==void 0&&(n.gid=t.gid),Object.keys(n).length&&await Ce(t.uid,n),e.json({code:0})}if(!t.username||!t.password)return e.json({code:-1,msg:"\u53C2\u6570\u4E0D\u5B8C\u6574"});if(await De(t.username))return e.json({code:-1,msg:"\u7528\u6237\u540D\u5DF2\u5B58\u5728"});try{await Ct({username:t.username,password:await $e(t.password),key:oe(32)})}catch(n){if(String(n).includes("USERNAME_EXISTS"))return e.json({code:-1,msg:"\u7528\u6237\u540D\u5DF2\u5B58\u5728"});throw n}return e.json({code:0})});U.post("/api/users/delete",async e=>{let{uid:t}=await e.req.json();return await Wn(t),e.json({code:0})});U.get("/api/config",async e=>{let t={...await J()};return delete t.admin_pwd,e.json({code:0,data:t})});U.post("/api/config",async e=>{let t=await e.req.json(),r={};for(let n of Object.keys(t))n==="admin_pwd"||n==="login_fail"||n==="admin_user"&&!t[n]||(r[n]=String(t[n]));return Object.keys(r).length&&await St(r),e.json({code:0})});U.get("/api/settles",async e=>{let t=await _o(100);return e.json({code:0,data:t})});U.post("/api/settles/review",async e=>{let{id:t,status:r}=await e.req.json(),n=await ot(t);return n?n.status!==0?e.json({code:-1,msg:"\u5DF2\u5904\u7406"}):(await $t(t,{status:r}),r===2&&(await xe(n.uid,n.amount),await ve(n.uid,3,n.amount,"\u7ED3\u7B97\u9A73\u56DE\u9000\u56DE")),e.json({code:0})):e.json({code:-1,msg:"\u8BB0\u5F55\u4E0D\u5B58\u5728"})});ce();N();K();var X=new B;async function Us(e,t){let r=await q("syskey")||"",n=await Ge(e,r,Je(t,"epay_session"));return n?.role!=="user"?null:await ue(n.uid)}var Ls=["/user/api/register","/user/api/login","/user/api/logout","/user/api/sendcode"];X.use("/api/*",async(e,t)=>{if(Ls.includes(e.req.path))return t();let r=await Us(e.env,e.req.raw);if(!r)return e.json({code:403,msg:"\u672A\u767B\u5F55"},403);e.set("userRow",r),await t()});X.post("/api/register",async e=>{let t=await J();if(t.reg_open!=="1")return e.json({code:-1,msg:"\u5F53\u524D\u672A\u5F00\u653E\u6CE8\u518C"});let{username:r,password:n,email:o,email_code:a,captcha_id:s,captcha_answer:i,invite:c}=await e.req.json();if(!r||!n||n.length<6)return e.json({code:-1,msg:"\u53C2\u6570\u4E0D\u5B8C\u6574\u6216\u5BC6\u7801\u8FC7\u77ED"});if(!/^[a-zA-Z0-9_@.]{3,32}$/.test(r))return e.json({code:-1,msg:"\u7528\u6237\u540D\u683C\u5F0F\u9519\u8BEF"});if(t.captcha_open==="1"){if(!s||!i)return e.json({code:-1,msg:"\u8BF7\u8F93\u5165\u56FE\u5F62\u9A8C\u8BC1\u7801"});let P=await Nt(`cap:${s}`);if(await jt(`cap:${s}`),!P||P.v!==String(i))return e.json({code:-1,msg:"\u56FE\u5F62\u9A8C\u8BC1\u7801\u9519\u8BEF"})}let d="";if(t.email_verify==="1"){if(!o||!a)return e.json({code:-1,msg:"\u8BF7\u8F93\u5165\u90AE\u7BB1\u53CA\u9A8C\u8BC1\u7801"});let P=await Nt(`email:${o}`);if(await jt(`email:${o}`),!P||P.v!==String(a))return e.json({code:-1,msg:"\u90AE\u7BB1\u9A8C\u8BC1\u7801\u9519\u8BEF"});d=o}if(await De(r))return e.json({code:-1,msg:"\u7528\u6237\u540D\u5DF2\u5B58\u5728"});let u=0;if(c){let P=await Jn(c,parseInt(c,10)||0);P&&(u=P.uid)}let b=oe(32),g;try{g=await Ct({username:r,password:await $e(n),key:b,email:d,invite_uid:u})}catch(P){if(String(P).includes("USERNAME_EXISTS"))return e.json({code:-1,msg:"\u7528\u6237\u540D\u5DF2\u5B58\u5728"});throw P}let k=t.syskey||"",C=await ct(e.env,k,{role:"user",id:g,uid:g});return e.header("Set-Cookie",`epay_session=${C}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`),e.json({code:0,data:{uid:g,key:b}})});X.post("/api/login",async e=>{let{username:t,password:r}=await e.req.json(),n=await De(t||"");if(!n||!await Gt(r,n.password))return e.json({code:-1,msg:"\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF"});if(n.status!==1)return e.json({code:-1,msg:"\u8D26\u53F7\u5DF2\u88AB\u7981\u7528"});let o=await q("syskey")||"",a=await ct(e.env,o,{role:"user",id:n.uid,uid:n.uid});return e.header("Set-Cookie",`epay_session=${a}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`),e.json({code:0})});X.post("/api/logout",e=>(e.header("Set-Cookie","epay_session=; Path=/; HttpOnly; Max-Age=0"),e.json({code:0})));X.post("/api/sendcode",async e=>{let t=await J();if(t.email_verify!=="1")return e.json({code:-1,msg:"\u672A\u5F00\u542F\u90AE\u7BB1\u9A8C\u8BC1"});let{email:r}=await e.req.json();if(!r||!/^[^@]+@[^@]+$/.test(r))return e.json({code:-1,msg:"\u90AE\u7BB1\u683C\u5F0F\u9519\u8BEF"});let n=String(Math.floor(Math.random()*9e5)+1e5);await It(`email:${r}`,n,v());let o=t.email_webhook||"";return o&&e.executionCtx.waitUntil(fetch(o,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:r,code:n,subject:"\u6CE8\u518C\u9A8C\u8BC1\u7801"})}).catch(()=>{})),e.json({code:0,msg:"\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001"})});X.get("/api/me",async e=>{let t=e.get("userRow"),r=await Et(t.gid);return e.json({code:0,data:{uid:t.uid,username:t.username,money:(t.money/100).toFixed(2),key:t.key,status:t.status,keytype:t.keytype||0,cert:t.cert||0,gid:t.gid,rate:r?.rate||0,invite_uid:t.invite_uid||0,domain:t.domain||"",email:t.email||""}})});X.get("/api/orders",async e=>{let t=e.get("userRow"),r=Math.max(1,parseInt(e.req.query("page")||"1",10)),{list:n,total:o}=await go(t.uid,r,20),a=n.map(s=>({trade_no:s.trade_no,out_trade_no:s.out_trade_no,type:s.type,name:s.name,money:s.money,status:s.status,addtime:s.addtime,endtime:s.endtime}));return e.json({code:0,data:{list:a,total:o}})});X.get("/api/records",async e=>{let t=e.get("userRow"),n=(await vo(t.uid,50)).map(o=>({type:o.type,money:o.money,addtime:o.addtime,note:o.note}));return e.json({code:0,data:n})});X.post("/api/cert",async e=>{let t=e.get("userRow"),{name:r,idcard:n}=await e.req.json();return!r||!n?e.json({code:-1,msg:"\u8BF7\u586B\u5199\u59D3\u540D\u4E0E\u8BC1\u4EF6\u53F7"}):(await Ce(t.uid,{cert:1,cert_name:r,cert_no:n}),e.json({code:0,msg:"\u5DF2\u63D0\u4EA4, \u7B49\u5F85\u7BA1\u7406\u5458\u5BA1\u6838"}))});X.post("/api/settle",async e=>{let t=e.get("userRow"),{amount:r}=await e.req.json(),n=Math.round(Number(r)*100);return!n||n<=0?e.json({code:-1,msg:"\u91D1\u989D\u9519\u8BEF"}):await xe(t.uid,-n)?(await ko(t.uid,n),await ve(t.uid,3,n,"\u7533\u8BF7\u7ED3\u7B97"),e.json({code:0})):e.json({code:-1,msg:"\u4F59\u989D\u4E0D\u8DB3"})});ce();N();K();fe();K();N();var zs=300;async function aa(e,t,r=zs){if(t)return e!==t?Response.json({code:0,msg:"token \u4E0D\u5339\u914D"},{status:403}):null;let n=Number(await ie("cron_tick_last")||"0");return n&&v()-n<r?Response.json({code:0,msg:`\u672A\u914D\u7F6E CRON_TOKEN\uFF0C\u5DF2\u9650\u6D41\uFF08${r}s \u4E00\u6B21\uFF09`},{status:429}):(await Se("cron_tick_last",String(v())),null)}async function Jt(e){let t=await ho(20),r=0;for(let i of t){let c=await M(i.trade_no);c&&(await W(e,c),r++)}let{pollAllBills:n}=await Promise.resolve().then(()=>(He(),jr)),o=await n(e),{pollAllTronOrders:a}=await Promise.resolve().then(()=>(Kt(),Br)),s=await a(e);return{retried:r,bill_matched:o,tron_matched:s,time:v()}}var Hs="f0293af+dirty ee2be9d5 2026-11-04 13:52:43",Fe=new B;Fe.get("/api/health",async e=>{try{let t=await Gn();return e.json({ok:!0,...t,build:Hs,time:v()})}catch(t){let r=t;return e.json({ok:!1,error:r.message||String(t),hint:r.hint,time:v()},503)}});Fe.post("/install",async e=>{if(await q("admin_user"))return e.json({code:-1,msg:"\u7CFB\u7EDF\u5DF2\u521D\u59CB\u5316"});let{username:r,password:n}=await e.req.json();if(!r||!n||n.length<8)return e.json({code:-1,msg:"\u7528\u6237\u540D/\u5BC6\u7801(\u22658\u4F4D)\u4E0D\u80FD\u4E3A\u7A7A"});let o=lr(32),a=lr(16);return await St({admin_user:r,admin_pwd:await $e(n),syskey:o,sitename:"Epay Pages",reg_open:"1",channel_map:"{}",cron_token:a}),await to(),e.json({code:0,data:{cron_token:a}})});Fe.get("/api/cron",async e=>{let t=await q("cron_token")||"",r=e.req.query("token")||"";return!t||r!==t?e.json({code:-1,msg:"token \u9519\u8BEF"}):e.json({code:0,data:await Jt(e.env)})});Fe.get("/",async e=>{let t=await J(),r=v()-86400,[n,o,a]=await Promise.all([Pe(),Ot(r),Te()]),s={n:o.n},i={s:o.sum},c={n:a.orders},d=b=>(b/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}),l=t.announcement||"",u=t.sitename||"Epay Pages";return e.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${u} - \u6781\u7B80\u805A\u5408\u6536\u6B3E\u5E73\u53F0</title>
<style>
:root{
  --bg:#f8fafc;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --primary:#2563eb;
  --primary-hover:#1d4ed8;
  --primary-light:#eff6ff;
  --accent:#f59e0b;
  --radius:16px;
  --shadow-sm:0 1px 2px rgba(0,0,0,0.04);
  --shadow:0 4px 20px -2px rgba(15,23,42,0.06);
  --shadow-lg:0 20px 30px -6px rgba(15,23,42,0.08);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{text-decoration:none;color:inherit}

/* \u5BFC\u822A */
.nav-wrap{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.nav-box{max-width:1160px;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.nav-brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:var(--text)}
.nav-brand svg{width:28px;height:28px;color:var(--primary)}
.nav-links{display:flex;align-items:center;gap:24px}
.nav-item{font-size:14px;font-weight:500;color:var(--text-muted);transition:color .2s}
.nav-item:hover{color:var(--primary)}
.nav-btn{background:var(--primary);color:#fff;font-size:13px;font-weight:600;padding:8px 18px;border-radius:100px;transition:all .2s;box-shadow:0 2px 8px rgba(37,99,235,0.25)}
.nav-btn:hover{background:var(--primary-hover);transform:translateY(-1px)}

/* \u516C\u544A */
.announce-bar{max-width:1160px;margin:80px auto 0;padding:0 20px}
.announce-inner{background:#fffbeb;border:1px solid #fef3c7;color:#92400e;padding:10px 18px;border-radius:100px;font-size:13px;display:flex;align-items:center;gap:8px}

/* Hero */
.hero{padding:${l?"24px":"100px"} 20px 48px;max-width:1160px;margin:0 auto;text-align:center}
.badge-pill{display:inline-flex;align-items:center;gap:6px;background:var(--primary-light);color:var(--primary);font-size:12px;font-weight:600;padding:6px 14px;border-radius:100px;margin-bottom:20px;border:1px solid rgba(37,99,235,0.15)}
.hero h1{font-size:clamp(32px,5vw,52px);font-weight:800;letter-spacing:-1px;color:var(--text);margin-bottom:18px;line-height:1.2}
.hero h1 span{background:linear-gradient(135deg,#2563eb,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:clamp(15px,2vw,18px);color:var(--text-muted);max-width:680px;margin:0 auto 32px}
.hero-btns{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap}
.btn-main{background:var(--text);color:#fff;padding:13px 28px;border-radius:100px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:8px;transition:all .2s;box-shadow:var(--shadow)}
.btn-main:hover{background:#1e293b;transform:translateY(-2px);box-shadow:var(--shadow-lg)}
.btn-sub{background:var(--surface);color:var(--text);border:1px solid var(--border);padding:13px 26px;border-radius:100px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:8px;transition:all .2s}
.btn-sub:hover{border-color:#cbd5e1;background:#f8fafc;transform:translateY(-2px)}

/* \u5B9E\u65F6\u6570\u636E\u6307\u6807 */
.stats-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);max-width:1040px;margin:0 auto 60px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat-col{text-align:center;padding:10px}
.stat-col:not(:last-child){border-right:1px solid var(--border)}
.stat-val{font-size:26px;font-weight:800;color:var(--text);letter-spacing:-0.5px}
.stat-lbl{font-size:13px;color:var(--text-muted);margin-top:4px}

/* \u677F\u5757\u901A\u7528 */
.section{max-width:1160px;margin:0 auto 80px;padding:0 20px}
.sec-title{text-align:center;margin-bottom:44px}
.sec-title h2{font-size:28px;font-weight:800;letter-spacing:-0.5px;color:var(--text);margin-bottom:8px}
.sec-title p{font-size:15px;color:var(--text-muted)}

/* \u652F\u4ED8\u6E20\u9053 */
.channels-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.channel-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;text-align:center;transition:all .25s ease;box-shadow:var(--shadow-sm)}
.channel-box:hover{transform:translateY(-4px);box-shadow:var(--shadow);border-color:#cbd5e1}
.channel-icon{width:48px;height:48px;border-radius:12px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center}
.channel-name{font-size:16px;font-weight:700;margin-bottom:4px}
.channel-desc{font-size:12px;color:var(--text-muted)}

/* \u7279\u6027\u7F51\u683C */
.features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.feature-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;transition:all .25s ease;box-shadow:var(--shadow-sm)}
.feature-box:hover{transform:translateY(-4px);box-shadow:var(--shadow);border-color:#cbd5e1}
.feat-icon{width:42px;height:42px;border-radius:10px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.feat-icon svg{width:22px;height:22px}
.feature-box h3{font-size:17px;font-weight:700;margin-bottom:8px;color:var(--text)}
.feature-box p{font-size:13px;color:var(--text-muted);line-height:1.7}

/* \u63A5\u5165\u6D41\u7A0B */
.steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.step-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;position:relative;box-shadow:var(--shadow-sm)}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--text);color:#fff;font-size:14px;font-weight:700;margin-bottom:16px}
.step-card h3{font-size:16px;font-weight:700;margin-bottom:8px}
.step-card p{font-size:13px;color:var(--text-muted);line-height:1.7}

/* \u76D1\u63A7\u7AEF */
.dl-card{background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:24px;padding:48px 40px;margin-bottom:60px;box-shadow:var(--shadow-lg)}
.dl-head{margin-bottom:32px}
.dl-head h2{font-size:26px;font-weight:800;margin-bottom:8px}
.dl-head p{font-size:14px;color:#94a3b8}
.dl-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.dl-item{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:22px}
.dl-item h3{font-size:15px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.dl-item p{font-size:12px;color:#94a3b8;line-height:1.7}
.dl-foot{margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#94a3b8}
.dl-foot a{color:#38bdf8}

/* \u9875\u811A */
footer{background:var(--surface);border-top:1px solid var(--border);padding:40px 20px;text-align:center;font-size:13px;color:var(--text-muted)}
.footer-links{display:flex;justify-content:center;gap:24px;margin-bottom:12px}
.footer-links a:hover{color:var(--primary)}

/* \u54CD\u5E94\u5F0F */
@media (max-width:960px){
  .features-grid{grid-template-columns:repeat(2,1fr)}
  .channels-grid{grid-template-columns:repeat(2,1fr)}
  .dl-grid{grid-template-columns:repeat(2,1fr)}
  .stats-card{grid-template-columns:repeat(2,1fr)}
  .stat-col:nth-child(2){border-right:none}
}
@media (max-width:640px){
  .nav-links{display:none}
  .features-grid,.channels-grid,.steps-grid,.dl-grid,.stats-card{grid-template-columns:1fr}
  .stat-col{border-right:none!important;border-bottom:1px solid var(--border)}
  .stat-col:last-child{border-bottom:none}
  .dl-card{padding:32px 20px}
  .dl-foot{flex-direction:column;gap:8px;text-align:center}
}
</style></head><body>

<!-- \u5BFC\u822A -->
<div class="nav-wrap">
  <div class="nav-box">
    <a class="nav-brand" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>${u}</span>
    </a>
    <div class="nav-links">
      <a class="nav-item" href="/#channels">\u652F\u4ED8\u6E20\u9053</a>
      <a class="nav-item" href="/#features">\u670D\u52A1\u4F18\u52BF</a>
      <a class="nav-item" href="/#steps">\u63A5\u5165\u6D41\u7A0B</a>
      <a class="nav-item" href="/doc">\u63A5\u5165\u6587\u6863</a>
      <a class="nav-item" href="/admin.html">\u7BA1\u7406\u540E\u53F0</a>
    </div>
    <a class="nav-btn" href="/user.html">\u5546\u6237\u4E2D\u5FC3</a>
  </div>
</div>

${l?`<div class="announce-bar"><div class="announce-inner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg> <b>\u516C\u544A</b>\uFF1A${l}</div></div>`:""}

<!-- Hero \u4E3B\u6A2A\u5E45 -->
<div class="hero">
  <div class="badge-pill">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    <span>\u65B0\u4E00\u4EE3\u8F7B\u91CF\u805A\u5408\u514D\u7B7E \xB7 \u8D44\u91D1\u76F4\u8FBE</span>
  </div>
  <h1>\u8BA9\u6BCF\u4E00\u7B14\u6536\u6B3E <span>\u7B80\u5355\u76F4\u8FBE</span></h1>
  <p>\u652F\u4ED8\u5B9D / \u5FAE\u4FE1 / QQ / USDT <b>\u4E09\u7F51\u805A\u5408</b> \xB7 \u514D\u7B7E\u7EA6 \xB7 \u5373\u65F6\u5230\u8D26 \xB7 \u514D\u6302\u673A\u514DCK \xB7 \u79D2\u7EA7\u56DE\u8C03</p>
  <div class="hero-btns">
    <a class="btn-main" href="/user.html">\u8FDB\u5165\u5546\u6237\u4E2D\u5FC3 \u2192</a>
    <a class="btn-sub" href="/doc">\u67E5\u770B\u63A5\u5165\u6587\u6863</a>
    <a class="btn-sub" href="/pay/1">\u7801\u724C\u6536\u6B3E\u6F14\u793A</a>
  </div>
</div>

<!-- \u5B9E\u65F6\u6570\u636E -->
<div class="section">
  <div class="stats-card">
    <div class="stat-col"><div class="stat-val">${n}</div><div class="stat-lbl">\u5165\u9A7B\u5546\u6237</div></div>
    <div class="stat-col"><div class="stat-val">${s?.n||0}</div><div class="stat-lbl">\u4ECA\u65E5\u8BA2\u5355</div></div>
    <div class="stat-col"><div class="stat-val">\xA5${d(i?.s||0)}</div><div class="stat-lbl">\u4ECA\u65E5\u6D41\u6C34</div></div>
    <div class="stat-col"><div class="stat-val">${c?.n||0}</div><div class="stat-lbl">\u7D2F\u8BA1\u5904\u7406\u8BA2\u5355</div></div>
  </div>
</div>

<!-- \u652F\u4ED8\u6E20\u9053 -->
<div class="section" id="channels">
  <div class="sec-title">
    <h2>\u652F\u6301\u7684\u652F\u4ED8\u65B9\u5F0F</h2>
    <p>\u591A\u6E20\u9053\u805A\u5408\u5206\u6D41\uFF0C\u8D44\u91D1\u76F4\u63A5\u5230\u8FBE\u60A8\u7684\u4E2A\u4EBA\u8D26\u6237</p>
  </div>
  <div class="channels-grid">
    <div class="channel-box">
      <div class="channel-icon" style="background:#eff6ff;color:#2563eb">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>
      </div>
      <div class="channel-name">\u652F\u4ED8\u5B9D</div>
      <div class="channel-desc">\u5F53\u9762\u4ED8 \xB7 \u5B98\u65B9\u514DCK\u8D26\u5355 \xB7 \u4E2A\u4EBA\u7801</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#f0fdf4;color:#16a34a">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12c-2.76 0-5 1.79-5 4 0 .7.22 1.36.63 1.93L12 20l2.25-.75c.84.48 1.83.75 2.75.75 2.76 0 5-1.79 5-4s-2.24-4-5-4zM9 4C5.69 4 3 6.24 3 9c0 1.54.83 2.92 2.13 3.86L4.5 16l3.19-1.06c.43.04.87.06 1.31.06 3.31 0 6-2.24 6-5s-2.69-5-6-5z"/></svg>
      </div>
      <div class="channel-name">\u5FAE\u4FE1\u652F\u4ED8</div>
      <div class="channel-desc">\u626B\u7801 Native \xB7 \u4E2A\u4EBA\u7801\u76D1\u542C</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#f0f9ff;color:#0284c7">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a9 9 0 0 0-9 9c0 2.2.8 4.2 2.1 5.8L4 21l4.4-1.2A9 9 0 1 0 12 2z"/></svg>
      </div>
      <div class="channel-name">QQ \u94B1\u5305</div>
      <div class="channel-desc">\u514D\u6302\u8D26\u5355\u8F6E\u8BE2 \xB7 OneBot \u534F\u8BAE\u7AEF</div>
    </div>
    <div class="channel-box">
      <div class="channel-icon" style="background:#ecfdf5;color:#059669">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.5h-2v-1h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3v-1h-4V7h2V6h2v1h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3v1h4z"/></svg>
      </div>
      <div class="channel-name">USDT \u6CF0\u8FBE\u5E01</div>
      <div class="channel-desc">TRC20 \u94FE\u4E0A\u5230\u8D26 \xB7 \u96F6\u8D44\u8D28\u9650\u5236</div>
    </div>
  </div>
</div>

<!-- \u670D\u52A1\u4F18\u52BF -->
<div class="section" id="features">
  <div class="sec-title">
    <h2>\u6BD4\u540C\u884C\u66F4\u4F18\u8D28\u7684\u670D\u52A1</h2>
    <p>\u5168\u534F\u8BAE\u8986\u76D6 \xB7 \u6C38\u4E0D\u6389\u7EBF \xB7 \u62D2\u7EDD\u7E41\u7410\u4E2D\u8F6C</p>
  </div>
  <div class="features-grid">
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <h3>\u5373\u65F6\u5230\u8D26\u96F6\u4E2D\u8F6C</h3>
      <p>\u8D44\u91D1\u76F4\u63A5\u5230\u8FBE\u60A8\u7684\u4E2A\u4EBA\u652F\u4ED8\u5B9D/\u5FAE\u4FE1/QQ\u94B1\u5305\u6216\u533A\u5757\u94FE\u5730\u5740\uFF0C\u5E73\u53F0\u4E0D\u6263\u7559\u8D44\u91D1\u3001\u62D2\u7EDD\u8D44\u91D1\u6C60\u8DD1\u8DEF\u98CE\u9669\u3002</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <h3>\u79D2\u7EA7\u5F02\u6B65\u56DE\u8C03</h3>
      <p>\u5230\u8D26\u81EA\u52A8\u89E6\u53D1\u5546\u6237\u7CFB\u7EDF\u901A\u77E5\u4E0E\u6536\u94F6\u53F0\u8DF3\u8F6C\uFF0C\u72B6\u6001\u6BEB\u79D2\u7EA7\u6D41\u8F6C\uFF0C\u9AD8\u5E76\u53D1\u4E8B\u52A1\u9501\u4FDD\u8BC1\u56DE\u8C03\u7EDD\u4E0D\u91CD\u590D\u3002</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg></div>
      <h3>\u514D\u6302\u673A \xB7 \u514DCK</h3>
      <p>\u9996\u521B\u5B98\u65B9 API \u7EA7\u8D26\u5355\u76F4\u8FDE\u6A21\u5F0F\uFF0C\u5F00\u653E\u5E73\u53F0\u5BC6\u94A5\u6C38\u4E0D\u8FC7\u671F\uFF0C\u5F7B\u5E95\u544A\u522B\u9891\u7E41\u6389\u7EBF\u4E0E\u767B\u5F55\u4F1A\u8BDD\u8FC7\u671F\u70E6\u607C\u3002</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg></div>
      <h3>\u6613\u652F\u4ED8\u534F\u8BAE 100% \u517C\u5BB9</h3>
      <p>\u5168\u9762\u517C\u5BB9 submit.php\u3001mapi.php\u3001api.php \u89C4\u8303\u4E0E MD5/RSA \u53CC\u91CD\u7B7E\u540D\u7B97\u6CD5\uFF0C\u5E02\u9762\u6570\u5343\u6B3E CMS \u63D2\u4EF6\u5F00\u7BB1\u5373\u7528\u3002</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg></div>
      <h3>\u667A\u80FD\u8DEF\u7531\u5206\u6D41</h3>
      <p>\u652F\u6301\u6309\u652F\u4ED8\u65B9\u5F0F\u914D\u7F6E\u591A\u901A\u9053\u52A0\u6743\u8F6E\u8BE2\u3001\u6700\u5C0F/\u6700\u5927\u4EA4\u6613\u91D1\u989D\u8FC7\u6EE4\uFF0C\u81EA\u52A8\u7194\u65AD\u5F02\u5E38\u6E20\u9053\uFF0C\u4E1A\u52A1\u575A\u5982\u78D0\u77F3\u3002</p>
    </div>
    <div class="feature-box">
      <div class="feat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <h3>\u98CE\u63A7\u4E0E\u5206\u9500\u751F\u6001</h3>
      <p>\u5185\u7F6E IP \u9ED1\u540D\u5355\u3001\u5168\u7403\u5730\u533A\u5C01\u7981\u3001\u57DF\u540D\u6388\u6743\u767D\u540D\u5355\u3001\u5B9E\u540D\u5236\u51C6\u5165\u3001\u9636\u68AF\u5546\u6237\u8D39\u7387\u4E0E\u591A\u7EA7\u9080\u8BF7\u5206\u6210\u88C2\u53D8\u3002</p>
    </div>
  </div>
</div>

<!-- \u63A5\u5165\u6B65\u9AA4 -->
<div class="section" id="steps">
  <div class="sec-title">
    <h2>\u5341\u5206\u949F\u8F7B\u677E\u4E0A\u7EBF</h2>
    <p>\u7B80\u5355\u4E09\u6B65\uFF0C\u544A\u522B\u7E41\u5197\u7533\u8BF7\u6D41\u7A0B</p>
  </div>
  <div class="steps-grid">
    <div class="step-card">
      <div class="step-num">1</div>
      <h3>\u5F00\u901A\u5546\u6237\u51ED\u636E</h3>
      <p>\u8FDB\u5165\u5546\u6237\u4E2D\u5FC3\u6CE8\u518C\u6216\u7531\u7CFB\u7EDF\u7BA1\u7406\u5458\u4E3A\u60A8\u5206\u914D\u5546\u6237\u53F7\uFF0C\u5373\u53EF\u83B7\u5F97\u4E13\u5C5E\u5546\u6237 PID \u4E0E 32 \u4F4D\u901A\u4FE1\u7B7E\u540D\u79C1\u94A5\u3002</p>
    </div>
    <div class="step-card">
      <div class="step-num">2</div>
      <h3>\u914D\u7F6E\u6536\u6B3E\u901A\u9053</h3>
      <p>\u5728\u540E\u53F0\u7ED1\u5B9A\u60A8\u7684\u6536\u6B3E\u7801\u3001\u5F00\u653E\u5E73\u53F0\u5BC6\u94A5\u6216\u4E0A\u6E38\u901A\u9053\uFF0C\u53EF\u89C6\u5316\u70B9\u51FB\u201C\u6DFB\u52A0\u6620\u5C04\u201D\u5173\u8054\u652F\u4ED8\u65B9\u5F0F\uFF0C\u65E0\u9700\u5199\u4EE3\u7801\u3002</p>
    </div>
    <div class="step-card">
      <div class="step-num">3</div>
      <h3>\u63D2\u4EF6\u914D\u7F6E\u6216\u76F4\u8FDE</h3>
      <p>\u5728\u60A8\u7684\u7F51\u5E97\u3001\u53D1\u5361\u7AD9\u6216\u4F1A\u5458\u7CFB\u7EDF\u540E\u53F0\u586B\u5165\u4E09\u4EF6\u5957\u53C2\u6570\uFF0C\u6216\u76F4\u63A5\u751F\u6210\u7801\u724C\u94FE\u63A5\u5206\u4EAB\u7ED9\u4E70\u5BB6\u5373\u53EF\u5B8C\u6210\u4EA4\u6613\u3002</p>
    </div>
  </div>
</div>

<!-- \u76D1\u63A7\u7AEF\u4E0B\u8F7D -->
<div class="section">
  <div class="dl-card">
    <div class="dl-head">
      <h2>\u591A\u7AEF\u751F\u6001 \xB7 \u76D1\u63A7\u7AEF\u4E0B\u8F7D</h2>
      <p>\u9488\u5BF9\u4E2A\u4EBA\u7801\u6A21\u5F0F\uFF0C\u8986\u76D6\u6240\u6709\u4E3B\u6D41\u5E73\u53F0\u7684\u76D1\u542C\u5BA2\u6237\u7AEF\uFF1BQQ\u4E0E\u652F\u4ED8\u5B9D\u66F4\u652F\u6301\u4E91\u7AEF\u514D\u6302\u3002</p>
    </div>
    <div class="dl-grid">
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
          \u5B89\u5353\u539F\u751F\u76D1\u63A7 App
        </h3>
        <p>\u57FA\u4E8E\u6700\u65B0 Android SDK \u539F\u751F\u5F00\u53D1\uFF0C\u76D1\u542C\u7CFB\u7EDF\u901A\u77E5\u680F\u4E0E\u65E0\u969C\u788D\u5230\u8D26\u5E7F\u64AD\uFF0CGitHub Actions \u81EA\u52A8\u4E91\u7AEF\u6784\u5EFA APK\u3002</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
          Win / Mac / Linux
        </h3>
        <p>Python \u8DE8\u5E73\u53F0\u5E38\u9A7B\u5B88\u62A4\u7AEF\uFF0C\u652F\u6301 Windows \u6D88\u606F\u5E93\u6293\u53D6\u3001macOS \u901A\u77E5\u4E2D\u5FC3\u3001Linux D-Bus \u5E7F\u64AD\u4E0E\u8D26\u5355\u8F6E\u8BE2\u53CC\u6E90\u3002</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a9 9 0 0 0-9 9c0 2.2.8 4.2 2.1 5.8L4 21l4.4-1.2A9 9 0 1 0 12 2z"/></svg>
          OneBot \u534F\u8BAE\u7AEF (QQ)
        </h3>
        <p>\u65E0\u7F1D\u652F\u6301 NapCat / LLOneBot \u673A\u5668\u4EBA\u6846\u67B6\u901A\u8FC7 HTTP \u56DE\u8C03\u76F4\u8FDE\u7CFB\u7EDF\uFF0C\u670D\u52A1\u5668\u7AEF\u76D1\u542C QQ \u94B1\u5305\u5230\u8D26\uFF0C\u5F7B\u5E95\u514D\u624B\u673A\u6302\u673A\u3002</p>
      </div>
      <div class="dl-item">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          \u514DCK \u4E91\u7AEF\u8F6E\u8BE2
        </h3>
        <p>\u9488\u5BF9\u652F\u4ED8\u5B9D\u4E0E QQ \u94B1\u5305\uFF0C\u76F4\u63A5\u91C7\u7528\u670D\u52A1\u5668\u4E91\u7AEF\u5B9A\u65F6\u4EFB\u52A1\u8F6E\u8BE2\u5BF9\u8D26\uFF0C\u624B\u673A\u65E0\u9700\u5B89\u88C5\u4EFB\u4F55 App\uFF0C\u5168\u81EA\u52A8\u5316\u786E\u8BA4\u3002</p>
      </div>
    </div>
    <div class="dl-foot">
      <span>\u5F00\u6E90\u900F\u660E \xB7 \u675C\u7EDD\u4E00\u5207\u6076\u610F\u540E\u95E8\u4E0E\u540E\u95E8\u6CE8\u5165</span>
      <a href="https://github.com/hackerxiaow/epay-pages" target="_blank">\u67E5\u770B GitHub \u6E90\u7801\u4ED3\u5E93 \u2192</a>
    </div>
  </div>
</div>

<footer>
  <div class="footer-links">
    <a href="/doc">\u63A5\u5165\u6587\u6863</a>
    <a href="/user.html">\u5546\u6237\u4E2D\u5FC3</a>
    <a href="/admin.html">\u7BA1\u7406\u540E\u53F0</a>
    <a href="/pay/1">\u7801\u724C\u6536\u6B3E</a>
  </div>
  <p>\xA9 ${u} \xB7 \u57FA\u4E8E EdgeOne Pages + Blob \u6784\u5EFA\u7684\u65B0\u4E00\u4EE3\u53BB\u4E2D\u5FC3\u5316\u6536\u6B3E\u7F51\u5173</p>
</footer>

</body></html>`)});pe();N();var sa={id:"epay",name:"\u6613\u652F\u4ED8\u4E0A\u6E38",types:["alipay","wxpay","qqpay","usdt"],inputs:[{name:"url",label:"\u4E0A\u6E38\u5730\u5740(\u542B http, \u652F\u6301\u6613\u652F\u4ED8/\u7801\u652F\u4ED8\u5E73\u53F0)",required:!0},{name:"pid",label:"\u4E0A\u6E38\u5546\u6237ID",required:!0},{name:"key",label:"\u4E0A\u6E38\u5546\u6237\u5BC6\u94A5",required:!0},{name:"api_mode",label:"\u63A5\u53E3\u6A21\u5F0F: mapi=\u63A5\u53E3\u4E0B\u5355(\u9ED8\u8BA4) / submit=\u7F51\u9875\u8DF3\u8F6C"}],async createOrder(e){let{url:t,pid:r,key:n}=e.channel.config;if(!t||!r||!n)return{ok:!1,msg:"\u6E20\u9053\u914D\u7F6E\u4E0D\u5B8C\u6574"};let o=`${e.siteUrl}/channel/notify/epay/${e.channel.id}`,a=`${e.siteUrl}/payok/${e.order.trade_no}`,s={pid:r,type:e.payType==="usdt"?"alipay":e.payType,out_trade_no:e.order.trade_no,notify_url:o,return_url:a,name:e.order.name||"\u8BA2\u5355",money:$(e.order.money)},i=qt(s,n),c=new URLSearchParams({...s,sign:i,sign_type:"MD5"}),d=t.replace(/\/+$/,"");if((e.channel.config.api_mode||"mapi")==="submit")return{ok:!0,payUrl:`${d}/submit.php?${c.toString()}`};let u;try{u=await fetch(`${d}/mapi.php`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:c.toString()})}catch{return{ok:!1,msg:"\u4E0A\u6E38\u8FDE\u63A5\u5931\u8D25"}}let b=await u.text(),g;try{g=JSON.parse(b)}catch{return{ok:!0,payUrl:`${d}/submit.php?${c.toString()}`}}if(g.code!==1)return{ok:!1,msg:String(g.msg||"\u4E0A\u6E38\u4E0B\u5355\u5931\u8D25")};let k=String(g.payurl||g.url||""),C=String(g.qrcode||g.img||"");return{ok:!0,payUrl:k||void 0,qrContent:C||void 0}},async onNotify(e){let t=e.url,r=e.channel.config.key,n={};return t.searchParams.forEach((o,a)=>n[a]=o),Eo(n,r,n.sign)?n.trade_status!=="TRADE_SUCCESS"?{ok:!1,respond:"ignore"}:{ok:!0,respond:"success",tradeNo:n.out_trade_no,money:O(n.money),apiTradeNo:n.trade_no||""}:{ok:!1,respond:"sign error"}}};pe();N();function ia(e,t){let r=Object.keys(e).filter(n=>n!=="signature"&&e[n]!==void 0&&e[n]!==null&&String(e[n])!=="").sort().map(n=>`${n}=${e[n]}`).join("&");return(0,D.default)(r+t)}function ca(e){return e==null?"":String(e)}var da={id:"bepusdt",name:"BEpusdt(\u52A0\u5BC6\u8D27\u5E01)",types:["usdt"],inputs:[{name:"url",label:"BEpusdt \u670D\u52A1\u5730\u5740",required:!0,placeholder:"https://pay.\u4F60\u7684\u57DF\u540D.com",hint:"\u4F60\u81EA\u5DF1\u90E8\u7F72\u7684 BEpusdt \u7AD9\u70B9\u5730\u5740\uFF0C\u5E26 https://\uFF0C\u7ED3\u5C3E\u4E0D\u8981\u52A0\u659C\u6760"},{name:"auth",label:"API \u5BF9\u63A5\u4EE4\u724C (Auth Key)",required:!0,multiline:!0,hint:"BEpusdt \u540E\u53F0 \u2192 \u7CFB\u7EDF\u7BA1\u7406 \u2192 \u57FA\u672C\u8BBE\u7F6E \u2192 API \u8BBE\u7F6E \u2192 \u5BF9\u63A5\u4EE4\u724C"},{name:"trade_type",label:"\u6536\u6B3E\u7F51\u7EDC (\u53EF\u7559\u7A7A)",placeholder:"usdt.trc20",hint:"\u7559\u7A7A = usdt.trc20(TRC20)\u3002\u4E5F\u53EF\u586B usdt.erc20 / tron.trx / usdc.polygon \u7B49"},{name:"fiat",label:"\u8BA1\u4EF7\u6CD5\u5E01 (\u53EF\u7559\u7A7A)",placeholder:"CNY",hint:"\u7559\u7A7A = CNY\uFF0C\u672C\u7AD9\u6309\u4EBA\u6C11\u5E01\u91D1\u989D\u63D0\u4EA4\uFF0C\u7531\u4E0A\u6E38\u6309\u5B9E\u65F6\u6C47\u7387\u6298\u7B97\u6210\u5E01"}],help:["BEpusdt \u662F\u5F00\u6E90\u52A0\u5BC6\u8D27\u5E01\u6536\u6B3E\u7F51\u5173\uFF0C\u9700\u8981\u81EA\u5DF1\u90E8\u7F72\u4E00\u4EFD\uFF08\u6CA1\u6709\u516C\u5171\u670D\u52A1\u5668\u80FD\u76F4\u63A5\u501F\u7528\uFF09\u3002","\u2460 \u90E8\u7F72\uFF1A\u670D\u52A1\u5668\u6267\u884C <code>docker run -d --name bepusdt -p 8000:8000 -v /root/bepusdt:/data v03413/bepusdt:latest</code>","\u2461 \u6253\u5F00 <code>http://\u670D\u52A1\u5668IP:8000</code> \u521D\u59CB\u5316\u7BA1\u7406\u5458\uFF0C\u5728\u300C\u94B1\u5305\u7BA1\u7406\u300D\u91CC\u6DFB\u52A0\u4F60\u7684\u6536\u6B3E\u5730\u5740\uFF08TRC20 \u7B49\uFF09\u3002","\u2462 \u8FDB\u300C\u7CFB\u7EDF\u7BA1\u7406 \u2192 \u57FA\u672C\u8BBE\u7F6E \u2192 API \u8BBE\u7F6E\u300D\uFF0C\u590D\u5236\u300C\u5BF9\u63A5\u4EE4\u724C\u300D\u586B\u5230\u4E0A\u9762\u7684 Auth Key\u3002","\u2463 \u6709\u57DF\u540D/HTTPS \u5C31\u628A\u57DF\u540D\u586B\u8FDB\u300C\u670D\u52A1\u5730\u5740\u300D\uFF1B\u4E70\u5BB6\u4ED8 USDT\u3001\u94FE\u4E0A\u786E\u8BA4\u540E\u672C\u7AD9\u81EA\u52A8\u5230\u8D26\uFF0C\u65E0\u9700\u6302\u673A\u3002"],async createOrder(e){let t=e.channel.config,r=(t.url||"").trim().replace(/\/+$/,""),n=(t.auth||"").trim();if(!r||!n)return{ok:!1,msg:"\u6E20\u9053\u914D\u7F6E\u4E0D\u5B8C\u6574: \u9700\u586B BEpusdt \u670D\u52A1\u5730\u5740\u4E0E API \u5BF9\u63A5\u4EE4\u724C"};let o={order_id:e.order.trade_no,amount:Number($(e.order.money)),notify_url:`${e.siteUrl}/channel/notify/bepusdt/${e.channel.id}`,redirect_url:`${e.siteUrl}/payok/${e.order.trade_no}`,fiat:(t.fiat||"CNY").trim().toUpperCase(),trade_type:(t.trade_type||"usdt.trc20").trim()};e.order.name&&(o.name=e.order.name),o.signature=ia(o,n);let a;try{a=await fetch(`${r}/api/v1/order/create-transaction`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)})}catch{return{ok:!1,msg:"BEpusdt \u8FDE\u63A5\u5931\u8D25, \u8BF7\u68C0\u67E5\u670D\u52A1\u5730\u5740\u662F\u5426\u53EF\u8BBF\u95EE"}}let s=await a.json().catch(()=>null);if(!s)return{ok:!1,msg:"BEpusdt \u8FD4\u56DE\u4E86\u975E JSON \u54CD\u5E94, \u8BF7\u786E\u8BA4\u670D\u52A1\u5730\u5740\u586B\u7684\u662F BEpusdt \u7AD9\u70B9"};if(Number(s.status_code)!==200)return{ok:!1,msg:String(s.message||"BEpusdt \u4E0B\u5355\u5931\u8D25")};let i=s.data||{},c=String(i.payment_url||"");return c?{ok:!0,payUrl:c,qrContent:c}:{ok:!1,msg:"BEpusdt \u672A\u8FD4\u56DE\u6536\u94F6\u53F0\u5730\u5740"}},async onNotify(e){let t=e.channel.config.auth,r={};if((e.req.headers.get("content-type")||"").includes("json")){let a=await e.req.json().catch(()=>({}));for(let s of Object.keys(a))r[s]=ca(a[s])}else(await e.req.formData().catch(()=>new FormData)).forEach((s,i)=>r[i]=ca(s));let o=r.signature||r.sign||"";return delete r.signature,delete r.sign,!o||ia(r,t)!==o?{ok:!1,respond:"sign error"}:Number(r.status)!==2?{ok:!0,respond:"success"}:{ok:!0,respond:"success",tradeNo:r.order_id||r.trade_id,money:O(r.amount||""),apiTradeNo:r.trade_id||r.block_transaction_id||""}}};pe();N();var la={id:"xorpay",name:"XorPay(\u514D\u6302\u673A\u805A\u5408)",types:["alipay","wxpay"],inputs:[{name:"appid",label:"AppID",required:!0},{name:"secret",label:"AppSecret",required:!0},{name:"shopname",label:"\u5546\u5E97\u540D"}],async createOrder(e){let{appid:t,secret:r,shopname:n}=e.channel.config;if(!t||!r)return{ok:!1,msg:"\u6E20\u9053\u914D\u7F6E\u4E0D\u5B8C\u6574"};let o=e.payType==="wxpay"?"wxpay":"alipay",a=(e.order.name||n||"\u8BA2\u5355").slice(0,30),s=$(e.order.money),i=e.order.trade_no,c=`${e.siteUrl}/channel/notify/xorpay/${e.channel.id}`,d=`${e.siteUrl}/channel/notify/xorpay/${e.channel.id}`,l=(0,D.default)(`${a}${o}${s}${i}${c}${r}`),u;try{u=await fetch("https://pay.xorpay.com/api/pay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:a,pay_type:o,price:s,out_trade_no:i,notify_url:d,callback_url:c,app_id:t,sign:l})})}catch{return{ok:!1,msg:"XorPay \u8FDE\u63A5\u5931\u8D25"}}let b=await u.json().catch(()=>null);if(!b||b.code!==1)return{ok:!1,msg:String(b?.msg||"XorPay \u4E0B\u5355\u5931\u8D25")};let g=b.data||{};return{ok:!0,payUrl:String(g.pay_url||"")||void 0,qrContent:String(g.qr_img||"")||void 0}},async onNotify(e){let t=e.channel.config.secret,r=await e.req.json().catch(()=>({})),n={};for(let a of Object.keys(r))n[a]=String(r[a]);return(0,D.default)(`${n.pay_price}${n.out_trade_no}${n.order_id}${t}`)!==n.hash?{ok:!1,respond:"sign error"}:n.status!=="success"?{ok:!1,respond:"ignore"}:{ok:!0,respond:"success",tradeNo:n.out_trade_no,money:O(n.pay_price),apiTradeNo:n.order_id||""}}};zt();pe();N();function Ur(e,t){let r=Object.keys(e).filter(n=>n!=="sign"&&e[n]!==void 0&&e[n]!=="").sort().map(n=>`${n}=${e[n]}`).join("&");return(0,D.default)(r+"&key="+t).toUpperCase()}function Ks(e){return"<xml>"+Object.keys(e).map(t=>`<${t}><![CDATA[${e[t]}]]></${t}>`).join("")+"</xml>"}function ua(e){let t={},r=/<([a-zA-Z0-9_]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g,n;for(;n=r.exec(e);)t[n[1]]=n[2];if(Object.keys(t).length===0){let o=/<([a-zA-Z0-9_]+)>([^<]+)<\/\1>/g;for(;n=o.exec(e);)t[n[1]]=n[2]}return t}function pa(e){return JSON.parse(e||"{}")}var fa={id:"wxpaynative",name:"\u5FAE\u4FE1\u626B\u7801\u652F\u4ED8(\u5B98\u65B9V2)",types:["wxpay"],inputs:[{name:"appid",label:"\u516C\u4F17\u53F7/\u5E94\u7528 AppID",required:!0},{name:"mchid",label:"\u5FAE\u4FE1\u652F\u4ED8\u5546\u6237\u53F7",required:!0},{name:"key",label:"\u5546\u6237API\u5BC6\u94A5(32\u4F4D)",required:!0},{name:"api_base",label:"API\u5730\u5740(\u7559\u7A7A\u7528\u5B98\u65B9, \u6D4B\u8BD5\u53EF\u8986\u76D6)"},{name:"paymin",label:"\u5355\u7B14\u6700\u4F4E(\u5143)"},{name:"paymax",label:"\u5355\u7B14\u6700\u9AD8(\u5143)"}],async createOrder(e){let t=pa(JSON.stringify(e.channel.config));if(!t.appid||!t.mchid||!t.key)return{ok:!1,msg:"\u6E20\u9053\u914D\u7F6E\u4E0D\u5B8C\u6574"};let r={appid:t.appid,mch_id:t.mchid,nonce_str:oe(32),body:(e.order.name||"\u8BA2\u5355").slice(0,60),out_trade_no:e.order.trade_no,total_fee:String(e.order.money),spbill_create_ip:e.order.ip||"127.0.0.1",notify_url:`${e.siteUrl}/channel/notify/wxpaynative/${e.channel.id}`,trade_type:"NATIVE"};r.sign=Ur(r,t.key);let n=(t.api_base||"https://api.mch.weixin.qq.com").replace(/\/+$/,""),o;try{o=await fetch(`${n}/pay/unifiedorder`,{method:"POST",headers:{"Content-Type":"text/xml; charset=utf-8"},body:Ks(r)})}catch{return{ok:!1,msg:"\u5FAE\u4FE1\u652F\u4ED8\u8FDE\u63A5\u5931\u8D25"}}let a=ua(await o.text());if(a.return_code!=="SUCCESS"||a.result_code!=="SUCCESS")return{ok:!1,msg:String(a.err_code_des||a.return_msg||"\u5FAE\u4FE1\u4E0B\u5355\u5931\u8D25")};let s=Ur(a,t.key);if(a.sign&&s!==a.sign)return{ok:!1,msg:"\u5FAE\u4FE1\u54CD\u5E94\u9A8C\u7B7E\u5931\u8D25"};let i=a.code_url||"";return i?{ok:!0,qrContent:i}:{ok:!1,msg:"\u5FAE\u4FE1\u672A\u8FD4\u56DE\u4E8C\u7EF4\u7801\u94FE\u63A5"}},async onNotify(e){let t=pa(JSON.stringify(e.channel.config)),r=await e.req.text(),n=ua(r),o=Ur(n,t.key);return!n.sign||o!==n.sign?{ok:!1,respond:"<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[sign error]]></return_msg></xml>"}:n.return_code!=="SUCCESS"||n.result_code!=="SUCCESS"?{ok:!1,respond:"<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>"}:{ok:!0,respond:"<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>",tradeNo:n.out_trade_no,money:parseInt(n.total_fee||"0",10),apiTradeNo:n.transaction_id||""}}};He();var ma={id:"alipaybill",name:"\u652F\u4ED8\u5B9D\u4E2A\u4EBA\u7801(\u8D26\u5355\u8F6E\u8BE2\xB7\u514D\u6302\u673A/\u514DCK)",types:["alipay"],inputs:[{name:"appid",label:"\u5F00\u653E\u5E73\u53F0APPID(20\u5F00\u5934, \u586B\u4E86\u5373\u514DCK\u6A21\u5F0F, \u63A8\u8350)",required:!1},{name:"private_key",label:"\u5E94\u7528\u79C1\u94A5(\u514DCK\u6A21\u5F0F)",multiline:!0},{name:"alipay_public_key",label:"\u652F\u4ED8\u5B9D\u516C\u94A5(\u514DCK\u6A21\u5F0F)",multiline:!0},{name:"gateway",label:"\u7F51\u5173(\u7559\u7A7A\u7528\u5B98\u65B9, \u6D4B\u8BD5\u53EF\u8986\u76D6)"},{name:"cookie",label:"\u7F51\u9875Cookie(\u65E7\u65B9\u6848, \u514DCK\u4E0D\u586B)"},{name:"bill_url",label:"Cookie\u6A21\u5F0F\u8D26\u5355\u63A5\u53E3\u5730\u5740(\u7559\u7A7A\u7528\u9ED8\u8BA4)"},{name:"user_id",label:"\u652F\u4ED8\u5B9D\u7528\u6237ID(PID, 2088\u5F00\u5934, \u7528\u4E8E\u514D\u8F93\u91D1\u989D\u8F6C\u8D26)"},{name:"qrcode_alipay",label:"\u4E2A\u4EBA\u6536\u6B3E\u7801\u56FE\u7247\u94FE\u63A5"},{name:"pay_suffix",label:"\u5C3E\u6570\u9632\u649E\u5355(1\u5F00, \u9ED8\u8BA4\u5F00)"}],async createOrder(e){let t=JSON.parse(JSON.stringify(e.channel.config)),r=await Oe(e.env,e.order,t.pay_suffix!=="0"),n="";return t.user_id&&(n=`alipays://platformapi/startapp?appId=20000123&actionType=toAccount&userId=${encodeURIComponent(t.user_id)}&amount=${encodeURIComponent(r)}&memo=${encodeURIComponent(e.order.trade_no)}`),{ok:!0,qrContent:t.qrcode_alipay||"",payAmount:r,transferUrl:n}}};He();var ga={id:"qqbill",name:"QQ\u94B1\u5305\u4E2A\u4EBA\u7801(\u8D26\u5355\u8F6E\u8BE2\xB7\u514D\u6302)",types:["qqpay"],inputs:[{name:"cookie",label:"QQ\u94B1\u5305\u8D26\u5355\u9875Cookie(\u6293\u5305\u83B7\u53D6)",required:!0,multiline:!0},{name:"bill_url",label:"QQ\u94B1\u5305\u8D26\u5355\u63A5\u53E3\u5730\u5740(\u6293\u5305\u83B7\u53D6)",required:!0},{name:"qrcode_qqpay",label:"QQ\u6536\u6B3E\u7801\u56FE\u7247\u94FE\u63A5"},{name:"pay_suffix",label:"\u5C3E\u6570\u9632\u649E\u5355(1\u5F00, \u9ED8\u8BA4\u5F00)"}],async createOrder(e){let t=JSON.parse(JSON.stringify(e.channel.config)),r=await Oe(e.env,e.order,t.pay_suffix!=="0");return{ok:!0,qrContent:t.qrcode_qqpay||t.qrcode||"",payAmount:r}}};Kt();N();var ha={id:"tronusdt",name:"\u539F\u751FUSDT(TRC20\u94FE\u4E0A\u67E5\u8D26\xB7\u96F6\u670D\u52A1\u5668\u514D\u6302)",types:["usdt"],inputs:[{name:"address",label:"TRC20 \u6536\u6B3E\u94B1\u5305\u5730\u5740",required:!0,placeholder:"T \u5F00\u5934\u7684\u6CE2\u573A\u94B1\u5305\u5730\u5740 (\u4EA4\u6613\u6240\u5145\u5E01\u5730\u5740\u6216\u51B7/\u70ED\u94B1\u5305\u5747\u53EF)",hint:"\u4F60\u7684 TRC20 \u6536\u6B3E\u5730\u5740\u3002\u8D44\u91D1\u76F4\u63A5\u5230\u4F60\u7684\u94B1\u5305\uFF0C\u65E0\u4EFB\u4F55\u4E2D\u95F4\u5546\u3002"},{name:"rate",label:"USDT/CNY \u6C47\u7387\u8BBE\u7F6E",placeholder:"auto \u6216\u56FA\u5B9A\u6570\u5B57 (\u5982 7.30)",hint:"\u7559\u7A7A\u6216\u586B auto = \u81EA\u52A8\u62C9\u53D6\u5B9E\u65F6\u884C\u60C5\uFF1B\u4E5F\u53EF\u4EE5\u586B\u56FA\u5B9A\u6C47\u7387\u5982 7.35\u3002"},{name:"timeout",label:"\u8BA2\u5355\u6709\u6548\u671F (\u5206\u949F)",placeholder:"15",hint:"\u9ED8\u8BA4 15 \u5206\u949F\u3002\u8D85\u65F6\u672A\u4ED8\u6B3E\u5C06\u91CA\u653E\u8BE5\u7B14\u9632\u649E\u5355\u5FAE\u5C3E\u6570\u3002"},{name:"trongrid_key",label:"TronGrid API Key (\u53EF\u9009 \xB7 99%\u7528\u6237\u76F4\u63A5\u7559\u7A7A)",placeholder:"\u7559\u7A7A\u5373\u53EF\uFF01\u4F7F\u7528\u5B98\u65B9\u516C\u5171\u8282\u70B9",hint:"\u975E\u5FC5\u586B\uFF01\u65E5\u5E38\u4F7F\u7528\u76F4\u63A5\u7559\u7A7A\u5373\u53EF\uFF0C\u6CE2\u573A\u5B98\u65B9\u516C\u5171\u8282\u70B9\u5B8C\u5168\u591F\u7528\u3002\u5355\u65E5\u51E0\u4E07\u5355\u7684\u9AD8\u9891\u5546\u6237\u624D\u5EFA\u8BAE\u53BB trongrid.io \u514D\u8D39\u6CE8\u518C\u7533\u8BF7\u3002"},{name:"api_base",label:"\u81EA\u5B9A\u4E49 API \u8282\u70B9 (\u53EF\u9009 \xB7 99%\u7528\u6237\u76F4\u63A5\u7559\u7A7A)",placeholder:"\u7559\u7A7A\u5373\u53EF\uFF01\u9ED8\u8BA4\u76F4\u8FDE\u6CE2\u573A\u4E3B\u7F51 https://api.trongrid.io",hint:"\u975E\u5FC5\u586B\uFF01\u7559\u7A7A\u81EA\u52A8\u76F4\u8FDE\u6CE2\u573A\u5B98\u65B9\u8282\u70B9\u3002\u53EA\u6709\u81EA\u5EFA\u6CE2\u573A\u5168\u8282\u70B9\u6216\u4E13\u7EBF\u53CD\u4EE3\u65F6\u624D\u9700\u8981\u586B\u3002"}],help:["\u8FD9\u662F\u7EAF\u5185\u7F6E\u7684\u539F\u751F\u94FE\u4E0A\u67E5\u8D26\u5F15\u64CE\uFF0C\u8FD0\u884C\u5728 Cloudflare \u5168\u7403\u8FB9\u7F18\u8282\u70B9\u4E0A\uFF0C\u4E0D\u9700\u8981\u642D\u5EFA\u4EFB\u4F55\u670D\u52A1\u5668\uFF0C\u4E5F\u4E0D\u9700\u8981\u8FD0\u884C\u6302\u673A\u8F6F\u4EF6\uFF01","\u2460 \u4F60\u53EA\u9700\u63D0\u4F9B\u4E00\u4E2A\u6CE2\u573A\u94B1\u5305\u5730\u5740\uFF08T\u5F00\u5934\uFF0C\u652F\u6301 imToken\u3001TronLink\u3001OKX Web3 \u94B1\u5305\uFF0C\u6216\u8005\u5404\u5927\u4EA4\u6613\u6240\u7684 TRC20 \u5145\u5E01\u5730\u5740\uFF09\u3002","\u2461 \u4E70\u5BB6\u5728\u6536\u94F6\u53F0\u4F1A\u770B\u5230\u5E26\u5FAE\u5C3E\u6570\u7684\u7CBE\u786E\u8F6C\u8D26\u91D1\u989D\uFF08\u4F8B\u5982 13.6942 USDT\uFF09\u548C\u4F60\u7684\u6536\u6B3E\u5730\u5740\u3002","\u2462 \u4E70\u5BB6\u8F6C\u8D26\u540E\uFF0C\u8FB9\u7F18\u51FD\u6570\u76F4\u8FDE\u6CE2\u573A\u8282\u70B9\u76D1\u542C\u5165\u8D26\uFF0C\u94FE\u4E0A\u51FA\u5757\u786E\u8BA4\u540E\uFF08\u901A\u5E38 5~15 \u79D2\uFF09\u81EA\u52A8\u5230\u8D26\u5E76\u56DE\u8C03\u5546\u6237\uFF01"],async createOrder(e){let t=JSON.parse(JSON.stringify(e.channel.config)),r=(t.address||"").trim();if(!r||!r.startsWith("T")||r.length<30)return{ok:!1,msg:"TRC20 \u94B1\u5305\u5730\u5740\u4E0D\u5408\u6CD5 (\u6CE2\u573A\u4E3B\u7F51\u5730\u5740\u5FC5\u987B\u4EE5\u5B57\u6BCD T \u5F00\u5934)"};let n=await qr(e.env,e.order,t),o=Math.max(0,n.expire_at-v());return{ok:!0,qrContent:`tron:${n.wallet}?amount=${n.pay_usdt}`,payAmount:$(e.order.money),coinAmount:`${n.pay_usdt} USDT`,coinRate:`1 USDT \u2248 ${n.rate} CNY`,walletAddress:n.wallet,expireSeconds:o}}};ce();N();Ut();zt();K();var I=new B;async function Gs(e,t){let r=await q("syskey")||"";return(await Ge(e,r,Je(t,"epay_session")))?.role==="admin"}I.get("/api/stats",async e=>{let t=v()-86400,[r,n,o]=await Promise.all([Pe(),Ot(t),Te()]);return e.json({code:0,data:{merchants:r,orders_today:n.n,money_today:n.sum/100,orders_all:o.orders}})});I.get("/api/regconfig",async e=>{let t=await J();return e.json({code:0,data:{captcha_open:t.captcha_open==="1",email_verify:t.email_verify==="1",reg_open:t.reg_open==="1"}})});I.get("/api/announcement",async e=>e.json({code:0,data:await q("announcement")||""}));I.get("/api/captcha",async e=>{let t=Math.floor(Math.random()*20)+1,r=Math.floor(Math.random()*20)+1,n=oe(16),o=String(t+r);await It(`cap:${n}`,o,v()),await Co(v()-600);let a=`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#f0f4f8"/><text x="18" y="27" font-size="20" font-family="Georgia" fill="#337ab7" transform="rotate(${Math.random()*10-5} 30 20)">${t} + ${r} = ?</text><line x1="0" y1="${Math.random()*40}" x2="120" y2="${Math.random()*40}" stroke="#aac" stroke-width="1"/><line x1="0" y1="${Math.random()*40}" x2="120" y2="${Math.random()*40}" stroke="#aac" stroke-width="1"/></svg>`;return e.json({code:0,data:{id:n,svg:a}})});I.get("/pay/:uid",async e=>{let t=parseInt(e.req.param("uid"),10),r=await te(t);if(!r||r.status!==1)return e.html('<meta charset="utf-8"><body style="text-align:center;padding-top:80px;font-family:sans-serif;color:#ef4444"><h3>\u5F53\u524D\u5546\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u7981\u7528</h3></body>');let n=await J(),o=[];try{o=Object.keys(JSON.parse(n.channel_map||"{}"))}catch{}o.length||(o=["alipay","wxpay"]);let a=n.sitename||"Epay Pages",s={alipay:"\u652F\u4ED8\u5B9D",wxpay:"\u5FAE\u4FE1\u652F\u4ED8",qqpay:"QQ \u94B1\u5305",usdt:"USDT \u6CF0\u8FBE\u5E01",bank:"\u94F6\u8054 / \u4E91\u95EA\u4ED8",paypal:"PayPal \u8D1D\u5B9D",jdpay:"\u4EAC\u4E1C\u652F\u4ED8"};return e.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>\u5411 ${r.username} \u4ED8\u6B3E - ${a}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 14px}
.pay-card{background:#ffffff;width:100%;max-width:400px;border-radius:24px;border:1px solid rgba(226,232,240,0.8);box-shadow:0 20px 40px -15px rgba(15,23,42,0.08);padding:32px 24px}
.merchant-row{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9}
.avatar{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#38bdf8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
.m-info{display:flex;flex-direction:column}
.m-name{font-size:16px;font-weight:700;color:#0f172a}
.m-id{font-size:12px;color:#64748b}

.input-label{font-size:13px;font-weight:600;color:#64748b;margin-bottom:8px}
.amount-wrap{position:relative;display:flex;align-items:center;margin-bottom:14px}
.sym{position:absolute;left:14px;font-size:26px;font-weight:700;color:#0f172a}
.amt-input{width:100%;height:64px;padding-left:42px;padding-right:16px;border:2px solid #e2e8f0;border-radius:14px;font-size:32px;font-weight:800;color:#0f172a;outline:none;transition:border-color .2s}
.amt-input:focus{border-color:#2563eb}

.quick-pills{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:22px}
.pill{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 0;text-align:center;font-size:13px;font-weight:600;color:#475569;cursor:pointer;transition:all .15s}
.pill:hover{background:#eff6ff;color:#2563eb;border-color:#bfdbfe}

.type-select{width:100%;height:48px;padding:0 14px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;font-weight:600;color:#0f172a;background:#fff;margin-bottom:24px;outline:none}

.btn-pay{display:block;width:100%;background:#0f172a;color:#fff;font-size:16px;font-weight:700;padding:15px;border:none;border-radius:14px;cursor:pointer;transition:all .2s;box-shadow:0 4px 14px rgba(15,23,42,0.15)}
.btn-pay:hover{background:#1e293b;transform:translateY(-1px)}
.btn-pay:active{transform:scale(0.98)}

.foot{text-align:center;font-size:11px;color:#94a3b8;margin-top:20px}
</style></head><body>

<div class="pay-card">
  <div class="merchant-row">
    <div class="avatar">${r.username.slice(0,1).toUpperCase()}</div>
    <div class="m-info">
      <span class="m-name">${r.username}</span>
      <span class="m-id">\u5546\u6237\u53F7 #${t} \xB7 ${a}</span>
    </div>
  </div>

  <form method="get" action="/paygo/${t}">
    <div class="input-label">\u4ED8\u6B3E\u91D1\u989D</div>
    <div class="amount-wrap">
      <span class="sym">\xA5</span>
      <input class="amt-input" id="amtInput" name="money" type="number" step="0.01" min="0.01" placeholder="\u8F93\u5165\u91D1\u989D" autofocus required>
    </div>

    <div class="quick-pills">
      <div class="pill" onclick="setAmt('5.00')">\xA55</div>
      <div class="pill" onclick="setAmt('10.00')">\xA510</div>
      <div class="pill" onclick="setAmt('20.00')">\xA520</div>
      <div class="pill" onclick="setAmt('50.00')">\xA550</div>
      <div class="pill" onclick="setAmt('100.00')">\xA5100</div>
    </div>

    <div class="input-label">\u652F\u4ED8\u65B9\u5F0F</div>
    <select class="type-select" name="type">
      ${o.map(i=>`<option value="${i}">${s[i]||i}</option>`).join("")}
    </select>

    <button class="btn-pay" type="submit">\u7ACB\u5373\u652F\u4ED8 \u2192</button>
  </form>

  <div class="foot">\u5B89\u5168\u52A0\u5BC6\u652F\u4ED8 \xB7 \u8D44\u91D1\u76F4\u8FBE\u5546\u6237\u8D26\u6237</div>
</div>

<script>
function setAmt(v){
  var el = document.getElementById('amtInput');
  el.value = v;
  el.focus();
}
</script>
</body></html>`)});I.get("/paygo/:uid",async e=>{let t=parseInt(e.req.param("uid"),10),r=e.req.query("money")||"",n=e.req.query("type")||"alipay",o=O(r);if(!o)return e.html('<meta charset="utf-8"><body style="text-align:center;padding-top:60px">\u91D1\u989D\u9519\u8BEF</body>');let a=await Qo(e.env,e.req.raw,{uid:t,type:n,money:o,name:"\u7801\u724C\u6536\u6B3E",out_trade_no:"CODE"+Date.now(),notify_url:"",return_url:"",skipRisk:!0});return a.ok?e.redirect(`/cashier/${a.tradeNo}`):e.html(`<meta charset="utf-8"><body style="text-align:center;padding-top:60px;color:#e64340">${a.msg}</body>`)});I.get("/doc",e=>{let t=(r,n,o)=>`
<div class="code-box">
  <div class="code-header">
    <div class="code-dots"><span></span><span></span><span></span></div>
    <span class="code-title">${r}</span>
    <span class="code-lang">${n}</span>
  </div>
  <pre><code>${o.replace(/</g,"&lt;")}</code></pre>
</div>`;return e.html(`<!DOCTYPE html><html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>\u5546\u6237\u63A5\u5165\u5F00\u53D1\u6587\u6863 - Epay Pages</title>
<style>
:root{
  --bg:#f8fafc;
  --surface:#ffffff;
  --text:#0f172a;
  --text-muted:#64748b;
  --border:#e2e8f0;
  --primary:#2563eb;
  --primary-hover:#1d4ed8;
  --radius:16px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{text-decoration:none;color:var(--primary)}
a:hover{text-decoration:underline}

/* \u9876\u90E8\u5BFC\u822A */
.nav-wrap{position:sticky;top:0;z-index:100;background:rgba(255,255,255,0.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.nav-box{max-width:1160px;margin:0 auto;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.nav-brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:var(--text);text-decoration:none}
.nav-brand svg{width:24px;height:24px;color:var(--primary)}
.nav-links{display:flex;align-items:center;gap:18px}
.nav-links a{color:var(--text-muted);font-size:14px;font-weight:500;text-decoration:none}
.nav-links a:hover{color:var(--primary)}
.nav-btn{background:var(--primary);color:#fff!important;font-size:13px;font-weight:600;padding:6px 14px;border-radius:100px;transition:background .2s}
.nav-btn:hover{background:var(--primary-hover)}

/* \u79FB\u52A8\u7AEF\u6A2A\u5411\u6ED1\u52A8\u80F6\u56CA\u76EE\u5F55 (Stripe/Tailwind \u79FB\u52A8\u7AEF\u540C\u6B3E) */
.mobile-anchors{display:none}

/* \u684C\u9762\u7AEF\u53CC\u680F\u5E03\u5C40 */
.layout{max-width:1160px;margin:32px auto 80px;padding:0 20px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;align-items:start;box-sizing:border-box}
.sidebar{position:sticky;top:92px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 12px;display:flex;flex-direction:column;gap:4px}
.sidebar a{font-size:13px;font-weight:500;color:var(--text-muted);padding:8px 14px;border-radius:8px;transition:all .15s}
.sidebar a:hover{background:var(--bg);color:var(--primary);text-decoration:none}

.content{display:flex;flex-direction:column;gap:36px;min-width:0;max-width:100%}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:32px;min-width:0;max-width:100%;box-sizing:border-box}
.section h2{font-size:22px;font-weight:800;letter-spacing:-0.5px;color:var(--text);margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.section h2::before{content:"";width:4px;height:20px;background:var(--primary);border-radius:2px;display:inline-block;flex-shrink:0}
.section h3{font-size:16px;font-weight:700;margin:24px 0 10px;color:var(--text)}
.section p{font-size:14px;color:var(--text-muted);margin-bottom:14px;line-height:1.7}
.section ul,.section ol{margin-left:20px;margin-bottom:16px;color:var(--text-muted);font-size:14px;line-height:1.8}
.badge-tag{background:#eff6ff;color:var(--primary);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;font-family:monospace}

/* \u8868\u683C\u54CD\u5E94\u5F0F\u5BB9\u5668 (\u79FB\u52A8\u7AEF\u5185\u90E8\u6A2A\u5411\u81EA\u9002\u5E94\u6ED1\u52A8) */
.table-wrap{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:16px 0;border:1px solid var(--border);border-radius:10px}
table{width:100%;min-width:440px;border-collapse:collapse;font-size:13px;text-align:left}
th{background:#f8fafc;padding:10px 14px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border)}
td{padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text-muted)}
tr:last-child td{border-bottom:none}

/* macOS \u4EE3\u7801\u5757 */
.code-box{width:100%;max-width:100%;border-radius:12px;overflow:hidden;background:#0f172a;margin:16px 0;border:1px solid #1e293b}
.code-header{background:#1e293b;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;color:#94a3b8;font-size:12px}
.code-dots{display:flex;gap:6px}
.code-dots span{width:10px;height:10px;border-radius:50%}
.code-dots span:nth-child(1){background:#ef4444}
.code-dots span:nth-child(2){background:#f59e0b}
.code-dots span:nth-child(3){background:#10b981}
.code-title{font-weight:600;color:#cbd5e1}
.code-lang{text-transform:uppercase;font-size:10px;letter-spacing:0.5px}
pre{width:100%;max-width:100%;padding:14px;overflow-x:auto;-webkit-overflow-scrolling:touch;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;box-sizing:border-box}

/* \u54CD\u5E94\u5F0F\u65AD\u70B9 (\u5B8C\u7F8E\u81EA\u9002\u5E94) */
@media (max-width:840px){
  .layout{display:block;width:100%;max-width:100%;padding:16px 14px;margin:12px auto 60px}
  .sidebar{display:none}
  .section{padding:20px 16px;border-radius:14px}
  .section h2{font-size:18px}
  .nav-box{padding:0 16px}
  .nav-links a:not(.nav-btn){display:none}
  
  /* \u79FB\u52A8\u7AEF\u7F6E\u9876\u6A2A\u5411\u6ED1\u5757 */
  .mobile-anchors{display:flex;gap:8px;overflow-x:auto;padding:10px 14px;background:rgba(255,255,255,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:60px;z-index:90;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .mobile-anchors::-webkit-scrollbar{display:none}
  .mobile-anchors a{white-space:nowrap;font-size:12px;font-weight:600;color:var(--text-muted);background:#f1f5f9;padding:5px 12px;border-radius:100px;text-decoration:none}
  .mobile-anchors a:active,.mobile-anchors a:focus{background:var(--primary);color:#fff}
}
</style></head><body>

<div class="nav-wrap">
  <div class="nav-box">
    <a class="nav-brand" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <span>Epay Pages \u63A5\u5165\u6587\u6863</span>
    </a>
    <div class="nav-links">
      <a href="/">\u8FD4\u56DE\u9996\u9875</a>
      <a href="/admin.html">\u7BA1\u7406\u540E\u53F0</a>
      <a class="nav-btn" href="/user.html">\u5546\u6237\u4E2D\u5FC3</a>
    </div>
  </div>
</div>

<div class="mobile-anchors">
  <a href="#about">\u67B6\u6784\u8BF4\u660E</a>
  <a href="#quickstart">\u5FEB\u901F\u5F00\u59CB</a>
  <a href="#plugin">\u65B9\u5F0FA:\u63D2\u4EF6</a>
  <a href="#direct">\u65B9\u5F0FB:API</a>
  <a href="#notify">\u5F02\u6B65\u56DE\u8C03</a>
  <a href="#query">\u67E5\u8BE2\u9000\u6B3E</a>
  <a href="#paypage">\u7801\u724C\u6536\u6B3E</a>
  <a href="#usdt">\u52A0\u5BC6\u8D27\u5E01\u6536\u6B3E</a>
  <a href="#monitors">\u76D1\u63A7\u7AEF</a>
  <a href="#faq">\u5E38\u89C1\u95EE\u9898</a>
</div>

<div class="layout">
  <div class="sidebar">
    <a href="#about">\u7CFB\u7EDF\u4E0E\u67B6\u6784</a>
    <a href="#quickstart">\u5FEB\u901F\u5F00\u59CB</a>
    <a href="#plugin">\u65B9\u5F0FA: CMS\u63D2\u4EF6</a>
    <a href="#direct">\u65B9\u5F0FB: \u76F4\u8FDEAPI</a>
    <a href="#notify">\u5F02\u6B65\u56DE\u8C03\u4E0E\u9A8C\u7B7E</a>
    <a href="#query">\u8BA2\u5355\u67E5\u8BE2\u4E0E\u9000\u6B3E</a>
    <a href="#paypage">\u7801\u724C\u6536\u6B3E</a>
    <a href="#usdt">\u52A0\u5BC6\u8D27\u5E01\u6536\u6B3E</a>
    <a href="#monitors">\u591A\u7AEF\u76D1\u63A7\u7AEF</a>
    <a href="#faq">\u5E38\u89C1\u95EE\u9898</a>
  </div>

  <div class="content">
    <div class="section" id="about">
      <h2>\u7CFB\u7EDF\u4E0E\u67B6\u6784\u8BF4\u660E</h2>
      <p>\u672C\u7CFB\u7EDF\u4E3A <b>\u5F69\u8679\u6613\u652F\u4ED8\u534F\u8BAE 100% \u517C\u5BB9</b> \u7684\u9AD8\u6027\u80FD\u652F\u4ED8\u7F51\u5173\uFF0C\u5B8C\u5168\u8FD0\u884C\u4E8E Cloudflare \u5168\u7403\u8FB9\u7F18\u7F51\u7EDC\uFF08<b>\u975E PHP \u7A0B\u5E8F</b>\uFF0C\u57FA\u4E8E Cloudflare Pages + D1 \u5F3A\u4E00\u81F4\u6570\u636E\u5E93\uFF09\uFF0C\u675C\u7EDD\u539F\u7248\u6D41\u4F20\u6E90\u7801\u4E2D\u7684\u6076\u610F\u540E\u95E8\u4E0E\u6570\u636E\u5E93\u6CE8\u5165\u6F0F\u6D1E\u3002</p>
      <p>\u4EFB\u4F55\u652F\u6301\u6613\u652F\u4ED8\u534F\u8BAE\u7684\u5546\u57CE\u3001\u53D1\u5361\u7AD9\u3001\u4F1A\u5458\u7CFB\u7EDF\u586B\u5165\u4E09\u4EF6\u5957\u53C2\u6570\u5373\u53EF\u5F00\u7BB1\u5373\u7528\u3002\u540C\u65F6\u539F\u751F\u652F\u6301 <b>\u652F\u4ED8\u5B9D\u514DCK\u5B98\u65B9API\u6A21\u5F0F</b>\u3001<b>V\u514D\u7B7E\u5B89\u5353\u539F\u751FApp</b>\u3001<b>\u684C\u9762\u6302\u673A\u7AEF</b> \u4E0E <b>OneBot \u534F\u8BAE\u7AEF</b> \u63A5\u5165\u3002</p>
    </div>

    <div class="section" id="quickstart">
      <h2>\u5FEB\u901F\u5F00\u59CB\uFF08\u4E09\u6B65\u63A5\u5165\uFF09</h2>
      <ol>
        <li><b>\u83B7\u53D6\u5546\u6237\u51ED\u636E</b>\uFF1A\u767B\u5F55 <a href="/user.html">\u5546\u6237\u4E2D\u5FC3</a> \u6CE8\u518C\u8D26\u53F7\uFF0C\u5728\u4E3B\u9875\u76F4\u63A5\u83B7\u53D6\u60A8\u7684\u5546\u6237\u7F16\u53F7 <span class="badge-tag">PID</span> \u4E0E\u901A\u4FE1\u79C1\u94A5 <span class="badge-tag">KEY</span>\u3002</li>
        <li><b>\u914D\u7F6E\u6620\u5C04\u901A\u9053</b>\uFF1A\u7BA1\u7406\u5458\u5728\u540E\u53F0\u521B\u5EFA\u6536\u6B3E\u901A\u9053\u5E76\u542F\u7528\uFF0C\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u901A\u8FC7\u53EF\u89C6\u5316\u4E0B\u62C9\u5B8C\u6210\u652F\u4ED8\u7C7B\u578B\u6620\u5C04\uFF08\u5982 alipay/wxpay/qqpay/usdt\uFF09\u3002</li>
        <li><b>\u63A5\u5165\u6536\u6B3E</b>\uFF1A\u5C06\u4E09\u4EF6\u5957\u53C2\u6570\u586B\u5165\u7F51\u7AD9\u63D2\u4EF6\u5373\u53EF\u53D1\u8D77\u6536\u6B3E\uFF0C\u65E0\u9700\u7F51\u7AD9\u65F6\u4E5F\u53EF\u4EE5\u76F4\u63A5\u4F7F\u7528\u7801\u724C\u6536\u6B3E\u3002</li>
      </ol>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u652F\u4ED8\u7C7B\u578B\u6807\u8BC6</th><th>\u4E2D\u6587\u540D\u79F0</th><th>\u8BF4\u660E</th></tr></thead>
          <tbody>
            <tr><td><code>alipay</code></td><td>\u652F\u4ED8\u5B9D</td><td>\u5F53\u9762\u4ED8 / \u4E2A\u4EBA\u7801\u8D26\u5355\u8F6E\u8BE2 / \u514DCK\u6A21\u5F0F</td></tr>
            <tr><td><code>wxpay</code></td><td>\u5FAE\u4FE1\u652F\u4ED8</td><td>\u5B98\u65B9\u626B\u7801 Native V2 / \u4E2A\u4EBA\u7801\u76D1\u63A7</td></tr>
            <tr><td><code>qqpay</code></td><td>QQ \u94B1\u5305</td><td>QQ \u94B1\u5305\u8D26\u5355\u8F6E\u8BE2 / OneBot \u534F\u8BAE\u7AEF</td></tr>
            <tr><td><code>usdt</code></td><td>USDT \u6CF0\u8FBE\u5E01</td><td>TRC20 \u94FE\u4E0A\u5730\u5740\u6536\u6B3E</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="plugin">
      <h2>\u65B9\u5F0FA\uFF1A\u73B0\u6210\u6613\u652F\u4ED8\u63D2\u4EF6\u63A5\u5165\uFF08\u63A8\u8350\uFF09</h2>
      <p>\u5E02\u9762\u4E0A 99% \u7684\u5F00\u6E90\u5546\u57CE\u3001\u53D1\u5361\u7CFB\u7EDF\uFF08\u5982\u72EC\u89D2\u6570\u5361\u3001WordPress WooCommerce\u3001Typecho\u3001Z-Blog\u3001\u8354\u679D\u53D1\u5361\u3001WHMCS \u7B49\uFF09\u90FD\u5185\u7F6E\u6613\u652F\u4ED8\u63D2\u4EF6\uFF0C\u53EA\u9700\u586B\u5165\u4EE5\u4E0B\u4E09\u9879\uFF1A</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u63D2\u4EF6\u914D\u7F6E\u9879</th><th>\u5BF9\u5E94\u53C2\u6570\u8BF4\u660E</th></tr></thead>
          <tbody>
            <tr><td><b>\u7F51\u5173 / \u63A5\u53E3\u5730\u5740</b></td><td><code>https://\u60A8\u7684\u57DF\u540D</code> \uFF08\u4F8B\u5982 <code>https://epay-pages.pages.dev</code>\uFF09</td></tr>
            <tr><td><b>\u5546\u6237ID (PID)</b></td><td>\u5546\u6237\u4E2D\u5FC3\u4E3B\u9875\u663E\u793A\u7684\u6570\u5B57 ID\uFF08\u4F8B\u5982 <code>1</code>\uFF09</td></tr>
            <tr><td><b>\u5546\u6237\u5BC6\u94A5 (KEY)</b></td><td>\u5546\u6237\u4E2D\u5FC3\u663E\u793A\u7684 32 \u4F4D\u901A\u4FE1\u79C1\u94A5</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="direct">
      <h2>\u65B9\u5F0FB\uFF1A\u76F4\u8FDE API \u63A5\u53E3\u4E0B\u5355</h2>
      <p>\u81EA\u7814\u7CFB\u7EDF\u6216\u65E0\u63D2\u4EF6\u573A\u666F\uFF0C\u53EF\u5411\u7F51\u5173\u53D1\u8D77 HTTP \u8BF7\u6C42\uFF1A</p>
      <ul>
        <li><b>\u9875\u9762\u8DF3\u8F6C\u65B9\u5F0F</b>\uFF1A<code>GET / POST /submit.php</code>\uFF08\u81EA\u52A8 302 \u643A\u5E26\u53C2\u6570\u91CD\u5B9A\u5411\u81F3\u6536\u94F6\u53F0\uFF09</li>
        <li><b>\u63A5\u53E3\u8FD4\u56DE\u65B9\u5F0F</b>\uFF1A<code>GET / POST /mapi.php</code>\uFF08\u8FD4\u56DE JSON \u7ED3\u6784\uFF1A\u542B <code>trade_no</code>, <code>payurl</code>, <code>qrcode</code>\uFF09</li>
      </ul>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u53C2\u6570\u540D</th><th>\u5FC5\u586B</th><th>\u7C7B\u578B</th><th>\u8BF4\u660E</th></tr></thead>
          <tbody>
            <tr><td><code>pid</code></td><td>\u662F</td><td>Int</td><td>\u5546\u6237\u7F16\u53F7</td></tr>
            <tr><td><code>type</code></td><td>\u662F</td><td>String</td><td>\u652F\u4ED8\u65B9\u5F0F (alipay / wxpay / qqpay / usdt)</td></tr>
            <tr><td><code>out_trade_no</code></td><td>\u662F</td><td>String</td><td>\u5546\u6237\u7CFB\u7EDF\u552F\u4E00\u8BA2\u5355\u53F7</td></tr>
            <tr><td><code>notify_url</code></td><td>\u662F</td><td>String</td><td>\u670D\u52A1\u5668\u5F02\u6B65\u901A\u77E5\u5B8C\u6574\u516C\u7F51 URL</td></tr>
            <tr><td><code>return_url</code></td><td>\u5426</td><td>String</td><td>\u4E70\u5BB6\u652F\u4ED8\u5B8C\u6210\u540E\u540C\u6B65\u8DF3\u8F6C\u9875\u9762</td></tr>
            <tr><td><code>name</code></td><td>\u662F</td><td>String</td><td>\u5546\u54C1\u540D\u79F0</td></tr>
            <tr><td><code>money</code></td><td>\u662F</td><td>Decimal</td><td>\u91D1\u989D\uFF08\u5143\uFF0C\u7CBE\u786E\u5230\u4E24\u4F4D\u5C0F\u6570\uFF0C\u5982 10.00\uFF09</td></tr>
            <tr><td><code>sign</code></td><td>\u662F</td><td>String</td><td>\u8BF7\u6C42\u6570\u5B57\u7B7E\u540D</td></tr>
            <tr><td><code>sign_type</code></td><td>\u662F</td><td>String</td><td>\u56FA\u5B9A\u4F20 <code>MD5</code>\uFF08\u6216\u5546\u6237\u914D\u7F6E\u7684 <code>RSA</code>\uFF09</td></tr>
          </tbody>
        </table>
      </div>
      <h3>\u7B7E\u540D\u7B97\u6CD5</h3>
      <p>\u5C06\u6240\u6709\u8BF7\u6C42\u53C2\u6570\uFF08\u6392\u9664 <code>sign</code>\u3001<code>sign_type</code> \u53CA\u7A7A\u503C\u53C2\u6570\uFF09\u6309\u53C2\u6570\u540D <b>ASCII \u7801\u5347\u5E8F\u6392\u5E8F</b>\uFF0C\u4EE5 <code>k=v&</code> \u62FC\u63A5\u4E3A\u5F85\u7B7E\u540D\u5B57\u7B26\u4E32\u3002\u672B\u5C3E\u76F4\u63A5\u62FC\u63A5\u5546\u6237 KEY \u540E\u53D6 32 \u4F4D\u5C0F\u5199 MD5\uFF1A<code>md5(\u5F85\u7B7E\u5B57\u7B26\u4E32 + KEY)</code>\u3002</p>

      ${t("Node.js \u4E0B\u5355\u7B7E\u540D\u793A\u4F8B","javascript",`const crypto = require('crypto');

function buildSign(params, key) {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== undefined)
    .sort();
  const queryStr = sortedKeys.map(k => k + '=' + params[k]).join('&');
  return crypto.createHash('md5').update(queryStr + key).digest('hex');
}

// \u6784\u9020\u4E0B\u5355\u53C2\u6570
const order = {
  pid: '1',
  type: 'alipay',
  out_trade_no: 'ORDER_' + Date.now(),
  notify_url: 'https://mysite.com/api/pay/notify',
  return_url: 'https://mysite.com/pay/success',
  name: '\u9AD8\u7EA7VIP\u4F1A\u5458\u6708\u5361',
  money: '29.90',
};

const sign = buildSign(order, '\u60A8\u768432\u4F4D\u5546\u6237\u5BC6\u94A5');
const payUrl = 'https://epay-pages.pages.dev/submit.php?' + new URLSearchParams({
  ...order,
  sign,
  sign_type: 'MD5'
}).toString();

console.log('\u8BF7\u5F15\u5BFC\u7528\u6237\u8DF3\u8F6C\u6B64\u94FE\u63A5\u652F\u4ED8:', payUrl);`)}

      ${t("Python \u4E0B\u5355\u7B7E\u540D\u793A\u4F8B","python",`import hashlib
from urllib.parse import urlencode

def build_sign(params, key):
    filtered = sorted((k, v) for k, v in params.items() if k not in ('sign', 'sign_type') and v != '')
    query_str = '&'.join(f'{k}={v}' for k, v in filtered)
    return hashlib.md5((query_str + key).encode('utf-8')).hexdigest()

params = {
    'pid': '1',
    'type': 'wxpay',
    'out_trade_no': 'PY_1001',
    'notify_url': 'https://mysite.com/notify',
    'name': '\u8D5E\u52A9\u6D4B\u8BD5',
    'money': '5.00'
}
params['sign'] = build_sign(params, '\u5546\u6237\u5BC6\u94A5')
params['sign_type'] = 'MD5'
print('https://epay-pages.pages.dev/submit.php?' + urlencode(params))`)}
    </div>

    <div class="section" id="notify">
      <h2>\u5F02\u6B65\u56DE\u8C03\u901A\u77E5\u4E0E\u9A8C\u7B7E</h2>
      <p>\u4E70\u5BB6\u652F\u4ED8\u6210\u529F\u540E\uFF0C\u7F51\u5173\u4F1A\u4EE5 <code>GET</code> \u8BF7\u6C42\u5411\u5546\u6237\u9884\u7559\u7684 <code>notify_url</code> \u53D1\u9001\u5F02\u6B65\u901A\u77E5\u3002\u5546\u6237\u9A8C\u7B7E\u901A\u8FC7\u540E\uFF0C<b>\u5FC5\u987B\u4EC5\u8F93\u51FA\u7EAF\u6587\u672C <code>success</code></b>\uFF0C\u5426\u5219\u7CFB\u7EDF\u5C06\u5728 24 \u5C0F\u65F6\u5185\u542F\u52A8\u91CD\u8BD5\u673A\u5236\uFF08\u6700\u591A 5 \u6B21\uFF09\u3002</p>
      ${t("PHP \u5F02\u6B65\u901A\u77E5\u9A8C\u7B7E\u5904\u7406\u793A\u4F8B","php",`<?php
$key = '\u60A8\u7684\u5546\u6237\u5BC6\u94A5';
$params = $_GET;
$sign = $params['sign'];

// \u6392\u5E8F\u5E76\u8FC7\u6EE4\u7A7A\u503C\u4E0E\u7B7E\u540D\u952E
ksort($params);
$signParts = [];
foreach ($params as $k => $v) {
    if ($k !== 'sign' && $k !== 'sign_type' && $v !== '') {
        $signParts[] = "$k=$v";
    }
}
$expectSign = md5(implode('&', $signParts) . $key);

if ($sign === $expectSign) {
    if ($params['trade_status'] === 'TRADE_SUCCESS') {
        $tradeNo = $params['trade_no'];       // \u5E73\u53F0\u8BA2\u5355\u53F7
        $outTradeNo = $params['out_trade_no']; // \u5546\u6237\u8BA2\u5355\u53F7
        $money = $params['money'];             // \u5B9E\u4ED8\u91D1\u989D
        
        // \u6267\u884C\u4E1A\u52A1\u53D1\u8D27\u903B\u8F91...
    }
    // \u6210\u529F\u5904\u7406\u5FC5\u987B\u539F\u6837\u8F93\u51FA\u5C0F\u5199 success
    exit('success');
} else {
    exit('fail');
}`)}
    </div>

    <div class="section" id="query">
      <h2>\u8BA2\u5355\u67E5\u8BE2\u4E0E\u9000\u6B3E API</h2>
      ${t("API \u517C\u5BB9\u7AEF\u70B9\u8BF4\u660E","http",`# 1. \u8BA2\u5355\u72B6\u6001\u67E5\u8BE2 (GET)
GET /api.php?act=order&pid=\u5546\u6237ID&key=\u5546\u6237KEY&trade_no=\u5E73\u53F0\u8BA2\u5355\u53F7

# 2. \u8BA2\u5355\u9000\u6B3E (POST \u8868\u5355)
POST /api.php?act=refundapi
trade_no=\u5E73\u53F0\u8BA2\u5355\u53F7&money=\u9000\u6B3E\u91D1\u989D&key=md5(trade_no+\u7CFB\u7EDFKEY+trade_no)`)}
    </div>

    <div class="section" id="paypage">
      <h2>\u7801\u724C\u6536\u6B3E\u6A21\u5F0F\uFF08\u65E0\u7F51\u7AD9\u573A\u666F\uFF09</h2>
      <p>\u7CFB\u7EDF\u4E3A\u6BCF\u4E2A\u5546\u6237\u63D0\u4F9B\u4E13\u5C5E\u9759\u6001\u805A\u5408\u6536\u94F6\u7801\u724C\u9875\u9762\uFF1A<code>https://\u60A8\u7684\u57DF\u540D/pay/\u5546\u6237ID</code>\u3002</p>
      <p>\u65E0\u9700\u642D\u5EFA\u72EC\u7ACB\u5546\u57CE\uFF0C\u76F4\u63A5\u5C06\u6B64\u94FE\u63A5\u6253\u5370\u6210\u5B9E\u4F53\u6536\u94F6\u53F0\u53F0\u5361\u6216\u53D1\u7ED9\u4E70\u5BB6\uFF0C\u4E70\u5BB6\u81EA\u4E3B\u8F93\u5165\u91D1\u989D\u5E76\u9009\u62E9\u652F\u4ED8\u6E20\u9053\u5373\u53EF\u5B8C\u6210\u652F\u4ED8\u3002</p>
    </div>

    <div class="section" id="usdt">
      <h2>\u52A0\u5BC6\u8D27\u5E01\u6536\u6B3E\uFF08USDT / TRC20 \u94FE\u4E0A\u514D\u6302\uFF09</h2>
      <p>\u7CFB\u7EDF\u5185\u7F6E\u4E24\u79CD USDT \u6536\u6B3E\u6A21\u5F0F\uFF0C\u5747\u652F\u6301<b>\u8D44\u91D1\u76F4\u63A5\u8FDB\u4F60\u81EA\u5DF1\u7684\u79C1\u4EBA\u94B1\u5305\u3001\u65E0\u4E2D\u95F4\u5546\u62BD\u6210\u3001\u65E0\u9700\u624B\u673A\u5E38\u9A7B\u6302\u673A</b>\uFF1A</p>

      <div class="table-wrap">
        <table>
          <thead><tr><th>\u6A21\u5F0F</th><th>\u9002\u7528\u573A\u666F</th><th>\u6240\u9700\u914D\u7F6E</th><th>\u4F18\u52BF</th></tr></thead>
          <tbody>
            <tr>
              <td><b>\u{1F31F} \u6A21\u5F0F\u4E00\uFF1A\u539F\u751F\u5185\u7F6E\u5BF9\u8D26\uFF08\u5F3A\u70C8\u63A8\u8350\uFF09</b></td>
              <td>\u4E0D\u60F3\u4E70\u670D\u52A1\u5668\u3001\u4E0D\u60F3\u6298\u817E Docker\u3001\u53EA\u8981\u6536 USDT</td>
              <td><b>\u4EC5\u9700\u4E00\u4E2A TRC20 \u94B1\u5305\u5730\u5740 (T\u5F00\u5934)</b></td>
              <td><b>\u7EAF Cloudflare \u4E91\u7AEF\u8FB9\u7F18\u76F4\u8FDE\u6CE2\u573A\u4E3B\u7F51</b>\uFF0C\u771F\u6B63\u96F6\u670D\u52A1\u5668\u3001\u96F6\u6302\u673A\u3001\u5F00\u7BB1\u5373\u7528</td>
            </tr>
            <tr>
              <td><b>\u6A21\u5F0F\u4E8C\uFF1A\u81EA\u5EFA BEpusdt \u7F51\u5173</b></td>
              <td>\u5DF2\u6709\u5883\u5916 VPS\uFF0C\u9700\u591A\u516C\u94FE\u652F\u6301\u6216 BEpusdt \u72EC\u7ACB\u6536\u94F6\u53F0</td>
              <td>BEpusdt \u670D\u52A1\u5730\u5740 + API \u5BF9\u63A5\u4EE4\u724C</td>
              <td>\u72EC\u7ACB\u7F51\u5173\u67B6\u6784\uFF0C\u652F\u6301\u591A\u4EE3\u5E01/\u591A\u94FE\u6269\u5C55</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>\u65B9\u5F0F\u4E00\uFF1A\u539F\u751F\u5185\u7F6E\u6A21\u5F0F\u6781\u7B80\u5F00\u901A\uFF08\u4EC5\u9700 2 \u6B65\uFF0C\u6700\u7701\u5FC3\uFF09</h3>
      <ol>
        <li>\u8FDB\u300C<b>\u652F\u4ED8\u6E20\u9053 \u2192 \u6DFB\u52A0\u6E20\u9053</b>\u300D\uFF0C\u63D2\u4EF6\u7C7B\u578B\u9009 <code>\u539F\u751FUSDT(TRC20\u94FE\u4E0A\u67E5\u8D26\xB7\u96F6\u670D\u52A1\u5668\u514D\u6302)</code>\uFF0C\u586B\u5165\u4F60\u7684 <b>TRC20 \u6536\u6B3E\u94B1\u5305\u5730\u5740</b>\uFF08\u5982\u4EA4\u6613\u6240\u5145\u5E01\u5730\u5740\u6216\u4E2A\u4EBA\u51B7\u70ED\u94B1\u5305\uFF09\uFF0C\u72B6\u6001\u9009\u542F\u7528\u3002</li>
        <li>\u8FDB\u300C<b>\u7CFB\u7EDF\u8BBE\u7F6E \u2192 \u7C7B\u578B\u2192\u6E20\u9053 \u6620\u5C04</b>\u300D\uFF0C\u6DFB\u52A0\u4E00\u884C\uFF1A\u652F\u4ED8\u65B9\u5F0F\u9009 <code>USDT \u6CF0\u8FBE\u5E01 (usdt)</code>\uFF0C\u70B9\u9009\u521A\u6DFB\u52A0\u7684\u6E20\u9053\u5E76\u4FDD\u5B58\u3002</li>
      </ol>
      <p><b>\u6267\u884C\u673A\u5236</b>\uFF1A\u5546\u6237\u4E0B\u5355 <code>type=usdt</code> \u65F6\uFF0C\u7CFB\u7EDF\u81EA\u52A8\u62C9\u53D6\u5B9E\u65F6\u6C47\u7387\u5E76\u8FFD\u52A0 4 \u4F4D\u9632\u649E\u5355\u5FAE\u5C3E\u6570\uFF08\u5982 <code>13.6942 USDT</code>\uFF09\uFF1B\u4E70\u5BB6\u5728\u6536\u94F6\u53F0\u626B\u7801\u6216\u590D\u5236\u5730\u5740\u8F6C\u8D26\uFF0C\u6CE2\u573A\u4E3B\u7F51\u51FA\u5757\u540E\uFF08\u901A\u5E38 5~15 \u79D2\uFF09\uFF0C\u7CFB\u7EDF\u81EA\u52A8\u68C0\u6D4B\u5E76\u79D2\u7EA7\u6838\u9500\u8BA2\u5355\uFF01</p>

      <h3>\u65B9\u5F0F\u4E8C\uFF1A\u5916\u90E8 BEpusdt \u7F51\u5173\u5BF9\u63A5</h3>
      <p>\u82E5\u81EA\u5DF1\u5728\u5883\u5916 VPS \u901A\u8FC7 Docker \u90E8\u7F72\u4E86 <code>v03413/BEpusdt</code> \u72EC\u7ACB\u7F51\u5173\uFF1A</p>
      <ol>
        <li>\u5728\u670D\u52A1\u5668\u542F\u52A8\uFF1A<code>docker run -d --name bepusdt -p 8000:8000 -v /root/bepusdt:/data v03413/bepusdt:latest</code></li>
        <li>\u8FDB\u5165 BEpusdt \u540E\u53F0\u914D\u7F6E\u94B1\u5305\u5730\u5740\uFF0C\u5728\u300C\u7CFB\u7EDF\u7BA1\u7406 \u2192 \u57FA\u672C\u8BBE\u7F6E \u2192 API \u8BBE\u7F6E\u300D\u590D\u5236<b>\u5BF9\u63A5\u4EE4\u724C</b>\u3002</li>
        <li>\u5728 epay \u540E\u53F0\u6E20\u9053\u9009 <code>BEpusdt(\u52A0\u5BC6\u8D27\u5E01)</code>\uFF0C\u586B\u5165\u670D\u52A1\u57DF\u540D\u4E0E\u5BF9\u63A5\u4EE4\u724C\u5373\u53EF\u3002</li>
      </ol>
    </div>

    <div class="section" id="monitors">
      <h2>\u591A\u7AEF\u76D1\u63A7\u751F\u6001</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>\u5BA2\u6237\u7AEF</th><th>\u5B9E\u73B0\u8DEF\u5F84</th><th>\u8FD0\u884C\u73AF\u5883</th></tr></thead>
          <tbody>
            <tr><td><b>\u5B89\u5353 App</b></td><td><code>agent/android</code> \u539F\u751F Kotlin\uFF0C\u81EA\u52A8\u76D1\u63A7\u7CFB\u7EDF\u901A\u77E5</td><td>\u5B89\u5353\u624B\u673A / \u4E91\u624B\u673A</td></tr>
            <tr><td><b>\u684C\u9762\u5B88\u62A4\u7AEF</b></td><td><code>agent/desktop/vmq_agent.py</code> \u5355\u6587\u4EF6 Python</td><td>Windows / macOS / Linux</td></tr>
            <tr><td><b>OneBot \u534F\u8BAE\u7AEF</b></td><td>NapCat / LLOneBot HTTP \u4E0A\u62A5\u81F3 <code>/onebot/report</code></td><td>QQ \u673A\u5668\u4EBA\u6302\u673A\u670D\u52A1\u5668</td></tr>
            <tr><td><b>\u514D\u6302\u514DCK</b></td><td>\u540E\u53F0 alipaybill \u7ED1\u5B9A\u5F00\u653E\u5E73\u53F0\u5B98\u65B9 APPID \u5BC6\u94A5</td><td>Cloudflare \u4E91\u7AEF\u65E0\u611F\u5BF9\u8D26</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" id="faq">
      <h2>\u5E38\u89C1\u63A5\u5165\u95EE\u9898</h2>
      <ol>
        <li><b>\u7B7E\u540D\u9519\u8BEF</b>\uFF1A\u8BF7\u6838\u5BF9\u662F\u5426\u8FC7\u6EE4\u4E86\u7A7A\u53C2\u6570\u3001\u662F\u5426\u5305\u542B <code>sign</code> \u4E0E <code>sign_type</code>\uFF0C\u4EE5\u53CA\u5B57\u6BCD\u6392\u5E8F\u662F\u5426\u9075\u5FAA\u4E25\u683C\u7684 ASCII \u7801\u5347\u5E8F\u3002</li>
        <li><b>\u6536\u4E0D\u5230\u56DE\u8C03\u901A\u77E5</b>\uFF1A\u8BF7\u786E\u4FDD <code>notify_url</code> \u662F\u516C\u7F51\u53EF\u89E3\u6790\u7684\u6709\u6548\u5730\u5740\uFF0C\u4E0D\u80FD\u4E3A <code>localhost</code> \u6216\u5E26\u5185\u7F51 IP\u3002</li>
        <li><b>\u54CD\u5E94\u683C\u5F0F</b>\uFF1A\u5546\u6237\u63A5\u6536\u5230\u901A\u77E5\u5904\u7406\u5B8C\u6BD5\u540E\uFF0CHTTP \u54CD\u5E94\u5185\u5BB9\u5FC5\u987B\u4E3A\u7EAF\u6587\u672C\u5B57\u7B26\u4E32 <code>success</code>\uFF0C\u4E0D\u53EF\u9644\u52A0 HTML \u6807\u7B7E\u6216\u6362\u884C\u3002</li>
      </ol>
    </div>
  </div>
</div>

</body></html>`)});I.use("/admin/api/*",async(e,t)=>{if(!await Gs(e.env,e.req.raw))return e.json({code:403,msg:"\u672A\u767B\u5F55"},403);await t()});I.get("/admin/api/export",async e=>{let t=parseInt(e.req.query("days")||"30",10),r=v()-t*86400,n=await yo(r,5e3),o="\u5E73\u53F0\u8BA2\u5355\u53F7,\u5546\u6237\u8BA2\u5355\u53F7,\u5546\u6237ID,\u652F\u4ED8\u65B9\u5F0F,\u5546\u54C1\u540D\u79F0,\u8BA2\u5355\u91D1\u989D(\u5143),\u5B9E\u4ED8(\u5143),\u72B6\u6001,\u4E0B\u5355\u65F6\u95F4,\u652F\u4ED8\u65F6\u95F4",a=["\u5F85\u652F\u4ED8","\u5DF2\u652F\u4ED8","\u5DF2\u9000\u6B3E","\u5DF2\u5B8C\u6210"],s=(n||[]).map(c=>[c.trade_no,c.out_trade_no,c.uid,c.type,`"${String(c.name||"").replace(/"/g,'""')}"`,$(Number(c.money)),$(Number(c.realmoney)),a[Number(c.status)]||c.status,c.addtime?new Date(Number(c.addtime)*1e3).toLocaleString("zh-CN"):"",c.endtime?new Date(Number(c.endtime)*1e3).toLocaleString("zh-CN"):""].join(",")),i="\uFEFF"+[o,...s].join(`\r
`);return new Response(i,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="orders_${t}d.csv"`}})});I.get("/admin/api/buyerstat",async e=>{let t=await wo(0),r=new Map;for(let o of t){if(!o.ip)continue;let a=r.get(o.ip)||{ip:o.ip,n:0,total:0,last:0};a.n+=1,a.total+=o.money,a.last=Math.max(a.last,o.addtime||0),r.set(o.ip,a)}let n=[...r.values()].sort((o,a)=>a.n-o.n).slice(0,100);return e.json({code:0,data:n})});I.get("/admin/api/trend",async e=>{let t=await xo(7);return e.json({code:0,data:t})});I.get("/admin/api/groups",async e=>e.json({code:0,data:await ro()}));I.post("/admin/api/groups",async e=>{let t=await e.req.json();return await no({id:t.id,name:t.name,rate:t.rate}),e.json({code:0})});I.post("/admin/api/groups/delete",async e=>{let{id:t}=await e.req.json();if(t===1)return e.json({code:-1,msg:"\u9ED8\u8BA4\u5206\u7EC4\u4E0D\u53EF\u5220\u9664"});for(let r of await Qn(t))await Ce(r,{gid:1});return await oo(t),e.json({code:0})});I.post("/admin/api/rsa/generate",async e=>{let{publicPem:t,privatePem:r}=await Io();return await Ee("rsa_public",t),await Ee("rsa_private",r),e.json({code:0,data:{publicPem:t}})});I.get("/admin/api/rsa",async e=>e.json({code:0,data:{publicPem:await q("rsa_public")||""}}));I.get("/admin/api/certs",async e=>{let r=(await Yn(1)).map(n=>({uid:n.uid,username:n.username,cert:n.cert||0,cert_name:n.cert_name||"",cert_no:n.cert_no||""}));return e.json({code:0,data:r})});I.post("/admin/api/certs/review",async e=>{let{uid:t,status:r}=await e.req.json();return await Ce(t,{cert:r}),e.json({code:0})});I.post("/admin/api/settles/pay",async e=>{let{id:t,account:r,name:n}=await e.req.json(),o=await ot(t),a=o?await ue(o.uid):null,s=o?{...o,username:a?.username||""}:null;if(!s)return e.json({code:-1,msg:"\u8BB0\u5F55\u4E0D\u5B58\u5728"});if(s.status!==0)return e.json({code:-1,msg:"\u5DF2\u5904\u7406"});let i=await ee("alipayf2f",!0),c="";for(let l of i)try{let u=JSON.parse(l.config||"{}");if(u.enable_transfer==="1"){c=JSON.stringify(u);break}}catch{}if(!c)return e.json({code:-1,msg:"\u6CA1\u6709\u542F\u7528\u81EA\u52A8\u6253\u6B3E\u7684\u652F\u4ED8\u5B9D\u6E20\u9053"});let d=await Do(c,"ST"+s.id+"_"+v(),$(s.amount),r,n||s.username,"\u7ED3\u7B97\u6253\u6B3E");return d.ok?(await $t(t,{status:1,note:`\u652F\u4ED8\u5B9D\u8F6C\u8D26\u5355\u53F7 ${d.orderNo||""}`}),e.json({code:0,msg:"\u6253\u6B3E\u6210\u529F"})):e.json({code:-1,msg:"\u6253\u6B3E\u5931\u8D25: "+d.msg})});I.get("/admin/api/plugins",e=>e.json({code:0,data:at().map(t=>({id:t.id,name:t.name,types:t.types,inputs:t.inputs,help:t.help}))}));pe();N();fe();K();var dt=new B;dt.all("/appHeart",async e=>{let t=e.req.query("t")||"",r=e.req.query("sign")||"",n=await ee("vmq",!0),o=!1;for(let a of n)try{let s=JSON.parse(a.config||"{}").key;s&&(0,D.default)(t+s)===r&&(o=!0)}catch{}return o?e.json({code:1,msg:"\u6210\u529F"}):e.json({code:-1,msg:"\u7B7E\u540D\u6821\u9A8C\u9519\u8BEF"})});dt.all("/getState",async e=>{let t=e.req.query("t")||"",r=e.req.query("sign")||"",n=await ee("vmq",!0),o=!1;for(let a of n)try{let s=JSON.parse(a.config||"{}").key;s&&(0,D.default)(t+s)===r&&(o=!0)}catch{}return o?e.json({code:1,msg:"\u6210\u529F",data:{state:"1",lastheart:String(v()),lastpay:String(v())}}):e.json({code:-1,msg:"\u7B7E\u540D\u6821\u9A8C\u4E0D\u901A\u8FC7"})});dt.all("/appPush",async e=>{let t={};if(new URL(e.req.url).searchParams.forEach((g,k)=>t[k]=g),e.req.method==="POST")try{(await e.req.raw.formData()).forEach((k,C)=>t[C]=String(k))}catch{}let r=t.type||"",n=t.price||"",o=t.t||"",a=t.sign||"",s=Math.abs(parseInt(o,10)-Date.now());if(!o||s>50*1e3)return e.json({code:-1,msg:"\u5BA2\u6237\u7AEF\u65F6\u95F4\u9519\u8BEF"});let i=await ee("vmq",!0),c=0;for(let g of i)try{let k=JSON.parse(g.config||"{}").key;k&&(0,D.default)(`${r}${n}${o}${k}`)===a&&(c=g.id)}catch{}if(!c)return e.json({code:-1,msg:"\u7B7E\u540D\u6821\u9A8C\u9519\u8BEF"});let l={1:"wxpay",2:"alipay",3:"qqpay",4:"usdt"}[r]||"",u=O(n);if(!l||!u)return e.json({code:1,msg:"\u6210\u529F"});let b=await V({type:l,channelIds:i.map(g=>g.id),from:v()-86400,order:"asc",limit:50});for(let g of b){if((g.pay_amount?O(String(g.pay_amount)):g.money)!==u)continue;if(await Q(e.env,g.trade_no,u,"VMQAPP"+o)){let P=await M(g.trade_no);P&&e.executionCtx.waitUntil(W(e.env,P))}return e.json({code:1,msg:"\u6210\u529F"})}return e.json({code:1,msg:"\u6210\u529F"})});ce();N();fe();K();var Lr=new B;function Js(e){let t=[],r=/(?:[¥￥]\s*|(\d+(?:\.\d{1,2})?)\s*元)/g,n;for(;n=r.exec(e);){let o=O(n[1]||n[0].replace(/[¥￥\s元]/g,""));o>0&&t.push(o)}return t}Lr.post("/onebot/report",async e=>{let t=e.req.query("token")||"",r=await q("onebot_token")||"";if(!r||t!==r)return e.json({status:"forbidden"},403);let n=await e.req.json().catch(()=>({})),o=String(n.raw_message??n.post_content??"");if(!o&&Array.isArray(n.message))for(let i of n.message)i.type==="text"&&(o+=String(i.data?.text||""));if(!o)return e.json({status:"ignored"});if(!/转账|收款|到账|红包|QQ钱包|钱包/.test(o))return e.json({status:"ignored"});let a=Js(o);if(!a.length)return e.json({status:"ignored"});let s=await V({type:"qqpay",from:v()-86400,order:"asc",limit:50});for(let i of s){let c=i.pay_amount?O(String(i.pay_amount)):i.money;if(!a.includes(c))continue;if(await Q(e.env,i.trade_no,c,"ONEBOT"+v())){let l=await M(i.trade_no);l&&e.executionCtx.waitUntil(W(e.env,l))}return e.json({status:"ok"})}return e.json({status:"no_match"})});de(sa);de(Zo);de(da);de(la);de(Bo);de(fa);de(ma);de(ga);de(ha);var re=new B;re.route("/",me);re.route("/",it);re.route("/admin",U);re.route("/user",X);re.route("/",Fe);re.route("/",I);re.route("/",dt);re.route("/",Lr);re.onError((e,t)=>{let r=e;return r.code==="STORE_CONFIG_MISSING"?t.text(`\u5B58\u50A8\u672A\u5C31\u7EEA\uFF08EdgeOne Blob\uFF09

${r.message}

${r.hint||""}`,503):(console.error("[app] unhandled error:",e),t.text("Internal Server Error",500))});re.all("*",e=>e.text("Not Found",404));var ya={async fetch(e,t,r){return re.fetch(e,t,r)}};var Ft=new Set;function Fs(){return{waitUntil(e){let t=Promise.resolve(e).catch(()=>{});Ft.add(t),t.finally(()=>Ft.delete(t))},passThroughOnException(){}}}function Ys(e){let t=e.env??{},r=typeof process<"u"?process.env:{},n={};for(let[o,a]of Object.entries(r))typeof a=="string"&&(n[o]=a);for(let[o,a]of Object.entries(t))typeof a=="string"&&(n[o]=a);return n}function ba(e){return{ADMIN_SECRET:e.ADMIN_SECRET||void 0,SITE_NAME:e.SITE_NAME||void 0}}async function wa(e){let t=e.request,r=(t.method||"GET").toUpperCase(),n=new Headers(t.headers);e.clientIp&&!n.get("cf-connecting-ip")&&n.set("cf-connecting-ip",e.clientIp);let o=String(e.geo?.countryCode??e.geo?.country??"").toUpperCase();if(o&&!n.get("cf-ipcountry")&&n.set("cf-ipcountry",o),r==="GET"||r==="HEAD")return new Request(t.url,{method:r,headers:n});try{let a=await t.arrayBuffer();return new Request(t.url,{method:r,headers:n,body:a.byteLength?a:void 0})}catch{return new Request(t.url,{method:r,headers:n})}}async function Qs(e,t){let n=new URL(e.url).searchParams.get("token")||e.headers.get("x-cron-token")||"",o=await aa(n,t.CRON_TOKEN||"");if(o)return o;let a=await Jt(ba(t));return Response.json({code:0,data:a})}async function Ws(e){let t=Ys(e),r=e.request;if(new URL(r.url).pathname==="/api/cron/tick")return Qs(await wa(e),t);let o=await wa(e),a=await ya.fetch(o,ba(t),Fs());return Ft.size>0&&await Promise.race([Promise.allSettled([...Ft]),new Promise(s=>setTimeout(s,300))]),a}var Iu={onRequest:Ws};export{Iu as default,Ws as onRequest};
