import {homography,mapPoint,rectifiedSize,validateQuad} from './geometry.js';
import {warpPixels} from './pixels.js';
import {calibrateRow} from '../segmentation/automatic.js';

const radians=degrees=>degrees*Math.PI/180;
const degrees=angle=>angle*180/Math.PI;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const center=points=>({x:points.reduce((sum,point)=>sum+point.x,0)/4,y:points.reduce((sum,point)=>sum+point.y,0)/4});
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]??0;
const turn=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));

function direction(points){
  // Les deux grands bords horizontaux sont utilisés ensemble : un trapèze
  // n'est pas confondu avec une simple rotation du bord du haut.
  const vector={x:points[1].x-points[0].x+points[2].x-points[3].x,y:points[1].y-points[0].y+points[2].y-points[3].y};
  return Math.atan2(vector.y,vector.x);
}
function basis(angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return {project:point=>({x:point.x*c+point.y*s,y:-point.x*s+point.y*c}),restore:point=>({x:point.x*c-point.y*s,y:point.x*s+point.y*c})};
}
function extent(points){
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}
function compatible(a,b){
  const difference=Math.abs(turn(a.angle-b.angle));
  if(difference>radians(12))return false;
  const axes=basis(a.angle+turn(b.angle-a.angle)/2),first=extent(a.points.map(axes.project)),second=extent(b.points.map(axes.project));
  const firstHeight=first.bottom-first.top,secondHeight=second.bottom-second.top;
  if(Math.max(firstHeight,secondHeight)>Math.min(firstHeight,secondHeight)*2.3)return false;
  const overlap=Math.min(first.bottom,second.bottom)-Math.max(first.top,second.top);
  // Les rangées séparées restent séparées, même si leurs rectangles de
  // projection dans l'image se chevauchent à cause de l'inclinaison.
  if(overlap<Math.min(firstHeight,secondHeight)*.66)return false;
  const gap=Math.max(0,Math.max(first.left,second.left)-Math.min(first.right,second.right));
  return gap<=Math.min(firstHeight,secondHeight)*.85;
}
function rowDirection(facades){
  const typical=median(facades.map(f=>f.frontWidth));let x=0,y=0;
  for(const facade of facades){const weight=Math.min(facade.frontWidth,typical*2);x+=Math.cos(facade.angle)*weight;y+=Math.sin(facade.angle)*weight;}
  return Math.atan2(y,x);
}
function fit(points){
  const meanX=points.reduce((sum,p)=>sum+p.x,0)/points.length,meanY=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  let numerator=0,denominator=0;
  for(const point of points){numerator+=(point.x-meanX)*(point.y-meanY);denominator+=(point.x-meanX)**2;}
  const a=denominator>1e-8?numerator/denominator:0;
  return {a,b:meanY-a*meanX};
}
function intersect(vertical,horizontal){
  const divisor=1-vertical.a*horizontal.a;
  if(Math.abs(divisor)<.05)return null;
  return {x:(vertical.b+vertical.a*horizontal.b)/divisor,y:(horizontal.b+horizontal.a*vertical.b)/divisor};
}
function rowQuad(facades,angle,width,height){
  if(facades.length===1)return facades[0].points.map(point=>({...point}));
  const axes=basis(angle),local=facades.map(facade=>facade.points.map(axes.project)),all=local.flat();
  const top=fit(local.flatMap(points=>[points[0],points[1]])),bottom=fit(local.flatMap(points=>[points[3],points[2]]));
  // Une enveloppe des bords observés conserve les façades de hauteurs
  // différentes ; la droite moyenne seule pourrait en couper une partie.
  top.b=Math.min(...all.map(point=>point.y-top.a*point.x));
  bottom.b=Math.max(...all.map(point=>point.y-bottom.a*point.x));
  const leftmost=local.reduce((best,points)=>center(points).x<center(best).x?points:best),rightmost=local.reduce((best,points)=>center(points).x>center(best).x?points:best);
  const left=fit([leftmost[0],leftmost[3]].map(point=>({x:point.y,y:point.x}))),right=fit([rightmost[1],rightmost[2]].map(point=>({x:point.y,y:point.x})));
  left.b=Math.min(...all.map(point=>point.x-left.a*point.y));
  right.b=Math.max(...all.map(point=>point.x-right.a*point.y));
  const intersections=[intersect(left,top),intersect(right,top),intersect(right,bottom),intersect(left,bottom)];
  if(intersections.some(point=>!point))return null;
  const quad=intersections.map(axes.restore);
  // Ne pas rabattre silencieusement des coins hors photo : cela tordrait la
  // rangée. Les façades individuelles restent utilisables dans ce cas.
  return validateQuad(quad,width,height)?quad:null;
}

/** Regroupe des façades déjà détectées, sans déduire une largeur physique. */
export function groupFacadeRows(facades,{width,height}={}){
  if(!Array.isArray(facades)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return {rows:[],warnings:['Façades ou dimensions invalides pour le groupement des rangées.']};
  const warnings=[],accepted=[];
  for(const [index,facade]of facades.slice(0,512).entries()){
    const points=facade?.points;
    if(!validateQuad(points,width,height)){warnings.push(`Façade ${index+1} ignorée : coins invalides ou hors photo.`);continue;}
    const angle=direction(points);
    if(Math.abs(angle)>radians(55)){warnings.push(`Façade ${index+1} trop inclinée pour grouper sûrement une rangée.`);continue;}
    const supplied=facade.confidence??facade.confiance,confidence=Number.isFinite(supplied)?clamp(supplied,0,1):0;
    accepted.push({source:facade,sourceIndex:index,id:facade.id??`facade-${index+1}`,points:points.map(point=>({...point})),angle,frontWidth:(distance(points[0],points[1])+distance(points[3],points[2]))/2,confidence});
  }
  if(facades.length>512)warnings.push('Plus de 512 façades : groupement limité pour préserver la mémoire du téléphone.');
  const parents=accepted.map((_,index)=>index);
  const find=index=>{while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;};
  for(let a=0;a<accepted.length;a++)for(let b=a+1;b<accepted.length;b++)if(compatible(accepted[a],accepted[b]))parents[find(b)]=find(a);
  const groups=new Map();
  accepted.forEach((facade,index)=>{const key=find(index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(facade);});
  const rows=[];
  for(const group of groups.values()){
    const angle=rowDirection(group),axes=basis(angle);
    group.sort((a,b)=>axes.project(center(a.points)).x-axes.project(center(b.points)).x);
    const points=rowQuad(group,angle,width,height);
    if(!points)warnings.push('Une enveloppe de rangée sort de la photo : redresser ses façades individuellement.');
    const all=group.flatMap(facade=>facade.points),box=extent(all);
    const confidence=Math.min(...group.map(facade=>facade.confidence));
    rows.push({
      points,orientation:degrees(angle),confidence,confiance:confidence,niveau:'geometrie',
      bounds:{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top},
      rectifiedSize:points?rectifiedSize(points):null,
      facades:group.map(facade=>({...facade.source,id:facade.id,sourceIndex:facade.sourceIndex,points:facade.points})),
      facadeIds:group.map(facade=>facade.id),
      reason:group.length===1?'Façade isolée conservée pour redressement individuel.':'Façades voisines regroupées selon leurs bords et leur orientation ; dimensions physiques inconnues.'
    });
  }
  rows.sort((a,b)=>a.bounds.y-b.bounds.y||a.bounds.x-b.bounds.x);
  rows.forEach((row,index)=>{row.id=`rangee-${index+1}`;});
  return {rows,warnings};
}

function inverseMatrix(matrix){
  const [a,b,c,d,e,f,g,h,i]=matrix;
  const determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12)throw Error('La perspective de cette rangée ne permet pas une projection stable.');
  return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(value=>value/determinant);
}

/** Mesure uniquement des pixels dans le plan redressé de la rangée. */
export function measureRectifiedFacades(row){
  if(!Array.isArray(row?.points)||row.points.length!==4||!Array.isArray(row.facades))throw Error('Il faut les quatre coins de la rangée et ses façades pour les projeter.');
  const {width,height}=rectifiedSize(row.points);
  // homography décrit la destination vers la source pour lire les pixels.
  // Les contours des façades exigent ici le trajet inverse, source vers plan.
  const transform=inverseMatrix(homography(row.points,width,height));
  const facades=row.facades.map(facade=>{
    if(!Array.isArray(facade?.points)||facade.points.length!==4||!facade.points.every(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)))throw Error('Une façade contient des coins invalides pour la projection.');
    const rectifiedPoints=facade.points.map(point=>mapPoint(transform,point.x,point.y));
    if(!rectifiedPoints.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)))throw Error('Une façade ne peut pas être projetée dans cette rangée.');
    for(const point of rectifiedPoints){
      if(Math.abs(point.x)<1e-8)point.x=0;if(Math.abs(point.x-width)<1e-8)point.x=width;
      if(Math.abs(point.y)<1e-8)point.y=0;if(Math.abs(point.y-height)<1e-8)point.y=height;
    }
    const box=extent(rectifiedPoints);
    return {...facade,rectifiedPoints,rectifiedBounds:{...box,width:box.right-box.left,height:box.bottom-box.top}};
  });
  return {width,height,transform,facades};
}

/** Calibre une rangée sur deux bords humains d'un seul module de 18 mm. */
export function calibrateFacadeRow(image,{points,first,second}={}){
  if(!validateQuad(points,image?.width,image?.height))throw Error('Les coins de la rangée à calibrer sont invalides ou hors photo.');
  if(![first,second].every(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y)))throw Error('Repérez les deux bords d’un appareil connu de 18 mm.');
  const {width,height}=rectifiedSize(points),transform=inverseMatrix(homography(points,width,height));
  const projected=[first,second].map(point=>mapPoint(transform,point.x,point.y));
  if(projected.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x< -1e-7||point.y< -1e-7||point.x>width+1e-7||point.y>height+1e-7))throw Error('Les deux bords du repère de 18 mm doivent se trouver dans la rangée.');
  const straight=warpPixels(image,points),calibrated=calibrateRow(straight,{left:0,right:width,top:0,bottom:height},Math.abs(projected[1].x-projected[0].x));
  return {...calibrated,...extent(points),points:points.map(point=>({...point})),calibrationConfirmed:true,rectifiedSize:{width,height},scale:{...calibrated.scale,plane:'rangee-redressee'}};
}

/** Projette les séparations confirmées, sans imposer une coupe par module. */
export function divideFacadeRow(row){
  const modules=row?.modules,cuts=row?.cuts;
  if(row?.calibrationConfirmed===false)throw Error('Confirmez l’échelle de la rangée avant de la découper.');
  if(!Number.isFinite(modules)||modules<.5||modules>100||!Number.isInteger(modules*2))throw Error('Le nombre de modules de la rangée doit être positif et arrondi au demi-module.');
  if(!Array.isArray(cuts)||cuts.length<2||cuts[0]!==0||cuts.at(-1)!==modules||!cuts.every((cut,index)=>Number.isFinite(cut)&&Number.isInteger(cut*2)&&cut>=0&&cut<=modules&&(index===0||cut>cuts[index-1])))throw Error('Les séparations doivent suivre la rangée de zéro au total, par demi-module et sans recouvrement.');
  const {width,height}=rectifiedSize(row.points),transform=homography(row.points,width,height);
  const onEdge=(point,a,b)=>({x:clamp(point.x,Math.min(a.x,b.x),Math.max(a.x,b.x)),y:clamp(point.y,Math.min(a.y,b.y),Math.max(a.y,b.y))});
  // Les frontières sont calculées une seule fois, puis copiées des deux côtés
  // d'un joint. Les coins externes restent strictement les coordonnées source.
  const top=cuts.map((cut,index)=>index===0?{...row.points[0]}:index===cuts.length-1?{...row.points[1]}:onEdge(mapPoint(transform,cut/modules*width,0),row.points[0],row.points[1]));
  const bottom=cuts.map((cut,index)=>index===0?{...row.points[3]}:index===cuts.length-1?{...row.points[2]}:onEdge(mapPoint(transform,cut/modules*width,height),row.points[3],row.points[2]));
  return cuts.slice(0,-1).map((cut,index)=>{
    const points=[top[index],top[index+1],bottom[index+1],bottom[index]].map(point=>({...point})),box=extent(points);
    return {points,rect:{x:box.left,y:box.top,width:box.right-box.left,height:box.bottom-box.top,modules:cuts[index+1]-cut}};
  });
}
