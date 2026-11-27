import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const box=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
function metrics(actual,expected){
  const a=box(actual),b=box(expected),intersection=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  return {iou:intersection/((a.right-a.left)*(a.bottom-a.top)+(b.right-b.left)*(b.bottom-b.top)-intersection),height:(a.bottom-a.top)/(b.bottom-b.top)};
}

// Photo publique réelle avec plastron. Les repères sont externes au détecteur.
export async function runFacadeBrowserTests({evaluate,call,appBase='/app/'}){
  const filename='tableau-abb-plastron-commons';
  const [bytes,annotation]=await Promise.all([readFile(new URL('./photos/'+filename+'.jpg',import.meta.url)),readFile(new URL('./photos/'+filename+'.annotations.json',import.meta.url),'utf8').then(JSON.parse)]);
  const tests=[],until=async(expression,label)=>{
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,100));}
    throw Error(label+' : '+await evaluate('document.querySelector("#message").textContent'));
  };
  const idle=()=>until('document.querySelector("#workspace").getAttribute("aria-busy")!=="true"','Analyse non terminée');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await idle();};
  await evaluate(`(async()=>{
    const {loadSession}=await import(new URL(${JSON.stringify(appBase+'base/store.js')},location.href));
    window.__facades={load:()=>loadSession(document.querySelector('#saved-photos').value)};
    const automatic=document.querySelector('#auto-after-photo');automatic.checked=true;automatic.dispatchEvent(new Event('change',{bubbles:true}));
    const raw=atob('${bytes.toString('base64')}'),blob=new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'image/jpeg'}),dt=new DataTransfer();dt.items.add(new File([blob],${JSON.stringify(filename+'.jpg')},{type:'image/jpeg'}));
    const input=document.querySelector('#import-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);await idle();
  const detected=await evaluate('(async()=>{const s=await window.__facades.load();return {candidates:s.candidates,rows:s.rows,devices:s.devices.length};})()');
  if(detected.devices!==0)throw Error('Une photo doit être sélectionnée avant OCR.');
  const match=candidates=>annotation.appareils.map(expected=>{
    const best=candidates.map((candidate,index)=>({index,candidate,...metrics(candidate.points??[],expected.quad)})).sort((a,b)=>b.iou-a.iou)[0];
    return {id:expected.id,expected:expected.modulesRelatifsVisuels,...best};
  });
  let matched=match(detected.candidates);
  const overlay=await evaluate(`(async()=>{
    const s=await window.__facades.load(),bitmap=await createImageBitmap(s.original),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const draw=(points,color)=>{ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();};
    for(const expected of ${JSON.stringify(annotation.appareils)})draw(expected.quad,'#00cf57');
    for(const candidate of s.candidates)if(candidate.points)draw(candidate.points,'#e52449');
    return c.toDataURL('image/png').split(',')[1];
  })()`);
  await writeFile(resolve('.local/recette-facades-abb.png'),Buffer.from(overlay,'base64'));
  await writeFile(resolve('.local/recette-facades-abb.json'),JSON.stringify({detected,matched},null,2));
  if(detected.candidates.length!==7||matched.some(m=>!m.candidate||m.iou<.75||m.height<.9||m.height>1.13)||new Set(matched.map(m=>m.index)).size!==7)throw Error('Contours réels insuffisants : '+JSON.stringify(matched.map(({id,iou,height,index})=>({id,iou,height,index})))+' ; '+detected.candidates.length+' propositions');
  tests.push({nom:'Photo avec plastron : sept façades complètes, dont un appareil large',succes:true,iouMin:Math.min(...matched.map(m=>m.iou))});
  if(matched.some(m=>m.candidate.modules!==null&&m.candidate.modules!==m.expected))throw Error('Fausse largeur automatique : '+JSON.stringify(matched.map(m=>({id:m.id,modules:m.candidate.modules,expected:m.expected}))));
  let widthSource='estimation';
  if(matched.some(m=>m.candidate.modules===null)){
    await click('[data-select-row="0"]');
    await evaluate(`(()=>{const input=document.querySelector('#selection-modules');input.value='10';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-action="preview-selection"]');
    const calibrated=await evaluate('(async()=>{const s=await window.__facades.load();return s.candidates;})()');
    matched=match(calibrated);widthSource='total confirmé : 10 modules';
    if(calibrated.length!==7||matched.some(m=>m.iou<.75||m.candidate.modules!==m.expected))throw Error('Le total confirmé ne retrouve pas les sept appareils : '+JSON.stringify(matched.map(m=>({id:m.id,modules:m.candidate.modules,expected:m.expected,iou:m.iou}))));
    // La lecture suivante porte sur un seul appareil touché, pas sur toute la rangée.
    await evaluate(`document.querySelector('[data-action="select-all"]').click()`);await idle();
  }
  tests.push({nom:'Largeurs dans le plan redressé : quatre modules puis six appareils d’un module',succes:true,source:widthSource});
  // Sélection par un vrai pointeur, dans les coordonnées du canvas affiché.
  const selected=matched[1];
  const tap=await evaluate(`(()=>{const c=document.querySelector('#photo-canvas'),r=c.getBoundingClientRect(),v=JSON.parse(c.dataset.view),points=${JSON.stringify(selected.candidate.points)},p={x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4};return {x:r.left+(p.x-v.x)/v.width*r.width,y:r.top+(p.y-v.y)/v.height*r.height};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...tap});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...tap});
  await click('#read-selection');
  const reading=await evaluate(`(async()=>{const s=await window.__facades.load(),d=s.devices[0];if(!d)return null;const b=await createImageBitmap(d.blob);try{return {count:s.devices.length,quad:d.quad,width:b.width,height:b.height,imageSize:d.imageSize,labels:d.labels,validated:d.validatedAt,recognition:d.recognition};}finally{b.close();}})()`);
  if(!reading||reading.count!==1||!reading.quad||reading.height<430||reading.height!==reading.imageSize.height||reading.width!==reading.imageSize.width||reading.validated)throw Error('Vignette redressée ou validation incorrecte : '+JSON.stringify(reading));
  tests.push({nom:'La sélection crée un seul PNG redressé pleine résolution, non validé',succes:true,width:reading.width,height:reading.height});
  if(reading.labels.famille.valeur!=='disjoncteur'||reading.labels.calibre.valeur!=='16 A'||reading.labels.courbe.valeur!=='B')throw Error('Marquages B16 non lus sur la vraie façade : '+JSON.stringify(reading.recognition));
  tests.push({nom:'OCR embarqué sur la vraie façade : disjoncteur B16',succes:true,marque:reading.labels.marque.valeur});
  await writeFile(resolve('.local/recette-facades-abb-lecture.json'),JSON.stringify(reading,null,2));
  return {status:'pass',tests};
}
