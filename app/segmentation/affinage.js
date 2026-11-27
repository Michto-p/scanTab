import {detectFacades} from './facades.js';
import {segmentSelection} from './automatic.js';
import {groupFacadeRows,measureRectifiedFacades} from '../pretraitement/rangees.js';
import {homography,mapPoint,rectifiedSize,validateQuad} from '../pretraitement/geometry.js';

const MAX_SIDE=1100,MAX_ATTEMPTS=3;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]??0;
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const box=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%4];return sum+p.x*q.y-p.y*q.x;},0))/2;
const confidence=c=>Number.isFinite(c?.confiance??c?.confidence)?clamp(c.confiance??c.confidence,0,1):0;

function sampleQuad(image,points){
  const size=rectifiedSize(points),ratio=Math.min(1,MAX_SIDE/Math.max(size.width,size.height));
  const width=Math.max(1,Math.round(size.width*ratio)),height=Math.max(1,Math.round(size.height*ratio));
  const transform=homography(points,width,height),data=new Uint8ClampedArray(width*height*4),sw=image.width,sh=image.height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=mapPoint(transform,x+.5,y+.5),sx=clamp(p.x-.5,0,sw-1),sy=clamp(p.y-.5,0,sh-1),x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
    const a=(y0*sw+x0)*4,b=(y0*sw+Math.min(sw-1,x0+1))*4,c=(Math.min(sh-1,y0+1)*sw+x0)*4,d=(Math.min(sh-1,y0+1)*sw+Math.min(sw-1,x0+1))*4;
    for(let channel=0;channel<4;channel++)data[(y*width+x)*4+channel]=(image.data[a+channel]*(1-dx)+image.data[b+channel]*dx)*(1-dy)+(image.data[c+channel]*(1-dx)+image.data[d+channel]*dx)*dy;
  }
  return {width,height,data,transform};
}

function contextQuad(parent,image){
  const size=rectifiedSize(parent.points),transform=homography(parent.points,size.width,size.height);
  const wanted=Math.max(4,Math.min(12,size.height*.04));
  // Le contexte provient toujours de la photo, sans ajouter un cadre artificiel.
  for(const padding of [wanted,wanted/2,0]){
    const points=[[-padding,-padding],[size.width+padding,-padding],[size.width+padding,size.height+padding],[-padding,size.height+padding]].map(([x,y])=>mapPoint(transform,x,y));
    if(validateQuad(points,image.width,image.height))return points;
  }
  return null;
}

function coherentGroup(candidates,image){
  const groups=groupFacadeRows(candidates,image).rows.filter(row=>row.points&&row.facades.length>=3);
  let best=null;
  for(const row of groups){
    const measurement=measureRectifiedFacades(row),typical=median(measurement.facades.map(f=>f.rectifiedBounds.height));
    const full=measurement.facades.filter(f=>f.rectifiedBounds.height>=typical*.8&&f.rectifiedBounds.height<=typical*1.2);
    if(full.length<3)continue;
    const top=median(full.map(f=>f.rectifiedBounds.top)),bottom=median(full.map(f=>f.rectifiedBounds.bottom));
    const coherent=full.filter(f=>Math.abs(f.rectifiedBounds.top-top)<=typical*.13&&Math.abs(f.rectifiedBounds.bottom-bottom)<=typical*.13);
    if(coherent.length<3)continue;
    const coverage=coherent.reduce((sum,f)=>sum+area(f.points),0),candidate={row,facades:coherent,coverage};
    if(!best||coverage>best.coverage)best=candidate;
  }
  return best;
}

function projectCandidate(candidate,transform,image,id,limit,reason){
  const points=candidate.points.map(p=>mapPoint(transform,p.x,p.y));
  if(!validateQuad(points,image.width,image.height))return null;
  const score=Math.min(limit,confidence(candidate));
  const {rectifiedPoints,rectifiedBounds,sourceIndex,rowIndex,groupId,...details}=candidate;
  return {...details,...box(points),points,id,modules:null,scale:null,confidence:score,confiance:score,niveau:'geometrie',famille:candidate.famille??'inconnu',status:'proposition',reason};
}

function repeatedUnit(measurement){
  const widths=measurement.facades.map(f=>f.rectifiedBounds.width).filter(value=>value>=8);
  let best=null;
  for(const width of widths){
    const matches=widths.filter(value=>Math.abs(value-width)<=width*.11);
    if(matches.length<3)continue;
    const unit=median(matches);
    if(!best||matches.length>best.repetitions||(matches.length===best.repetitions&&unit<best.pixels))best={pixels:unit,repetitions:matches.length};
  }
  return best;
}

function mayBePartial(row,groups){
  const height=rectifiedSize(row.points).height;
  for(const other of groups){
    if(other===row||!other.points||other.facades.length<3)continue;
    const size=rectifiedSize(other.points);if(size.height<height*1.6)continue;
    const measured=measureRectifiedFacades({...other,facades:[{id:'zone-partielle',points:row.points}]}).facades[0].rectifiedBounds;
    // Un groupe court partageant le haut d'un voisin beaucoup plus haut peut
    // être son seul bandeau lisible. On ne multiplie pas ces petites boîtes et
    // on n'invente pas leur bord inférieur par prolongement.
    if(Math.abs(measured.top)<size.height*.18&&measured.bottom<size.height*.75&&measured.right>-size.height*.8&&measured.left<size.width+size.height*.8)return true;
  }
  return false;
}

/**
 * Affine les contours dans leur plan, sans attribuer de largeur physique.
 * Les largeurs répétées ne sont qu'une unité relative de recherche des joints.
 * Les coordonnées rendues restent celles de la photo pleine résolution.
 */
export function refineFacadeGroups(image,candidates){
  if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||!image.data||image.data.length!==image.width*image.height*4||!Array.isArray(candidates))return Array.isArray(candidates)?candidates:[];
  let attempts=0;
  const expanded=candidates.flatMap((parent,index)=>{
    if(!validateQuad(parent?.points,image.width,image.height))return [parent];
    const size=rectifiedSize(parent.points);
    if(size.width/size.height<2.4||attempts>=MAX_ATTEMPTS)return [parent];
    const context=contextQuad(parent,image);if(!context)return [parent];
    attempts++;
    const straight=sampleQuad(image,context),children=detectFacades(straight).candidates,coherent=coherentGroup(children,straight);
    if(!coherent)return [parent];
    const parentArea=area(parent.points)/area(context)*straight.width*straight.height;
    const bounds=box(coherent.facades.flatMap(c=>c.points));
    if(coherent.coverage<parentArea*.7||bounds.right-bounds.left<straight.width*.78)return [parent];
    const mapped=coherent.facades.map((child,i)=>projectCandidate(child,straight.transform,image,`${parent.id??'groupe-'+index}-contour-${i+1}`,confidence(parent),'Contour retrouvé après redressement local ; nature et largeur physique inconnues.')).filter(Boolean);
    return mapped.length>=3?mapped:[parent];
  });
  const groups=groupFacadeRows(expanded,image).rows,result=[];
  for(const row of groups){
    if(!row.points||row.facades.length<3||attempts>=MAX_ATTEMPTS||mayBePartial(row,groups)){result.push(...row.facades);continue;}
    const measurement=measureRectifiedFacades(row),unit=repeatedUnit(measurement);
    if(!unit){result.push(...row.facades);continue;}
    const relativeTotal=Math.round(measurement.width/unit.pixels*2)/2;
    if(relativeTotal<1.5||relativeTotal>100||Math.abs(measurement.width/unit.pixels-relativeTotal)>.16){result.push(...row.facades);continue;}
    attempts++;
    const straight=sampleQuad(image,row.points),layout=segmentSelection(straight,{x:0,y:0,width:straight.width,height:straight.height},relativeTotal);
    const observed=layout.candidates.filter(c=>c.modules!==null);
    if(observed.length<row.facades.length||observed.length<3){result.push(...row.facades);continue;}
    const coverage=observed.reduce((sum,c)=>sum+(c.right-c.left)*(c.bottom-c.top),0)/(straight.width*straight.height);
    if(coverage<.85){result.push(...row.facades);continue;}
    const mapped=observed.map((candidate,index)=>{
      const points=[{x:candidate.left,y:candidate.top},{x:candidate.right,y:candidate.top},{x:candidate.right,y:candidate.bottom},{x:candidate.left,y:candidate.bottom}];
      return projectCandidate({...candidate,points},straight.transform,image,`${row.id}-joint-${index+1}`,confidence(row),'Joints observés dans le plan redressé avec un repère relatif répété ; aucune largeur physique attribuée.');
    }).filter(Boolean);
    result.push(...(mapped.length===observed.length?mapped:row.facades));
  }
  // Les entrées invalides ignorées par le groupement restent disponibles pour
  // leur correction manuelle ; cet affinage ne supprime pas une saisie.
  const invalid=expanded.filter(candidate=>!validateQuad(candidate?.points,image.width,image.height));
  return [...result,...invalid];
}
