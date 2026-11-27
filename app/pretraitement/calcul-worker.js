import {analyzeLayout,segmentSelection} from '../segmentation/automatic.js';
import {suggestRows} from '../segmentation/rows.js';
import {detectPanelQuad} from './cadrage.js';
import {suggestCutout} from '../segmentation/detourage.js';
import {warpPixels} from './pixels.js';
import {analyzeFacades,segmentRectifiedRow,analyzeSelectedRow} from '../segmentation/analyse.js';
import {calibrateFacadeRow} from './rangees.js';

self.onmessage=({data:{id,operation,image,parameters}})=>{
  try{
    if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||image.width<=0||image.height<=0||image.width*image.height>40000000||image.data?.length!==image.width*image.height*4)throw Error('Image invalide ou supérieure à 40 mégapixels.');
    let result;
    if(operation==='cadrage')result=detectPanelQuad(image);
    else if(operation==='appareils')result=analyzeFacades(image,parameters);
    else if(operation==='rangée-redressée')result=segmentRectifiedRow(image,parameters);
    else if(operation==='zone-modulaire')result=analyzeSelectedRow(image,parameters);
    else if(operation==='calibration-rangée')result=calibrateFacadeRow(image,parameters);
    else if(operation==='rangées'){const layout=analyzeLayout(image);result={...layout,bands:layout.rows.length?[]:suggestRows(image)};}
    else if(operation==='sélection')result=segmentSelection(image,parameters.bounds,parameters.modules);
    else if(operation==='détourage')result=suggestCutout(image);
    else if(operation==='redressement')result=warpPixels(image,parameters.points,progress=>self.postMessage({id,progress}));
    else throw Error('Calcul local inconnu.');
    const pixels=result.data??result.imageData?.data;
    self.postMessage({id,result},pixels?[pixels.buffer]:[]);
  }catch(error){self.postMessage({id,error:error.message||'Calcul local impossible.'});}
};
