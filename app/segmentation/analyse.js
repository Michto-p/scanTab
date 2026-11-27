import {detectFacades} from './facades.js';
import {refineFacadeGroups} from './affinage.js';
import {analyzeLayout,segmentSelection} from './automatic.js';
import {groupFacadeRows,measureRectifiedFacades} from '../pretraitement/rangees.js';
import {warpPixels} from '../pretraitement/pixels.js';
import {homography,mapPoint} from '../pretraitement/geometry.js';

const half=value=>Math.round(value*2)/2;

/** Les contours fixent la découpe ; le pas modulaire est calculé ensuite. */
export function analyzeFacades(image,{modules=null}={}){
  if(modules!==null&&(!Number.isFinite(modules)||modules<.5||modules>100||half(modules)!==modules))throw Error('Nombre de modules invalide. Utilisez des demi-modules entre 0,5 et 100.');
  const detection=detectFacades(image),grouping=groupFacadeRows(refineFacadeGroups(image,detection.candidates),image);
  const warnings=[...detection.warnings,...grouping.warnings],rows=[],candidates=[];
  let surrounding=null;
  if(modules!==null&&grouping.rows.length>1)warnings.push('Plusieurs rangées visibles : le nombre de modules doit être confirmé pour une seule rangée.');
  for(const group of grouping.rows){
    const rowIndex=rows.length,b=group.bounds;
    const row={...group,left:b.x,right:b.x+b.width,top:b.y,bottom:b.y+b.height,modules:1,cuts:[0,1],calibrationConfirmed:false,scale:null};
    let measurement=null,pitch=null,confidence=0,source=null;
    if(group.points){
      measurement=measureRectifiedFacades(group);
      if(modules!==null&&grouping.rows.length===1){pitch=measurement.width/modules;confidence=1;source='nombre-confirme';}
      else{
        // La projection 1D ne fournit ici QUE le pas. Elle ne remplace jamais
        // les quatre côtés observés par une bande d'inscriptions plus courte.
        const straight=warpPixels(image,group.points),layout=analyzeLayout(straight);
        const scales=layout.rows.filter(r=>r.scale?.confidence>=.8).map(r=>r.scale).sort((a,b)=>b.confidence-a.confidence);
        // Le recadrage enlève parfois le fond qui permettait de mesurer le
        // pas. Réutiliser alors les joints de la même rangée dans la photo,
        // sous réserve qu'ils correspondent aux façades complètes trouvées.
        if(Math.abs(group.orientation)<=5){
          surrounding??=analyzeLayout(image);
          for(const context of surrounding.rows){
            const horizontal=Math.max(0,Math.min(row.right,context.right)-Math.max(row.left,context.left))/(row.right-row.left);
            const vertical=Math.max(0,Math.min(row.bottom,context.bottom)-Math.max(row.top,context.top))/(row.bottom-row.top);
            if(!context.scale||context.scale.confidence<.8||horizontal<.85||vertical<.75)continue;
            const x=(row.left+row.right)/2,y=(row.top+row.bottom)/2;
            const a=mapPoint(measurement.transform,x,y),b=mapPoint(measurement.transform,x+context.scale.pixelsPerModule,y);
            scales.push({...context.scale,pixelsPerModule:Math.abs(b.x-a.x)});
          }
        }
        for(const scale of scales){
          let singles=0;
          const usable=measurement.facades.every(f=>{
            const width=f.rectifiedBounds.width/scale.pixelsPerModule,snapped=half(width);
            if(Math.abs(width-1)<=.14)singles++;
            return snapped>=.5&&snapped<=12&&Math.abs(width-snapped)<=.14;
          });
          // Des traits imprimés au milieu de six appareils ne prouvent pas
          // douze modules. Exiger aussi trois façades entières sur le pas.
          if(usable&&singles>=3){pitch=scale.pixelsPerModule;confidence=scale.confidence;source='separations-visibles';break;}
        }
      }
    }
    if(pitch){
      row.scale={moduleMillimeters:18,pixelsPerModule:pitch,pixelsPerMillimeter:pitch/18,confidence,source,plane:'rangee-redressee'};
      row.modules=modules??half(measurement.width/pitch);row.calibrationConfirmed=true;
      row.cuts=[0,...measurement.facades.slice(0,-1).map(f=>half(f.rectifiedBounds.right/pitch)).filter(c=>c>0&&c<row.modules),row.modules];
      row.cuts=[...new Set(row.cuts)].sort((a,b)=>a-b);
    }
    rows.push(row);
    for(const facade of group.facades){
      const measured=measurement?.facades.find(f=>f.id===facade.id),width=measured&&pitch?measured.rectifiedBounds.width/pitch:null;
      const count=width!==null&&Math.abs(width-half(width))<=.14?half(width):null;
      candidates.push({...facade,rowIndex,groupId:group.id,modules:count,scale:count===null?null:row.scale,rectifiedBounds:measured?.rectifiedBounds??null,
        reason:'Contour à quatre côtés, redressé avant lecture.'+(count===null?' Largeur modulaire à confirmer.':' Largeur mesurée dans le plan redressé ; regroupement des pôles à vérifier.')});
    }
  }
  if(candidates.some(c=>c.modules===null))warnings.push('18 mm définit une largeur physique, pas une échelle en pixels. Confirmez le nombre de modules si aucun étalon fiable n’est visible.');
  return {rows,candidates,warnings:[...new Set(warnings)],bands:[],orientation:detection.orientation};
}

/** Segmente une rangée délimitée, dans son plan plutôt que dans son enveloppe. */
export function segmentRectifiedRow(image,{points,modules}){
  const straight=warpPixels(image,points);
  const layout=segmentSelection(straight,{x:0,y:0,width:straight.width,height:straight.height},modules);
  const transform=homography(points,straight.width,straight.height);
  const bounds=quad=>({left:Math.min(...quad.map(p=>p.x)),right:Math.max(...quad.map(p=>p.x)),top:Math.min(...quad.map(p=>p.y)),bottom:Math.max(...quad.map(p=>p.y))});
  const project=rect=>[
    [rect.left,rect.top],[rect.right,rect.top],[rect.right,rect.bottom],[rect.left,rect.bottom]
  ].map(([x,y])=>{
    const corner=x===0?(y===0?0:y===straight.height?3:null):x===straight.width?(y===0?1:y===straight.height?2:null):null;
    if(corner!==null)return {...points[corner]};
    const p=mapPoint(transform,x,y);
    // Une homographie évaluée au coin peut dépasser de 1e-12 la source.
    for(const [axis,limit]of [['x',image.width],['y',image.height]]){if(Math.abs(p[axis])<1e-7)p[axis]=0;else if(Math.abs(p[axis]-limit)<1e-7)p[axis]=limit;}
    return p;
  });
  const candidates=layout.candidates.map(candidate=>{
    const quad=project(candidate);
    return {...candidate,...bounds(quad),points:quad,scale:candidate.scale?{...candidate.scale,plane:'rangee-redressee'}:null,reason:candidate.reason+' Découpe projetée depuis la rangée redressée.'};
  });
  const rows=layout.rows.map(row=>{
    const quad=project(row);
    return {...row,...bounds(quad),points:quad,calibrationConfirmed:true,scale:row.scale?{...row.scale,plane:'rangee-redressee'}:null};
  });
  return {...layout,candidates,rows};
}

/** Cherche l'orientation dans la zone choisie, sans réduire sa portée en silence. */
export function analyzeSelectedRow(image,{points=null,modules}){
  if(points)return segmentRectifiedRow(image,{points,modules});
  const layout=analyzeFacades(image),margin=.1;
  const plausible=layout.rows.filter(row=>row.points&&row.confidence>=.8&&
    (row.facades.length>=2||row.confidence>=.9)&&row.left<=image.width*margin&&row.right>=image.width*(1-margin)&&
    row.top<=image.height*.15&&row.bottom>=image.height*.85);
  const quad=plausible.length===1?plausible[0].points:[{x:0,y:0},{x:image.width,y:0},{x:image.width,y:image.height},{x:0,y:image.height}];
  const result=segmentRectifiedRow(image,{points:quad,modules});
  if(plausible.length!==1)result.warnings.push('Redressement automatique indécidable dans cette zone : les limites que vous avez tracées sont conservées.');
  return {...result,geometrySource:plausible.length===1?'contours':'selection'};
}
