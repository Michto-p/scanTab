import {readFile} from 'node:fs/promises';

// Une photo publique, gardée localement avec attribution, évite de limiter la
// recette aux dessins. Les cibles sont géométriques et ne valident aucun produit.
export async function runRealPhotoBrowserTests({evaluate,appBase='/app/'}){
  const [bytes,source]=await Promise.all([
    readFile(new URL('./photos/armoire-domotique-commons.jpg',import.meta.url)),
    readFile(new URL('./photos/armoire-domotique-commons.annotations.json',import.meta.url),'utf8')
  ]);
  const result=await evaluate(`(${checkRealPhoto.toString()})(${JSON.stringify({imageURL:'data:image/jpeg;base64,'+bytes.toString('base64'),annotation:JSON.parse(source),appBase})})`);
  if(result.status!=='pass')throw Error('Régression sur la photo publique : '+JSON.stringify(result));
  return result;
}

export async function runRealPhotoUIBrowserTests({evaluate,appBase='/app/',timeoutMs=120000}){
  const [bytes,source]=await Promise.all([
    readFile(new URL('./photos/armoire-domotique-commons.jpg',import.meta.url)),
    readFile(new URL('./photos/armoire-domotique-commons.annotations.json',import.meta.url),'utf8')
  ]);
  await evaluate(`(${startRealPhotoUI.toString()})(${JSON.stringify({base64:bytes.toString('base64'),annotation:JSON.parse(source),appBase})})`);
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){
    const result=await evaluate('window.__realPhotoQA || null');
    if(result&&result.status!=='pending'){
      if(result.status!=='pass')throw Error('Parcours photo réelle : '+JSON.stringify(result));
      return result;
    }
    await new Promise(done=>setTimeout(done,150));
  }
  throw Error('La lecture de la photo réelle a dépassé le délai de recette.');
}

function startRealPhotoUI({base64,annotation,appBase}){
  const qa=window.__realPhotoQA={status:'pending',tests:[]},automatic=document.querySelector('#auto-after-photo'),previous=automatic.checked;
  void(async()=>{
    try{
      const {loadSession}=await import(new URL(appBase+'base/store.js',location.href));
      const {homography,mapPoint}=await import(new URL(appBase+'pretraitement/geometry.js',location.href));
      automatic.checked=true;automatic.dispatchEvent(new Event('change',{bubbles:true}));
      const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),input=document.querySelector('#import-file'),transfer=new DataTransfer();
      transfer.items.add(new File([bytes],'armoire-domotique-commons.jpg',{type:'image/jpeg'}));input.files=transfer.files;
      const started=performance.now();input.dispatchEvent(new Event('change',{bubbles:true}));
      while(document.querySelector('#workspace').getAttribute('aria-busy')==='true')await new Promise(done=>setTimeout(done,100));
      const prepared=await loadSession(document.querySelector('#saved-photos').value);
      if(!prepared.rectified||prepared.devices.length||!prepared.candidates.length)throw Error('Le cadrage doit attendre la sélection sans lire les zones proposées.');
      qa.tests.push({nom:'La photo réelle est cadrée et proposée sans découpe ni OCR implicites',succes:true});
      document.querySelector('[data-action="select-all"]').click();
      while(document.querySelector('#workspace').getAttribute('aria-busy')==='true')await new Promise(done=>setTimeout(done,25));
      document.querySelector('#read-selection').click();
      while(document.querySelector('#workspace').getAttribute('aria-busy')==='true')await new Promise(done=>setTimeout(done,100));
      qa.ms=Math.round(performance.now()-started);
      const session=await loadSession(document.querySelector('#saved-photos').value);
      if(!session?.rectified||!session.devices.length)throw Error('Le parcours ne fournit pas de vignettes : '+document.querySelector('#message').textContent);
      const bitmap=await createImageBitmap(session.rectified),transform=homography(session.appliedPoints,bitmap.width,bitmap.height);bitmap.close();
      for(const region of annotation.regions){
        const found=session.devices.filter(device=>{
          const r=device.rect,center=mapPoint(transform,r.x+r.width/2,r.y+r.height/2);
          return center.x>=region.left&&center.x<=region.right&&center.y>=region.top&&center.y<=region.bottom;
        });
        qa.tests.push({nom:region.nom+' : cadrage puis découpe et lecture explicitement choisies sans PC',succes:found.length>=8,appareils:found.length});
      }
      const unvalidated=session.devices.every(d=>!d.validatedAt&&!d.validatedBy&&d.blob instanceof Blob&&d.recognition?.moteur==='tesseract-embarque');
      qa.tests.push({nom:'Toutes les vignettes réelles passent à la lecture locale et restent à vérifier',succes:unvalidated,appareils:session.devices.length});
      qa.status=qa.tests.every(t=>t.succes)?'pass':'fail';
    }catch(error){qa.status='fail';qa.error=error.message;}
    finally{automatic.checked=previous;automatic.dispatchEvent(new Event('change',{bubbles:true}));}
  })();return true;
}

async function checkRealPhoto({imageURL,annotation,appBase}){
  const tests=[],{calculateImage}=await import(new URL(appBase+'pretraitement/calcul.js',location.href));
  const image=new Image();image.src=imageURL;await image.decode();
  if(image.naturalWidth!==annotation.width||image.naturalHeight!==annotation.height)throw Error('Les dimensions de la photo publique diffèrent de ses annotations de recette.');
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const started=performance.now(),result=await calculateImage('rangées',context.getImageData(0,0,canvas.width,canvas.height)),ms=Math.round(performance.now()-started);
  for(const region of annotation.regions){
    const candidates=result.candidates.filter(c=>{
      const middle=(c.top+c.bottom)/2;
      return Number.isFinite(c.modules)&&c.modules>0&&middle>=region.top&&middle<=region.bottom&&c.left>=region.left-8&&c.right<=region.right+8;
    }).sort((a,b)=>a.left-b.left);
    // Une grande boîte englobante ne vaut pas une rangée d'appareils séparés.
    let extent=0,end=region.left,overlap=false;
    for(const c of candidates){
      if(c.left<end-3)overlap=true;
      const left=Math.max(region.left,c.left,end),right=Math.min(region.right,c.right);
      extent+=Math.max(0,right-left);end=Math.max(end,c.right);
    }
    const coverage=extent/(region.right-region.left),pass=candidates.length>=8&&coverage>=.7&&!overlap;
    tests.push({nom:region.nom+' : appareils séparés malgré le coffret voisin',succes:pass,appareils:candidates.length,couverture:Number(coverage.toFixed(3)),chevauchement:overlap});
  }
  return {status:tests.every(t=>t.succes)?'pass':'fail',tests,ms,limites:annotation.limites};
}
