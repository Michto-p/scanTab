import {readFile} from 'node:fs/promises';

// Les vrais pixels sont inclinés de 12°. Le contour externe est celui des
// annotations, saisi comme repère humain : ce test n'évalue pas le détecteur.
export async function runCalibrationBrowserTests({evaluate,call,appBase='/app/'}){
  const filename='tableau-abb-plastron-rotation12';
  const [bytes,annotation]=await Promise.all([
    readFile(new URL('./photos/'+filename+'.png',import.meta.url)),
    readFile(new URL('./photos/'+filename+'.annotations.json',import.meta.url),'utf8').then(JSON.parse)
  ]);
  const faces=annotation.appareils,points=[faces[0].quad[0],faces.at(-1).quad[1],faces.at(-1).quad[2],faces[0].quad[3]];
  const reference=faces.find(face=>face.id==='simple-b16-3').quad;
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const [first,second]=[midpoint(reference[0],reference[3]),midpoint(reference[1],reference[2])];
  const tests=[],deadlineMs=30000;
  const until=async(expression,label)=>{
    const deadline=Date.now()+deadlineMs;
    while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,80));}
    throw Error(label+' : '+await evaluate('document.querySelector("#message")?.textContent'));
  };
  const idle=()=>until('document.querySelector("#workspace").getAttribute("aria-busy")!=="true"','La calibration ne libère pas l’interface');
  const click=async selector=>{
    await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)throw Error('Commande indisponible : '+${JSON.stringify(selector)});node.click();})()`);
    await idle();
  };
  const openFine=()=>evaluate(`(()=>{document.querySelector('#manual-rows').closest('details').open=true;})()`);
  const tap=async point=>{
    const screen=await evaluate(`(()=>{const c=document.querySelector('#photo-canvas');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect(),v=JSON.parse(c.dataset.view),p=${JSON.stringify(point)};return {x:r.left+(p.x-v.x)/v.width*r.width,y:r.top+(p.y-v.y)/v.height*r.height};})()`);
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...screen,id:1,radiusX:2,radiusY:2}]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await idle();
  };
  const assert=async(name,expression)=>{
    const value=await evaluate(expression);
    if(value!==true)throw Error(name+' : '+JSON.stringify(value));
    tests.push({nom:name,succes:true});
  };
  await evaluate(`(async()=>{
    const {saveSession,loadSession}=await import(new URL(${JSON.stringify(appBase+'base/store.js')},location.href));
    const raw=atob('${bytes.toString('base64')}'),blob=new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'image/png'});
    const points=${JSON.stringify(points)},width=${annotation.width},height=${annotation.height},full=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
    const id='recette-calibration-'+crypto.randomUUID();
    await saveSession({id,seance:id,name:'Calibration réelle inclinée',original:blob,rectified:blob,width,height,points:full,appliedPoints:full,pointsSource:'manuel',rows:[{points,left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)),modules:1,cuts:[0,1],calibrationConfirmed:false}],candidates:[],devices:[],geometryDirty:false,cutsDirty:false});
    const select=document.querySelector('#saved-photos'),option=document.createElement('option');option.value=id;option.textContent='Calibration annotée';select.append(option);select.value=id;
    const errors=[],error=event=>errors.push(event.message||event.reason?.message||String(event.reason));
    addEventListener('error',error);addEventListener('unhandledrejection',error);
    window.__calibrationQA={id,errors,error,load:()=>loadSession(id)};
  })()`);
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  try{
    await click('[data-action="open"]');await openFine();
    await click('[data-action="calibrate-row"][data-index="0"]');
    await tap(first);
    await assert('Le premier toucher seul n’invente aucune échelle',`(async()=>{const s=await window.__calibrationQA.load();return s.rows[0].calibrationConfirmed===false&&s.rows[0].scale==null;})()`);
    await tap(second);
    await assert('Deux bords annotés d’un appareil de 18 mm calibrent dix modules dans la rangée inclinée',`(async()=>{const s=await window.__calibrationQA.load(),r=s.rows[0];return r.calibrationConfirmed===true&&Math.abs(r.modules-10)<=.5&&r.scale.source==='repere-18-mm'&&r.scale.plane==='rangee-redressee'&&Math.abs(r.scale.pixelsPerMillimeter-r.scale.pixelsPerModule/18)<1e-9&&JSON.stringify(r.points)===${JSON.stringify(JSON.stringify(points))};})()`);
    await assert('Les joints visibles sont conservés sans partager l’appareil large à chaque module',`(async()=>{const s=await window.__calibrationQA.load(),r=s.rows[0];return r.cuts.length>=5&&r.cuts[0]===0&&r.cuts.at(-1)===r.modules&&r.cuts.includes(4)&&!r.cuts.includes(1)&&!r.cuts.includes(2)&&!r.cuts.includes(3)&&s.devices.length===0;})()`);
    // Une saisie identique conserve les joints et recalcule les deux unités.
    const cuts=await evaluate('(async()=>JSON.stringify((await window.__calibrationQA.load()).rows[0].cuts))()');
    await evaluate(`(()=>{const input=document.querySelector('[data-row="0"][data-modules]');input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`(async()=>{const r=(await window.__calibrationQA.load()).rows[0];return r.scale.source==='nombre-confirme';})()`,'La largeur saisie n’est pas sauvegardée');
    await assert('Confirmer le total conserve les joints et une conversion en millimètres cohérente',`(async()=>{const r=(await window.__calibrationQA.load()).rows[0];return JSON.stringify(r.cuts)===${JSON.stringify(cuts)}&&Math.abs(r.scale.pixelsPerMillimeter-r.scale.pixelsPerModule/18)<1e-9;})()`);
    await openFine();await click('[data-action="calibrate-row"][data-index="0"]');await tap(first);
    // Changer d’étape annule le repère incomplet et laisse la rangée intacte.
    await click('[data-step="perspective"]');await click('[data-step="rows"]');
    await assert('Quitter le repère incomplet conserve les coupes sans exception',`(async()=>{const s=await window.__calibrationQA.load();return JSON.stringify(s.rows[0].cuts)===${JSON.stringify(cuts)}&&window.__calibrationQA.errors.length===0;})()`);
    await openFine();await click('[data-action="calibrate-row"][data-index="0"]');await tap(first);
    await click('[data-action="remove-row"][data-index="0"]');
    await until('(async()=>(await window.__calibrationQA.load()).rows.length===0)()','Le retrait de la rangée n’est pas sauvegardé');
    await assert('Retirer la rangée en cours de repère ne laisse aucun état de calibration orphelin',`(async()=>{const s=await window.__calibrationQA.load();return s.rows.length===0&&window.__calibrationQA.errors.length===0;})()`);
    await click('[data-action="add-row"]');
    await assert('Une nouvelle rangée reste utilisable après le retrait',`document.querySelectorAll('.row-editor').length===1&&window.__calibrationQA.errors.length===0`);
    return {status:'pass',tests,source:filename+'.png',limites:'Pixels photographiques réellement inclinés ; contour fourni par les annotations pour isoler la calibration humaine, sans évaluer le détecteur ni l’OCR.'};
  }finally{
    await call('Emulation.setTouchEmulationEnabled',{enabled:false}).catch(()=>{});
    await evaluate(`(()=>{const q=window.__calibrationQA;if(q){removeEventListener('error',q.error);removeEventListener('unhandledrejection',q.error);}})()`).catch(()=>{});
  }
}
