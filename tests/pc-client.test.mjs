import test from 'node:test';
import assert from 'node:assert/strict';
import {localPCURL,createPCClient} from '../app/connexion/client.js';
test('L’adresse PC reste locale et ne contient pas d’identifiants ni de redirection',()=>{
  for(const address of ['http://192.168.1.20:8787','https://pc.local:8787','http://localhost:8787','https://[fd12::1]:8787'])assert.equal(localPCURL(address),new URL(address).origin);
  for(const address of ['https://example.com','http://172.32.0.1','http://192.169.1.2','https://pc.local/api','https://user:pass@pc.local','https://pc.local/?token=secret','file:///photo.png'])assert.throws(()=>localPCURL(address));
});
test('Aucun contact implicite ; envoi explicite sans cookies, cache ou suivi des redirections',async()=>{
  const calls=[];
  const client=createPCClient('http://127.0.0.1:8787','code-test-appairage-123456',{fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({application:'scan-tableau-pc',apiVersion:1})};}});
  assert.equal(calls.length,0);await client.status();
  assert.equal(calls[0].url,'http://127.0.0.1:8787/api/status');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.targetAddressSpace,'loopback');
  const blob=new Blob(['lot']);await client.sendBatch(blob);assert.equal(calls[1].options.body,blob);assert.equal(calls[1].options.headers['Content-Type'],'application/zip');
});
test('PC absent ou incompatible : erreur explicite, aucune file d’envoi automatique',async()=>{
  const client=createPCClient('http://localhost:8787','code-test-appairage-123456',{timeoutMs:5,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
  await assert.rejects(client.status(),/ne répond pas/);
  const wrong=createPCClient('http://localhost:8787','code-test-appairage-123456',{fetcher:async()=>({ok:true,json:async()=>({application:'autre'})})});await assert.rejects(wrong.status(),/pas compatible/);
});
