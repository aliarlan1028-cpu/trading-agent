import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const chromeBinary=process.env.CHROME_BIN||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function freePort(){return await new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const value=server.address().port;server.close(()=>resolve(value));});});}
async function waitFor(url,predicate=()=>true){const end=Date.now()+20_000;let last;while(Date.now()<end){try{const response=await fetch(url);if(response.ok){const value=url.endsWith("/json")?await response.json():await response.text();if(predicate(value))return value;}}catch(error){last=error;}await delay(80);}throw last||new Error(`Timed out waiting for ${url}`);}
function connect(url){const socket=new WebSocket(url);const pending=new Map();let id=0;socket.on("message",(payload)=>{const message=JSON.parse(payload.toString());if(message.method==="Runtime.exceptionThrown")console.error("[browser exception]",message.params?.exceptionDetails?.exception?.description||message.params?.exceptionDetails?.text);const task=pending.get(message.id);if(!task)return;pending.delete(message.id);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result);});const ready=new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});return{async send(method,params={}){await ready;const request=++id;return await new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});socket.send(JSON.stringify({id:request,method,params}));});},close(){socket.close();}};}
async function evaluate(cdp,expression){const result=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function waitExpression(cdp,expression,label){const end=Date.now()+20_000;while(!await evaluate(cdp,`Boolean(${expression})`)){if(Date.now()>end)throw new Error(`Timed out waiting for ${label}`);await delay(60);}}
async function viewport(cdp,url,width,height){await cdp.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<800,screenWidth:width,screenHeight:height});await cdp.send("Page.navigate",{url});await waitExpression(cdp,"window.__zeroBaseAuthReady","auth harness");}
async function click(cdp,selector){await waitExpression(cdp,`document.querySelector(${JSON.stringify(selector)})`,`click ${selector}`);const point=await evaluate(cdp,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:"center"});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});await delay(100);}
async function type(cdp,selector,value){await click(cdp,selector);await cdp.send("Input.insertText",{text:value});await delay(60);}
async function capture(cdp,name){const dir=process.env.KORDYN_ZERO_BASE_AUTH_SCREENSHOT_DIR;if(!dir)return;await mkdir(dir,{recursive:true});const shot=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});await writeFile(path.join(dir,`${name}.png`),Buffer.from(shot.data,"base64"));}
async function geometry(cdp,selector){return await evaluate(cdp,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const r=n.getBoundingClientRect();return{width:r.width,height:r.height,right:r.right,bottom:r.bottom,document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],body:[document.body.clientWidth,document.body.scrollWidth]};})()`);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode)return;const done=new Promise((resolve)=>child.once("exit",resolve));child.kill("SIGTERM");await Promise.race([done,delay(2000)]);if(child.exitCode===null&&!child.signalCode)child.kill("SIGKILL");}

const vitePort=await freePort(),chromePort=await freePort();
const profile=await mkdtemp(path.join(os.tmpdir(),"kordyn-zero-auth-"));
const vite=spawn("npm",["exec","vite","--","--host","127.0.0.1","--port",String(vitePort)],{cwd:rootDir,stdio:"ignore"});
const chrome=spawn(chromeBinary,["--headless=new","--disable-background-networking","--disable-extensions","--disable-gpu","--no-default-browser-check","--no-first-run",`--remote-debugging-port=${chromePort}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
let cdp;
try{
  const base=`http://127.0.0.1:${vitePort}/tests/zero-base-auth-browser.html`;
  await waitFor(base);const targets=await waitFor(`http://127.0.0.1:${chromePort}/json`,(rows)=>rows.some((row)=>row.type==="page"));cdp=connect(targets.find((row)=>row.type==="page").webSocketDebuggerUrl);await Promise.all([cdp.send("Runtime.enable"),cdp.send("Page.enable")]);
  const responsive=[];
  for(const [width,height] of [[1440,900],[390,844],[430,932]]){
    await viewport(cdp,`${base}?surface=native`,width,height);await waitExpression(cdp,"document.querySelector('.nativeAuthPortal')","native portal");const proof=await geometry(cdp,".nativeAuthPortal");assert.equal(proof.document[0],proof.document[1]);assert.equal(proof.body[0],proof.body[1]);responsive.push({width,height,portalWidth:proof.width,overflow:false});await capture(cdp,`auth-native-${width}`);
  }
  await type(cdp,'input[type="email"]',"owner@example.com");await type(cdp,'input[autocomplete="current-password"]',"secret-password");await click(cdp,".nativeAuthFormTools button");await type(cdp,'input[autocomplete="one-time-code"]',"123456");await click(cdp,'.nativeAuthPrimary[type="submit"]');await waitExpression(cdp,"window.__zeroBaseAuthCalls.some(row=>row[0]==='login'&&row[1].totp==='123456')","MFA login payload");
  await click(cdp,'.nativeAuthModeTabs button:nth-child(2)');await waitExpression(cdp,"document.querySelector('.nativePlanList')","registration mode");assert.equal(await evaluate(cdp,"document.querySelectorAll('.nativePlanList>button').length"),2);await capture(cdp,"auth-native-430-register");
  await viewport(cdp,`${base}?surface=web`,1440,900);await evaluate(cdp,"window.postMessage({type:'lp-start',mode:'login'},'*')");await waitExpression(cdp,"document.querySelector('.lpModal')","marketing auth modal");const web=await geometry(cdp,".lpModal");assert.equal(web.document[0],web.document[1]);await capture(cdp,"auth-web-1440-modal");
  console.log(JSON.stringify({result:"PASS",responsive,interactions:["login","MFA","registration","marketing-auth-modal"],webModal:{width:web.width,overflow:false}},null,2));
}finally{cdp?.close();await Promise.all([stop(chrome),stop(vite)]);await rm(profile,{recursive:true,force:true});}
